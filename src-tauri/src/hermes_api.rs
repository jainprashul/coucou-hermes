// Hermes HTTP API Client (:8642/v1)
//
// Interacts with Hermes Agent OpenAI-compatible HTTP API server:
//   - POST /v1/chat/completions (non-streaming for Phase A)
//   - Optional file path / small-text attach in the user prompt

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

const MAX_ATTACH_BYTES: u64 = 32 * 1024;

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatFileContext {
    pub name: String,
    pub path: Option<String>,
}

/// Build the user message, optionally appending file path + small text content.
pub fn build_prompt_with_context(prompt: &str, context: Option<&ChatFileContext>) -> String {
    let Some(ctx) = context else {
        return prompt.to_string();
    };
    if ctx.name.is_empty() && ctx.path.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        return prompt.to_string();
    }

    let mut out = String::from(prompt);
    out.push_str("\n\n[Attached file: ");
    out.push_str(if ctx.name.is_empty() { "file" } else { &ctx.name });
    out.push(']');
    if let Some(path) = ctx.path.as_ref().filter(|p| !p.is_empty()) {
        out.push_str("\nPath: ");
        out.push_str(path);

        if let Some(snippet) = read_small_text_attach(path) {
            out.push_str("\n--- file contents ---\n");
            out.push_str(&snippet);
            if !snippet.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("--- end ---");
        }
    }
    out
}

fn read_small_text_attach(path: &str) -> Option<String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > MAX_ATTACH_BYTES {
        return None;
    }
    let bytes = std::fs::read(p).ok()?;
    // Reject obviously binary payloads (NUL in first 512 bytes).
    let probe = &bytes[..bytes.len().min(512)];
    if probe.contains(&0) {
        return None;
    }
    let text = String::from_utf8_lossy(&bytes);
    // Also skip if too many replacement chars (high binary ratio).
    let bad = text.chars().filter(|c| *c == '\u{FFFD}').count();
    if bad > 8 {
        return None;
    }
    Some(text.into_owned())
}

pub async fn chat_send(
    chat: &HermesChatSession,
    api_url: &str,
    api_key: Option<&str>,
    prompt: String,
    context: Option<ChatFileContext>,
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

    let content = build_prompt_with_context(&prompt, context.as_ref());

    chat.push(json!({
        "role": "user",
        "content": content
    }));

    let body = json!({
        "model": "hermes-agent",
        "messages": chat.snapshot(),
        "stream": false
    });

    let mut req = client.post(&endpoint).json(&body);
    let Some(key) = api_key.filter(|k| !k.is_empty()) else {
        return Err(
            "Hermes API key missing. Set Hermes API key (or gateway password) in Settings."
                .to_string(),
        );
    };
    req = req.header("Authorization", format!("Bearer {key}"));

    let resp = req.send().await.map_err(|e| {
        format!(
            "Can't reach Hermes API at {endpoint} ({e}). Check API Server URL in Settings."
        )
    })?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(
            "Hermes API auth failed. Set Hermes API key in Settings (under Remote Gateway)."
                .to_string(),
        );
    }
    if !status.is_success() {
        let preview = text.chars().take(180).collect::<String>();
        return Err(format!("Hermes API {status}: {preview}"));
    }

    let val: Value = serde_json::from_str(&text).map_err(|e| format!("Bad JSON: {e}"))?;
    let reply_text = val
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if reply_text.is_empty() {
        return Err("Empty response from Hermes".to_string());
    }

    chat.push(json!({
        "role": "assistant",
        "content": reply_text.clone()
    }));

    Ok(ChatReply { text: reply_text })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn prompt_without_context_unchanged() {
        assert_eq!(build_prompt_with_context("hello", None), "hello");
    }

    #[test]
    fn prompt_with_path_and_small_text() {
        let dir = std::env::temp_dir().join(format!("coucou-hermes-chat-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("note.txt");
        {
            let mut f = std::fs::File::create(&path).unwrap();
            write!(f, "alpha beta").unwrap();
        }
        let ctx = ChatFileContext {
            name: "note.txt".into(),
            path: Some(path.to_string_lossy().into_owned()),
        };
        let out = build_prompt_with_context("summarize", Some(&ctx));
        assert!(out.contains("Attached file: note.txt"));
        assert!(out.contains("alpha beta"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
