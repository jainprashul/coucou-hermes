// Hermes WebSocket Gateway Client
//
// Connects to Hermes Agent Gateway (`ws://<host>:9119/api/ws`) over Tailscale/LAN.
// Handles JSON-RPC 2.0 two-way communication:
//   - capabilities handshake (`server_requests: true`)
//   - real-time tool progress & reasoning events
//   - server requests: tool approvals (allow once/always/deny) & clarify questions
//   - multi-agent & subagent event tracking (Antigravity, Codex, delegate_task)

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::island::WINDOW_LABEL;
use crate::log;

const RECONNECT_BASE_MS: u64 = 1000;
const RECONNECT_MAX_MS: u64 = 10000;
const PING_INTERVAL_SECS: u64 = 15;
const ACK_TIMEOUT_MS: u64 = 800;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub host: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPayload {
    pub request_id: String,
    pub session_id: String,
    pub command: String,
    pub description: String,
    pub tool_name: Option<String>,
    pub choices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarifyQuestion {
    pub qid: String,
    pub question: String,
    pub choices: Option<Vec<String>>,
    pub multi_select: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarifyPayload {
    pub request_id: String,
    pub session_id: String,
    pub questions: Vec<ClarifyQuestion>,
}

pub struct HermesClientState {
    tx_outgoing: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pending_approvals: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    pending_clarifies: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    is_connected: AtomicBool,
    active_host: Mutex<String>,
    last_error: Mutex<Option<String>>,
    counter: AtomicU64,
}

impl Default for HermesClientState {
    fn default() -> Self {
        Self {
            tx_outgoing: Mutex::new(None),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            pending_clarifies: Arc::new(Mutex::new(HashMap::new())),
            is_connected: AtomicBool::new(false),
            active_host: Mutex::new(String::new()),
            last_error: Mutex::new(None),
            counter: AtomicU64::new(1),
        }
    }
}

impl HermesClientState {
    pub fn is_connected(&self) -> bool {
        self.is_connected.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> ConnectionStatus {
        ConnectionStatus {
            connected: self.is_connected(),
            host: self.active_host.lock().unwrap().clone(),
            last_error: self.last_error.lock().unwrap().clone(),
        }
    }

    pub fn send_frame(&self, frame: String) -> bool {
        if let Some(tx) = self.tx_outgoing.lock().unwrap().as_ref() {
            tx.send(frame).is_ok()
        } else {
            false
        }
    }

    pub fn send_rpc_request(&self, method: &str, params: Value) -> bool {
        let id = self.counter.fetch_add(1, Ordering::Relaxed);
        let frame = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": id
        })
        .to_string();
        self.send_frame(frame)
    }

    pub fn decide_approval(&self, request_id: &str, choice: &str) -> bool {
        if let Some(tx) = self.pending_approvals.lock().unwrap().remove(request_id) {
            let _ = tx.send(choice.to_string());
            return true;
        }
        let gateway_choice = match choice {
            "allow" => "once",
            other => other,
        };
        self.send_rpc_request(
            "approval.respond",
            json!({
                "request_id": request_id,
                "choice": gateway_choice,
            }),
        )
    }

    pub fn answer_clarify(&self, request_id: &str, answers: Value) -> bool {
        if let Some(tx) = self.pending_clarifies.lock().unwrap().remove(request_id) {
            let _ = tx.send(answers);
            return true;
        }
        self.send_rpc_request(
            "clarify.respond",
            json!({
                "request_id": request_id,
                "answer": answers,
            }),
        )
    }
}

pub fn start_gateway_connection(
    app: AppHandle,
    state: Arc<HermesClientState>,
    url: String,
    auth_user: Option<String>,
    auth_pass: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        *state.active_host.lock().unwrap() = url.clone();
        let mut backoff = RECONNECT_BASE_MS;

        loop {
            log::line(format!("hermes connecting to {url}"));
            *state.last_error.lock().unwrap() = None;

            match connect_and_run(&app, &state, &url, auth_user.as_deref(), auth_pass.as_deref()).await {
                Ok(()) => {
                    log::line("hermes gateway connection closed normally");
                    backoff = RECONNECT_BASE_MS;
                }
                Err(err) => {
                    let msg = format!("hermes connection error: {err}");
                    log::line(msg.clone());
                    *state.last_error.lock().unwrap() = Some(msg);
                }
            }

            state.is_connected.store(false, Ordering::Relaxed);
            let _ = app.emit("hermes-status", state.status());

            tokio::time::sleep(Duration::from_millis(backoff)).await;
            backoff = (backoff * 2).min(RECONNECT_MAX_MS);
        }
    });
}

