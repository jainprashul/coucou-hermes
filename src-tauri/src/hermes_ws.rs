// Hermes WebSocket Gateway Client
//
// Connects to Hermes Agent Gateway (`ws://<host>:9119/api/ws`) over Tailscale/LAN.
// Handles JSON-RPC 2.0 two-way communication:
//   - capabilities handshake (`server_requests: true`)
//   - session.resume / session.list
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
use tokio_tungstenite::tungstenite::Message;

use crate::events;
use crate::island::WINDOW_LABEL;
use crate::log;

#[path = "hermes_ws/mod.rs"]
pub mod helpers;

pub use helpers::*;

const RECONNECT_BASE_MS: u64 = 1000;
const RECONNECT_MAX_MS: u64 = 10000;
const PING_INTERVAL_SECS: u64 = 15;
const CONNECT_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub host: String,
    pub last_error: Option<String>,
}

pub struct HermesClientState {
    pub(crate) tx_outgoing: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pub(crate) pending_approvals: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    pub(crate) pending_clarifies: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    pub(crate) is_connected: AtomicBool,
    pub(crate) active_host: Mutex<String>,
    pub(crate) last_error: Mutex<Option<String>>,
    pub(crate) counter: AtomicU64,
    /// Bumped on every `start_gateway_connection` so older reconnect loops exit.
    pub(crate) generation: AtomicU64,
    pub(crate) loop_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub(crate) last_session_id: Mutex<Option<String>>,
    pub(crate) pending_list_id: Mutex<Option<u64>>,
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
            generation: AtomicU64::new(0),
            loop_task: Mutex::new(None),
            last_session_id: Mutex::new(None),
            pending_list_id: Mutex::new(None),
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

    pub fn remember_session_id(&self, session_id: &str) {
        if session_id.is_empty() {
            return;
        }
        *self.last_session_id.lock().unwrap() = Some(session_id.to_string());
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
        helpers::requests::decide_approval(self, request_id, choice)
    }

    pub fn answer_clarify(&self, request_id: &str, answers: Value) -> bool {
        helpers::requests::answer_clarify(self, request_id, answers)
    }
}

/// Start (or restart) the gateway reconnect loop. Cancels any previous loop.
pub fn start_gateway_connection(
    app: AppHandle,
    state: Arc<HermesClientState>,
    url: String,
    auth_user: Option<String>,
    auth_pass: Option<String>,
) {
    // Cancel prior loop if any.
    if let Some(prev) = state.loop_task.lock().unwrap().take() {
        log::line("hermes cancelling previous reconnect loop");
        prev.abort();
    }

    let gen = state.generation.fetch_add(1, Ordering::Relaxed) + 1;
    *state.active_host.lock().unwrap() = url.clone();

    let state_for_loop = state.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let state = state_for_loop;
        let mut backoff = RECONNECT_BASE_MS;

        loop {
            if state.generation.load(Ordering::Relaxed) != gen {
                log::line(format!("hermes reconnect loop gen={gen} exiting (superseded)"));
                break;
            }

            log::line(format!("hermes connecting gen={gen} to {url}"));
            *state.last_error.lock().unwrap() = None;

            match connect_and_run(
                &app,
                &state,
                gen,
                &url,
                auth_user.as_deref(),
                auth_pass.as_deref(),
            )
            .await
            {
                Ok(()) => {
                    log::line(format!("hermes gateway connection closed normally gen={gen}"));
                    backoff = RECONNECT_BASE_MS;
                }
                Err(err) => {
                    let msg = format!("hermes connection error gen={gen}: {err}");
                    log::line(msg.clone());
                    *state.last_error.lock().unwrap() = Some(msg);
                }
            }

            if state.generation.load(Ordering::Relaxed) != gen {
                break;
            }

            state.is_connected.store(false, Ordering::Relaxed);
            let _ = app.emit(events::HERMES_STATUS, state.status());

            tokio::time::sleep(Duration::from_millis(backoff)).await;
            backoff = (backoff * 2).min(RECONNECT_MAX_MS);
        }
    });

    *state.loop_task.lock().unwrap() = Some(handle);
}

