// Pure frame builder helpers for Hermes gateway protocol.

use serde_json::{json, Value};

/// Build the JSON-RPC frame advertising client capabilities.
/// Only `server_requests: true` is advertised.
pub fn build_capabilities_frame(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "client.capabilities",
        "params": {
            "server_requests": true
        },
        "id": id
    })
}

/// Build the session handshake frame: `session.resume` if `session_id` is given,
/// or fallback `session.list` if `session_id` is `None`.
pub fn build_session_handshake_frame(id: u64, session_id: Option<&str>) -> Value {
    if let Some(sid) = session_id {
        json!({
            "jsonrpc": "2.0",
            "method": "session.resume",
            "params": { "session_id": sid },
            "id": id
        })
    } else {
        json!({
            "jsonrpc": "2.0",
            "method": "session.list",
            "params": {},
            "id": id
        })
    }
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
    fn test_fallback_session_handshake_is_session_list() {
        let frame = build_session_handshake_frame(2, None);
        assert_eq!(frame.get("jsonrpc").and_then(Value::as_str), Some("2.0"));
        assert_eq!(frame.get("method").and_then(Value::as_str), Some("session.list"));
        assert_ne!(frame.get("method").and_then(Value::as_str), Some("session.subscribe"));
        let params = frame.get("params").and_then(Value::as_object).expect("params is object");
        assert!(params.is_empty(), "fallback params should be empty");
    }

    #[test]
    fn test_resume_session_handshake_frame() {
        let frame = build_session_handshake_frame(3, Some("sess-xyz-999"));
        assert_eq!(frame.get("jsonrpc").and_then(Value::as_str), Some("2.0"));
        assert_eq!(frame.get("method").and_then(Value::as_str), Some("session.resume"));
        assert_eq!(frame.get("id").and_then(Value::as_u64), Some(3));
        assert_eq!(frame["params"]["session_id"], "sess-xyz-999");
    }
}
