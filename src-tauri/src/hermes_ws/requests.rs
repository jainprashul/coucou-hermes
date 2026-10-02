// Request handling and approval/clarify dialog helpers for Hermes WebSocket connection.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

use crate::events;
use crate::hermes_ws::HermesClientState;
use crate::island::WINDOW_LABEL;
use crate::log;
use super::incoming::json_rpc_id_string;

pub const APPROVAL_TIMEOUT_SECS: u64 = 108;
pub const CLARIFY_TIMEOUT_SECS: u64 = 300;
pub const ACK_TIMEOUT_MS: u64 = 800;

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

/// Normalize approval response choice string (e.g. "allow" -> "once").
pub fn normalize_approval_choice(choice: &str) -> &str {
    match choice {
        "allow" => "once",
        other => other,
    }
}

/// Build primary JSON-RPC notification acknowledgment for approval request.
pub fn build_approval_ack_frame(id: &Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "method": "approval_ack",
        "params": {
            "id": id,
            "ok": true
        }
    })
    .to_string()
}

/// Build secondary JSON-RPC ack keyed by request_id (compatible fallback).
pub fn build_approval_ack2_frame(id: &Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "method": "approval.ack",
        "params": { "request_id": id, "ok": true }
    })
    .to_string()
}

/// Send both approval ack frames immediately to satisfy ACK_TIMEOUT_MS budget.
pub fn send_approval_ack(tx: &mpsc::UnboundedSender<String>, id: &Value) {
    // Spec: acknowledge within 800ms so the gateway knows a UI is alive.
    // Prefer a lightweight notification the gateway can ignore if unused.
    let _ = tx.send(build_approval_ack_frame(id));
    // Also try JSON-RPC progress-style ack keyed by request id (compatible fallback).
    let _ = tx.send(build_approval_ack2_frame(id));
    let _ = ACK_TIMEOUT_MS; // documented budget — ack is sent immediately
}

/// Build JSON-RPC response frame for approval decision.
pub fn build_approval_response_frame(id: &Value, decision: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "choice": decision
        }
    })
    .to_string()
}

/// Parse parameters from an approval request into ApprovalPayload.
pub fn parse_approval_payload(req_id_str: String, params: &Value) -> ApprovalPayload {
    let nested = params
        .get("params")
        .cloned()
        .unwrap_or_else(|| params.clone());
    let body = if nested.get("command").is_some() || nested.get("tool_name").is_some() {
        nested
    } else {
        params.clone()
    };

    let session_id = body
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let command = body
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let description = body
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_name = body
        .get("tool_name")
        .and_then(Value::as_str)
        .map(str::to_string);
    let choices = body
        .get("choices")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_else(|| vec!["once".into(), "always".into(), "deny".into()]);

    ApprovalPayload {
        request_id: req_id_str,
        session_id,
        command,
        description,
        tool_name,
        choices,
    }
}

/// Handle incoming approval request from server: ack, remember session, emit to UI, and await decision.
pub async fn handle_approval_request(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    tx_outgoing: &mpsc::UnboundedSender<String>,
    id_val: Option<Value>,
    params: Value,
) {
    let Some(id) = id_val else {
        log::line("hermes approval request missing id — ignored");
        return;
    };
    let req_id_str = json_rpc_id_string(&id);

    // Acknowledge immediately (within ACK_TIMEOUT_MS budget).
    send_approval_ack(tx_outgoing, &id);
    log::line(format!("hermes approval_ack sent for {req_id_str}"));

    let payload = parse_approval_payload(req_id_str.clone(), &params);
    state.remember_session_id(&payload.session_id);

    let (tx_decision, rx_decision) = oneshot::channel::<String>();
    state
        .pending_approvals
        .lock()
        .unwrap()
        .insert(req_id_str.clone(), tx_decision);

    let _ = app.emit_to(WINDOW_LABEL, events::HERMES_APPROVAL, payload);

    let tx_out = tx_outgoing.clone();
    let pending_map = state.pending_approvals.clone();

    tauri::async_runtime::spawn(async move {
        let decision = match tokio::time::timeout(Duration::from_secs(APPROVAL_TIMEOUT_SECS), rx_decision).await {
            Ok(Ok(d)) => d,
            _ => "deny".to_string(),
        };

        pending_map.lock().unwrap().remove(&req_id_str);
        log::line(format!("hermes approval reply {req_id_str} → {decision}"));

        let response = build_approval_response_frame(&id, &decision);
        let _ = tx_out.send(response);
    });
}