async fn connect_and_run(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    gen: u64,
    url_str: &str,
    auth_user: Option<&str>,
    auth_pass: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let req = build_ws_request(url_str, auth_user, auth_pass, gen).await?;

    log::line(format!("hermes ws handshake gen={gen} (timeout {CONNECT_TIMEOUT_SECS}s)"));
    let (ws_stream, _) = tokio::time::timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        connect_async(req),
    )
    .await
    .map_err(|_| format!("websocket connect timed out after {CONNECT_TIMEOUT_SECS}s"))??;
    let (mut write, mut read) = ws_stream.split();

    *state.last_error.lock().unwrap() = None;
    state.is_connected.store(true, Ordering::Relaxed);
    log::line(format!("hermes connected gen={gen}"));
    let _ = app.emit(events::HERMES_STATUS, state.status());

    let (tx_outgoing, mut rx_outgoing) = mpsc::unbounded_channel::<String>();
    *state.tx_outgoing.lock().unwrap() = Some(tx_outgoing.clone());

    // Capabilities immediately (also re-sent after gateway.ready).
    send_capabilities(&tx_outgoing, state);
    log::line(format!("hermes client.capabilities sent gen={gen}"));

    // Session subscribe / resume promptly so we don't wait forever for ready.
    send_session_handshake(&tx_outgoing, state);
    log::line(format!("hermes session handshake sent gen={gen}"));

    let mut ping_interval = tokio::time::interval(Duration::from_secs(PING_INTERVAL_SECS));
    let mut saw_ready = false;

    loop {
        if state.generation.load(Ordering::Relaxed) != gen {
            log::line(format!("hermes connection loop gen={gen} aborted (superseded)"));
            break;
        }

        tokio::select! {
            _ = ping_interval.tick() => {
                let ping_frame = json!({
                    "jsonrpc": "2.0",
                    "method": "gateway.ping",
                    "id": state.counter.fetch_add(1, Ordering::Relaxed)
                }).to_string();
                if write.send(Message::Text(ping_frame)).await.is_err() {
                    log::line(format!("hermes ping send failed gen={gen}"));
                    break;
                }
            }
            Some(msg_text) = rx_outgoing.recv() => {
                if write.send(Message::Text(msg_text)).await.is_err() {
                    log::line(format!("hermes outgoing send failed gen={gen}"));
                    break;
                }
            }
            msg = read.next() => {
                let Some(msg) = msg else {
                    log::line(format!("hermes ws read ended gen={gen}"));
                    break;
                };
                let msg = msg?;
                match msg {
                    Message::Text(text) => {
                        let became_ready = handle_incoming_text(
                            app, state, &tx_outgoing, &text, saw_ready,
                        ).await;
                        if became_ready && !saw_ready {
                            saw_ready = true;
                            log::line(format!("hermes gateway.ready gen={gen}"));
                            // Re-assert caps + session after ready per SPEC handshake order.
                            send_capabilities(&tx_outgoing, state);
                            send_session_handshake(&tx_outgoing, state);
                        }
                    }
                    Message::Ping(data) => {
                        let _ = write.send(Message::Pong(data)).await;
                    }
                    Message::Close(frame) => {
                        log::line(format!("hermes ws close gen={gen}: {frame:?}"));
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

fn send_capabilities(tx: &mpsc::UnboundedSender<String>, state: &HermesClientState) {
    let caps_id = state.counter.fetch_add(1, Ordering::Relaxed);
    let caps_frame = build_capabilities_frame(caps_id).to_string();
    let _ = tx.send(caps_frame);
}

fn send_session_handshake(tx: &mpsc::UnboundedSender<String>, state: &HermesClientState) {
    let id = state.counter.fetch_add(1, Ordering::Relaxed);
    let session_id = state.last_session_id.lock().unwrap().clone();
    if session_id.is_none() {
        *state.pending_list_id.lock().unwrap() = Some(id);
    }
    let frame = build_session_handshake_frame(id, session_id.as_deref()).to_string();
    let _ = tx.send(frame);
}

/// Returns true if this frame was (or contained) `gateway.ready`.
async fn handle_incoming_text(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    tx_outgoing: &mpsc::UnboundedSender<String>,
    text: &str,
    _already_ready: bool,
) -> bool {
    let Ok(val) = serde_json::from_str::<Value>(text) else {
        return false;
    };

    remember_session_from_value(state, &val);

    // If this is the result of our fallback session.list request, resume the most recent session.
    let id_opt = val
        .get("id")
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok())));
    if let Some(id) = id_opt {
        let is_list_reply = {
            let mut pending = state.pending_list_id.lock().unwrap();
            if *pending == Some(id) {
                *pending = None;
                true
            } else {
                false
            }
        };

        if is_list_reply {
            if let Some(result_obj) = val.get("result") {
                if let Some(sid) = pick_recent_session_id(result_obj) {
                    state.remember_session_id(&sid);
                    log::line(format!("hermes resumed session from session.list: {sid}"));
                    let resume_id = state.counter.fetch_add(1, Ordering::Relaxed);
                    let resume_frame = json!({
                        "jsonrpc": "2.0",
                        "method": "session.resume",
                        "params": { "session_id": sid },
                        "id": resume_id
                    })
                    .to_string();
                    let _ = tx_outgoing.send(resume_frame);
                }
            }
        }
    }

    let mut saw_ready = frame_is_gateway_ready(&val);

    if let Some(method) = val.get("method").and_then(Value::as_str) {
        let id_val = val.get("id").cloned();
        let params = val.get("params").cloned().unwrap_or(Value::Null);

        let request_kind = match method {
            "approval" => Some("approval"),
            "clarify" => Some("clarify"),
            "server_request" => server_request_kind(&params),
            _ => None,
        };

        if let Some(kind) = request_kind {
            match kind {
                "approval" => {
                    handle_approval_request(app, state, tx_outgoing, id_val, params).await;
                    return saw_ready;
                }
                "clarify" => {
                    handle_clarify_request(app, state, tx_outgoing, id_val, params).await;
                    return saw_ready;
                }
                _ => {}
            }
        }

        if method == "gateway.ping" {
            if let Some(id) = id_val {
                let pong = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "ok": true }
                })
                .to_string();
                let _ = tx_outgoing.send(pong);
            }
            return saw_ready;
        }
    }

    // Event notifications (and unknown methods) go to the island.
    if !saw_ready {
        saw_ready = event_type_from_frame(&val)
            .map(|t| t == "gateway.ready")
            .unwrap_or(false);
    }
    let _ = app.emit_to(WINDOW_LABEL, events::HERMES_EVENT, val);
    saw_ready
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capabilities_frame_params_only_server_requests() {
        let frame = build_capabilities_frame(1);
        assert_eq!(frame.get("jsonrpc").and_then(Value::as_str), Some("2.0"));
        assert_eq!(frame.get("method").and_then(Value::as_str), Some("client.capabilities"));
        assert_eq!(frame.get("id").and_then(Value::as_u64), Some(1));

        let params = frame.get("params").and_then(Value::as_object).expect("params is object");
        assert_eq!(params.len(), 1, "params must contain exactly one key");
        assert_eq!(params.get("server_requests"), Some(&Value::Bool(true)));
        assert_eq!(params.get("tool_progress"), None);
        assert_eq!(params.get("subagent_tree"), None);
    }

    #[test]
    fn test_send_capabilities_serialized_frame() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let state = HermesClientState::default();
        send_capabilities(&tx, &state);

        let raw = rx.try_recv().expect("send_capabilities should send a frame");
        let val: Value = serde_json::from_str(&raw).expect("valid json");

        assert_eq!(val["jsonrpc"], "2.0");
        assert_eq!(val["method"], "client.capabilities");
        let params = val["params"].as_object().expect("params object");
        assert_eq!(params.len(), 1);
        assert_eq!(params.get("server_requests"), Some(&Value::Bool(true)));
        assert_eq!(params.get("tool_progress"), None);
        assert_eq!(params.get("subagent_tree"), None);
    }

    #[test]
    fn test_fallback_session_handshake_is_session_list() {
        let frame = build_session_handshake_frame(2, None);
        assert_eq!(frame.get("jsonrpc").and_then(Value::as_str), Some("2.0"));
        assert_eq!(frame.get("method").and_then(Value::as_str), Some("session.list"));
        assert_ne!(frame.get("method").and_then(Value::as_str), Some("session.subscribe"));
        let params = frame.get("params").and_then(Value::as_object).expect("params is object");
        assert!(params.is_empty(), "fallback params should be empty");
    }

    #[test]
    fn test_send_session_handshake_fallback_and_resume() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let state = HermesClientState::default();

        // 1. Fallback when session_id is None: sends session.list and records pending_list_id
        send_session_handshake(&tx, &state);
        let raw_fallback = rx.try_recv().expect("handshake frame sent");
        let val_fallback: Value = serde_json::from_str(&raw_fallback).expect("valid json");

        assert_eq!(val_fallback["method"], "session.list");
        assert_ne!(val_fallback["method"], "session.subscribe");
        let params = val_fallback["params"].as_object().expect("params object");
        assert!(params.is_empty(), "fallback params should be empty");
        let list_id = val_fallback["id"].as_u64().unwrap();
        assert_eq!(*state.pending_list_id.lock().unwrap(), Some(list_id));

        // 2. Known session_id path: sends session.resume
        state.remember_session_id("sess-abc-123");
        send_session_handshake(&tx, &state);
        let raw_resume = rx.try_recv().expect("resume frame sent");
        let val_resume: Value = serde_json::from_str(&raw_resume).expect("valid json");

        assert_eq!(val_resume["method"], "session.resume");
        assert_ne!(val_resume["method"], "session.subscribe");
        assert_eq!(val_resume["params"]["session_id"], "sess-abc-123");
    }

    #[test]
    fn test_pick_recent_session_id() {
        // Non-ended sessions with timestamps
        let result = json!({
            "sessions": [
                { "id": "s_old", "last_active": 100.0 },
                { "id": "s_ended", "ended_at": 500.0, "last_active": 400.0 },
                { "id": "s_new", "last_active": 300.0 }
            ]
        });
        assert_eq!(pick_recent_session_id(&result).as_deref(), Some("s_new"));

        // Live gateway format without ended_at or last_active
        let result_live = json!({
            "sessions": [
                { "id": "20261002_104227_d70b0d6b", "title": "Run Hermes hook", "started_at": 1790952147.97 },
                { "id": "api-414ed9885e13e61f", "title": "Other", "started_at": 1790950000.0 }
            ]
        });
        assert_eq!(pick_recent_session_id(&result_live).as_deref(), Some("20261002_104227_d70b0d6b"));

        // All ended sessions fall back to the first
        let result_all_ended = json!({
            "sessions": [
                { "id": "s_ended_1", "ended_at": 100 },
                { "id": "s_ended_2", "ended_at": 200 }
            ]
        });
        assert_eq!(pick_recent_session_id(&result_all_ended).as_deref(), Some("s_ended_1"));

        // Empty sessions
        let result_empty = json!({ "sessions": [] });
        assert_eq!(pick_recent_session_id(&result_empty), None);
    }
}
