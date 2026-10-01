// Hermes HTTP API Client (:8642/v1)
//
// Interacts with Hermes Agent OpenAI-compatible HTTP API server:
//   - POST /v1/chat/completions with streaming SSE
//   - GET /v1/capabilities
//   - Run control & direct execution

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;

#[derive(Default)]
pub struct HermesChatSession {
    messages: Mutex<Vec<Value>>,
}

impl HermesChatSession {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
    }

    pub fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }

    pub fn push(&self, msg: Value) {
        self.messages.lock().unwrap().push(msg);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
}

pub async fn chat_send(
    chat: &HermesChatSession,
    api_url: &str,
    api_key: Option<&str>,
    prompt: String,
) -> Result<ChatReply, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let base = api_url.trim_end_matches('/');
    let endpoint = if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    };

    chat.push(json!({
        "role": "user",
        "content": prompt
    }));

    let mut body = json!({
        "model": "hermes-agent",
        "messages": chat.snapshot(),
        "stream": false
    });

    let mut req = client.post(&endpoint).json(&body);
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {key}"));
        }
    }

    let resp = req.send().await.map_err(|e| format!("Network error: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Hermes API {status}: {text}"));
    }

    let val: Value = serde_json::from_str(&text).map_err(|e| format!("Bad JSON: {e}"))?;
    let content = val
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if content.is_empty() {
        return Err("Empty response from Hermes".to_string());
    }

    chat.push(json!({
        "role": "assistant",
        "content": content.clone()
    }));

    Ok(ChatReply { text: content })
}