/// Build JSON-RPC ack frame for clarify request.
pub fn build_clarify_ack_frame(id: &Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "method": "clarify.ack",
        "params": { "request_id": id.clone(), "ok": true }
    })
    .to_string()
}

/// Send clarify acknowledgment frame.
pub fn send_clarify_ack(tx: &mpsc::UnboundedSender<String>, id: &Value) {
    let _ = tx.send(build_clarify_ack_frame(id));
}

/// Build JSON-RPC response frame for clarify answer.
pub fn build_clarify_response_frame(id: &Value, answers: &Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "answers": answers
        }
    })
    .to_string()
}

/// Parse parameters from a clarify request into ClarifyPayload.
pub fn parse_clarify_payload(req_id_str: String, params: &Value) -> ClarifyPayload {
    let nested = params
        .get("params")
        .cloned()
        .unwrap_or_else(|| params.clone());
    let body = if nested.get("questions").is_some() {
        nested
    } else {
        params.clone()
    };

    let session_id = body
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let questions_arr = body.get("questions").and_then(Value::as_array);

    let mut questions = Vec::new();
    if let Some(arr) = questions_arr {
        for q in arr {
            let qid = q
                .get("qid")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let question = q
                .get("question")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let multi_select = q
                .get("multi_select")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let choices = q.get("choices").and_then(Value::as_array).map(|c_arr| {
                c_arr
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            });

            questions.push(ClarifyQuestion {
                qid,
                question,
                choices,
                multi_select,
            });
        }
    }

    ClarifyPayload {
        request_id: req_id_str,
        session_id,
        questions,
    }
}

/// Handle incoming clarify request from server: ack, remember session, emit to UI, and await answers.
pub async fn handle_clarify_request(
    app: &AppHandle,
    state: &Arc<HermesClientState>,
    tx_outgoing: &mpsc::UnboundedSender<String>,
    id_val: Option<Value>,
    params: Value,
) {
    let Some(id) = id_val else {
        log::line("hermes clarify request missing id — ignored");
        return;
    };
    let req_id_str = json_rpc_id_string(&id);

    // Lightweight ack so gated gateways know a UI is listening.
    send_clarify_ack(tx_outgoing, &id);
    log::line(format!("hermes clarify.ack sent for {req_id_str}"));

    let payload = parse_clarify_payload(req_id_str.clone(), &params);
    state.remember_session_id(&payload.session_id);

    let (tx_answers, rx_answers) = oneshot::channel::<Value>();
    state
        .pending_clarifies
        .lock()
        .unwrap()
        .insert(req_id_str.clone(), tx_answers);

    let _ = app.emit_to(WINDOW_LABEL, events::HERMES_CLARIFY, payload);

    let tx_out = tx_outgoing.clone();
    let pending_map = state.pending_clarifies.clone();

    tauri::async_runtime::spawn(async move {
        let answers = match tokio::time::timeout(Duration::from_secs(CLARIFY_TIMEOUT_SECS), rx_answers).await {
            Ok(Ok(ans)) => ans,
            _ => json!({}),
        };

        pending_map.lock().unwrap().remove(&req_id_str);
        log::line(format!("hermes clarify reply {req_id_str}"));

        let response = build_clarify_response_frame(&id, &answers);
        let _ = tx_out.send(response);
    });
}

/// Answer or dispatch an approval decision. Returns true if sent or resolved.
pub fn decide_approval(state: &HermesClientState, request_id: &str, choice: &str) -> bool {
    let gateway_choice = normalize_approval_choice(choice);
    if let Some(tx) = state.pending_approvals.lock().unwrap().remove(request_id) {
        let _ = tx.send(gateway_choice.to_string());
        return true;
    }
    state.send_rpc_request(
        "approval.respond",
        json!({
            "request_id": request_id,
            "choice": gateway_choice,
        }),
    )
}

