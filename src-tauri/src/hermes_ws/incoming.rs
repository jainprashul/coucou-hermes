// Pure incoming frame classification and parsing helpers for Hermes gateway protocol.

use serde_json::Value;

use crate::hermes_ws::HermesClientState;

pub fn server_request_kind(params: &Value) -> Option<&'static str> {
    let ty = params
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| params.get("method").and_then(Value::as_str))
        .or_else(|| params.get("request").and_then(Value::as_str))?;
    match ty {
        "approval" => Some("approval"),
        "clarify" => Some("clarify"),
        _ => None,
    }
}

pub fn frame_is_gateway_ready(val: &Value) -> bool {
    if val.get("method").and_then(Value::as_str) == Some("gateway.ready") {
        return true;
    }
    event_type_from_frame(val).map(|t| t == "gateway.ready").unwrap_or(false)
}

pub fn event_type_from_frame(val: &Value) -> Option<&str> {
    let params = val.get("params")?;
    if val.get("method").and_then(Value::as_str) == Some("event") {
        return params.get("type").and_then(Value::as_str);
    }
    params.get("type").and_then(Value::as_str)
}

pub fn json_rpc_id_string(id: &Value) -> String {
    match id {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => "req".to_string(),
    }
}

pub fn extract_session_ids_from_value(val: &Value) -> Vec<&str> {
    let candidates = [
        val.get("session_id").and_then(Value::as_str),
        val.get("params")
            .and_then(|p| p.get("session_id"))
            .and_then(Value::as_str),
        val.get("params")
            .and_then(|p| p.get("payload"))
            .and_then(|p| p.get("session_id"))
            .and_then(Value::as_str),
        val.get("result")
            .and_then(|p| p.get("session_id"))
            .and_then(Value::as_str),
    ];
    candidates.into_iter().flatten().collect()
}

pub fn remember_session_from_value(state: &HermesClientState, val: &Value) {
    for sid in extract_session_ids_from_value(val) {
        state.remember_session_id(sid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_server_request_kind() {
        assert_eq!(server_request_kind(&json!({ "type": "approval" })), Some("approval"));
        assert_eq!(server_request_kind(&json!({ "method": "clarify" })), Some("clarify"));
        assert_eq!(server_request_kind(&json!({ "request": "approval" })), Some("approval"));
        assert_eq!(server_request_kind(&json!({ "type": "other" })), None);
        assert_eq!(server_request_kind(&json!({})), None);
    }

    #[test]
    fn test_frame_is_gateway_ready() {
        assert!(frame_is_gateway_ready(&json!({ "method": "gateway.ready" })));
        assert!(frame_is_gateway_ready(&json!({ "method": "event", "params": { "type": "gateway.ready" } })));
        assert!(frame_is_gateway_ready(&json!({ "params": { "type": "gateway.ready" } })));
        assert!(!frame_is_gateway_ready(&json!({ "method": "gateway.ping" })));
    }

    #[test]
    fn test_event_type_from_frame() {
        assert_eq!(event_type_from_frame(&json!({ "method": "event", "params": { "type": "tool.start" } })), Some("tool.start"));
        assert_eq!(event_type_from_frame(&json!({ "params": { "type": "agent.thought" } })), Some("agent.thought"));
        assert_eq!(event_type_from_frame(&json!({ "params": {} })), None);
        assert_eq!(event_type_from_frame(&json!({})), None);
    }

    #[test]
    fn test_json_rpc_id_string() {
        assert_eq!(json_rpc_id_string(&json!("custom-id-123")), "custom-id-123");
        assert_eq!(json_rpc_id_string(&json!(42)), "42");
        assert_eq!(json_rpc_id_string(&json!(null)), "req");
        assert_eq!(json_rpc_id_string(&json!({"foo": "bar"})), "req");
    }

    #[test]
    fn test_extract_session_ids_from_value() {
        let v1 = json!({ "session_id": "sid1" });
        assert_eq!(extract_session_ids_from_value(&v1), vec!["sid1"]);

        let v2 = json!({ "params": { "session_id": "sid2" } });
        assert_eq!(extract_session_ids_from_value(&v2), vec!["sid2"]);

        let v3 = json!({ "params": { "payload": { "session_id": "sid3" } } });
        assert_eq!(extract_session_ids_from_value(&v3), vec!["sid3"]);

        let v4 = json!({ "result": { "session_id": "sid4" } });
        assert_eq!(extract_session_ids_from_value(&v4), vec!["sid4"]);
    }
}