async fn connect_and_run(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    url_str: &str,
    auth_user: Option<&str>,
    auth_pass: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Format URL for WS upgrade (e.g. http://host:9119 -> ws://host:9119/api/ws)
    let ws_url = if url_str.starts_with("http://") {
        format!("ws://{}/api/ws", &url_str[7..].trim_end_matches('/'))
    } else if url_str.starts_with("https://") {
        format!("wss://{}/api/ws", &url_str[8..].trim_end_matches('/'))
    } else if !url_str.starts_with("ws://") && !url_str.starts_with("wss://") {
        format!("ws://{}/api/ws", url_str.trim_end_matches('/'))
    } else if !url_str.contains("/api/ws") {
        format!("{}/api/ws", url_str.trim_end_matches('/'))
    } else {
        url_str.to_string()
    };

    // In gated mode, authenticate via POST /auth/password-login to obtain session access token
    let mut final_ws_url = ws_url.clone();
    if let (Some(u), Some(p)) = (auth_user, auth_pass) {
        if !u.is_empty() && !p.is_empty() {
            let http_base = if url_str.starts_with("wss://") {
                format!("https://{}", &url_str[6..].trim_end_matches('/'))
            } else if url_str.starts_with("ws://") {
                format!("http://{}", &url_str[5..].trim_end_matches('/'))
            } else if url_str.starts_with("http://") || url_str.starts_with("https://") {
                url_str.trim_end_matches('/').to_string()
            } else {
                format!("http://{}", url_str.trim_end_matches('/'))
            };

            let login_url = format!("{http_base}/auth/password-login");
            let http_client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()?;
            let body = json!({
                "provider": "basic",
                "username": u,
                "password": p
            });

            if let Ok(resp) = http_client.post(&login_url).json(&body).send().await {
                if resp.status().is_success() {
                    for cookie in resp.headers().get_all(reqwest::header::SET_COOKIE) {
                        if let Ok(cookie_str) = cookie.to_str() {
                            if let Some(pos) = cookie_str.find("hermes_session_at=") {
                                let rest = &cookie_str[pos + 18..];
                                let token_raw = rest.split(';').next().unwrap_or("").trim().trim_matches('"');
                                if !token_raw.is_empty() {
                                    final_ws_url = if final_ws_url.contains('?') {
                                        format!("{final_ws_url}&token={token_raw}")
                                    } else {
                                        format!("{final_ws_url}?token={token_raw}")
                                    };
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut req = final_ws_url.into_client_request()?;
    if let (Some(u), Some(p)) = (auth_user, auth_pass) {
        if !u.is_empty() {
            use std::io::Write;
            let mut auth_bytes = Vec::new();
            let _ = write!(auth_bytes, "{u}:{p}");
            let encoded = base64_simple(&auth_bytes);
            if let Ok(val) = format!("Basic {encoded}").parse() {
                req.headers_mut().insert("Authorization", val);
            }
        }
    }

    let (ws_stream, _) = connect_async(req).await?;
    let (mut write, mut read) = ws_stream.split();

    state.is_connected.store(true, Ordering::Relaxed);
    let _ = app.emit("hermes-status", state.status());

    let (tx_outgoing, mut rx_outgoing) = mpsc::unbounded_channel::<String>();
    *state.tx_outgoing.lock().unwrap() = Some(tx_outgoing.clone());

    // Send capabilities immediately
    let caps_id = state.counter.fetch_add(1, Ordering::Relaxed);
    let caps_frame = json!({
        "jsonrpc": "2.0",
        "method": "client.capabilities",
        "params": {
            "server_requests": true,
            "tool_progress": true,
            "subagent_tree": true
        },
        "id": caps_id
    })
    .to_string();
    let _ = write.send(Message::Text(caps_frame)).await;

    let mut ping_interval = tokio::time::interval(Duration::from_secs(PING_INTERVAL_SECS));

    loop {
        tokio::select! {
            _ = ping_interval.tick() => {
                let ping_frame = json!({
                    "jsonrpc": "2.0",
                    "method": "gateway.ping",
                    "id": state.counter.fetch_add(1, Ordering::Relaxed)
                }).to_string();
                if write.send(Message::Text(ping_frame)).await.is_err() {
                    break;
                }
            }
            Some(msg_text) = rx_outgoing.recv() => {
                if write.send(Message::Text(msg_text)).await.is_err() {
                    break;
                }
            }
            msg = read.next() => {
                let Some(msg) = msg else { break };
                let msg = msg?;
                match msg {
                    Message::Text(text) => {
                        handle_incoming_text(app, state, &tx_outgoing, &text).await;
                    }
                    Message::Ping(data) => {
                        let _ = write.send(Message::Pong(data)).await;
                    }
                    Message::Close(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    *state.tx_outgoing.lock().unwrap() = None;
    Ok(())
}

async fn handle_incoming_text(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    tx_outgoing: &mpsc::UnboundedSender<String>,
    text: &str,
) {
    let Ok(val) = serde_json::from_str::<Value>(text) else { return };

    // Check if this is a Server Request (server asking client for something)
    if let Some(method) = val.get("method").and_then(Value::as_str) {
        let id_val = val.get("id").cloned();
        let params = val.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "approval" => {
                handle_approval_request(app, state, tx_outgoing, id_val, params).await;
                return;
            }
            "clarify" => {
                handle_clarify_request(app, state, tx_outgoing, id_val, params).await;
                return;
            }
            "gateway.ping" => {
                if let Some(id) = id_val {
                    let pong = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "ok": true }
                    })
                    .to_string();
                    let _ = tx_outgoing.send(pong);
                }
                return;
            }
            _ => {}
        }
    }

    // Check if this is an Event notification (params contains event payload)
    let _ = app.emit_to(WINDOW_LABEL, "hermes-event", val);
}

async fn handle_approval_request(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    tx_outgoing: &mpsc::UnboundedSender<String>,
    id_val: Option<Value>,
    params: Value,
) {
    let Some(id) = id_val else { return };
    let req_id_str = match &id {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => "req".to_string(),
    };

    let session_id = params.get("session_id").and_then(Value::as_str).unwrap_or_default().to_string();
    let command = params.get("command").and_then(Value::as_str).unwrap_or_default().to_string();
    let description = params.get("description").and_then(Value::as_str).unwrap_or_default().to_string();
    let tool_name = params.get("tool_name").and_then(Value::as_str).map(str::to_string);
    let choices = params.get("choices")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_else(|| vec!["once".into(), "always".into(), "deny".into()]);

    let (tx_decision, rx_decision) = oneshot::channel::<String>();
    state.pending_approvals.lock().unwrap().insert(req_id_str.clone(), tx_decision);

    let payload = ApprovalPayload {
        request_id: req_id_str.clone(),
        session_id,
        command,
        description,
        tool_name,
        choices,
    };

    // Emit to frontend UI
    let _ = app.emit_to(WINDOW_LABEL, "hermes-approval", payload);

    let tx_out = tx_outgoing.clone();
    let pending_map = state.pending_approvals.clone();

    // Spawn decision waiter with 108s decision timeout
    tauri::async_runtime::spawn(async move {
        let decision = match tokio::time::timeout(Duration::from_secs(108), rx_decision).await {
            Ok(Ok(d)) => d,
            _ => "deny".to_string(), // fallback to deny on timeout
        };

        pending_map.lock().unwrap().remove(&req_id_str);

        let response = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "choice": decision
            }
        })
        .to_string();

        let _ = tx_out.send(response);
    });
}

async fn handle_clarify_request(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    tx_outgoing: &mpsc::UnboundedSender<String>,
    id_val: Option<Value>,
    params: Value,
) {
    let Some(id) = id_val else { return };
    let req_id_str = match &id {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => "req".to_string(),
    };

    let session_id = params.get("session_id").and_then(Value::as_str).unwrap_or_default().to_string();
    let questions_arr = params.get("questions").and_then(Value::as_array);

    let mut questions = Vec::new();
    if let Some(arr) = questions_arr {
        for q in arr {
            let qid = q.get("qid").and_then(Value::as_str).unwrap_or_default().to_string();
            let question = q.get("question").and_then(Value::as_str).unwrap_or_default().to_string();
            let multi_select = q.get("multi_select").and_then(Value::as_bool).unwrap_or(false);
            let choices = q.get("choices").and_then(Value::as_array).map(|c_arr| {
                c_arr.iter().filter_map(Value::as_str).map(str::to_string).collect()
            });

            questions.push(ClarifyQuestion {
                qid,
                question,
                choices,
                multi_select,
            });
        }
    }

    let (tx_answers, rx_answers) = oneshot::channel::<Value>();
    state.pending_clarifies.lock().unwrap().insert(req_id_str.clone(), tx_answers);

    let payload = ClarifyPayload {
        request_id: req_id_str.clone(),
        session_id,
        questions,
    };

    let _ = app.emit_to(WINDOW_LABEL, "hermes-clarify", payload);

    let tx_out = tx_outgoing.clone();
    let pending_map = state.pending_clarifies.clone();

    tauri::async_runtime::spawn(async move {
        let answers = match tokio::time::timeout(Duration::from_secs(300), rx_answers).await {
            Ok(Ok(ans)) => ans,
            _ => json!({}),
        };

        pending_map.lock().unwrap().remove(&req_id_str);

        let response = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "answers": answers
            }
        })
        .to_string();

        let _ = tx_out.send(response);
    });
}

fn base64_simple(input: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i < input.len() {
        let b0 = input[i] as u32;
        let b1 = if i + 1 < input.len() { input[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < input.len() { input[i + 2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(CHARSET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(CHARSET[((triple >> 12) & 0x3F) as usize] as char);

        if i + 1 < input.len() {
            out.push(CHARSET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }

        if i + 2 < input.len() {
            out.push(CHARSET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }

        i += 3;
    }
    out
}