/// Answer or dispatch clarify responses. Returns true if sent or resolved.
pub fn answer_clarify(state: &HermesClientState, request_id: &str, answers: Value) -> bool {
    if let Some(tx) = state.pending_clarifies.lock().unwrap().remove(request_id) {
        let _ = tx.send(answers);
        return true;
    }
    state.send_rpc_request(
        "clarify.respond",
        json!({
            "request_id": request_id,
            "answer": answers,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_approval_choice() {
        assert_eq!(normalize_approval_choice("allow"), "once");
        assert_eq!(normalize_approval_choice("once"), "once");
        assert_eq!(normalize_approval_choice("always"), "always");
        assert_eq!(normalize_approval_choice("deny"), "deny");
        assert_eq!(normalize_approval_choice("other"), "other");
    }

    #[test]
    fn test_parse_approval_payload_flat() {
        let params = json!({
            "session_id": "sid-1",
            "command": "cargo test",
            "description": "Run tests",
            "tool_name": "bash",
            "choices": ["once", "deny"]
        });
        let payload = parse_approval_payload("req-1".into(), &params);
        assert_eq!(payload.request_id, "req-1");
        assert_eq!(payload.session_id, "sid-1");
        assert_eq!(payload.command, "cargo test");
        assert_eq!(payload.description, "Run tests");
        assert_eq!(payload.tool_name.as_deref(), Some("bash"));
        assert_eq!(payload.choices, vec!["once", "deny"]);
    }

    #[test]
    fn test_parse_approval_payload_nested() {
        let params = json!({
            "params": {
                "session_id": "sid-2",
                "command": "rm -rf /tmp/foo",
                "description": "Clean tmp"
            }
        });
        let payload = parse_approval_payload("req-2".into(), &params);
        assert_eq!(payload.session_id, "sid-2");
        assert_eq!(payload.command, "rm -rf /tmp/foo");
        assert_eq!(payload.tool_name, None);
        assert_eq!(payload.choices, vec!["once", "always", "deny"]);
    }

    #[test]
    fn test_build_approval_frames() {
        let id = json!(42);
        let ack1 = build_approval_ack_frame(&id);
        let val1: Value = serde_json::from_str(&ack1).unwrap();
        assert_eq!(val1["method"], "approval_ack");
        assert_eq!(val1["params"]["id"], 42);

        let ack2 = build_approval_ack2_frame(&id);
        let val2: Value = serde_json::from_str(&ack2).unwrap();
        assert_eq!(val2["method"], "approval.ack");
        assert_eq!(val2["params"]["request_id"], 42);

        let resp = build_approval_response_frame(&id, "always");
        let val_resp: Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(val_resp["id"], 42);
        assert_eq!(val_resp["result"]["choice"], "always");
    }

    #[test]
    fn test_parse_clarify_payload_and_frames() {
        let params = json!({
            "session_id": "sid-3",
            "questions": [
                {
                    "qid": "q1",
                    "question": "Which branch?",
                    "choices": ["main", "dev"],
                    "multi_select": false
                }
            ]
        });
        let payload = parse_clarify_payload("req-3".into(), &params);
        assert_eq!(payload.session_id, "sid-3");
        assert_eq!(payload.questions.len(), 1);
        assert_eq!(payload.questions[0].qid, "q1");
        assert_eq!(payload.questions[0].question, "Which branch?");
        assert_eq!(payload.questions[0].choices, Some(vec!["main".into(), "dev".into()]));
        assert!(!payload.questions[0].multi_select);

        let id = json!("clarify-req-99");
        let ack = build_clarify_ack_frame(&id);
        let val_ack: Value = serde_json::from_str(&ack).unwrap();
        assert_eq!(val_ack["method"], "clarify.ack");
        assert_eq!(val_ack["params"]["request_id"], "clarify-req-99");

        let resp = build_clarify_response_frame(&id, &json!({ "q1": "main" }));
        let val_resp: Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(val_resp["id"], "clarify-req-99");
        assert_eq!(val_resp["result"]["answers"]["q1"], "main");
    }

    #[test]
    fn test_decide_approval_channel() {
        let state = HermesClientState::default();
        let (tx, rx) = oneshot::channel();
        state.pending_approvals.lock().unwrap().insert("test-req".into(), tx);

        let resolved = decide_approval(&state, "test-req", "allow");
        assert!(resolved);
        assert_eq!(rx.blocking_recv().unwrap(), "once");
    }

    #[test]
    fn test_answer_clarify_channel() {
        let state = HermesClientState::default();
        let (tx, rx) = oneshot::channel();
        state.pending_clarifies.lock().unwrap().insert("test-clarify".into(), tx);

        let answers = json!({ "ans": 123 });
        let resolved = answer_clarify(&state, "test-clarify", answers.clone());
        assert!(resolved);
        assert_eq!(rx.blocking_recv().unwrap(), answers);
    }
}
