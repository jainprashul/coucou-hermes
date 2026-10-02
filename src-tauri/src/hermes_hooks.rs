// Hermes outbound webhook receiver — the remote analogue of Claude's named pipe.
//
// Hermes POSTs signed lifecycle events (hooks.outbound in ~/.hermes/config.yaml)
// to Coucou over Tailscale/LAN. We map them onto the same island `hook` events
// Claude Code uses, tagged with coucou_agent=hermes so the UI updates the Hermes
// pill instead of the VS Code one.
//
// Notify-only: outbound webhooks cannot block tools. Approvals still flow over
// the gateway WebSocket (server_request). Permission-style hook events are
// skipped here so we never show a card nobody can answer.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::Sha256;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::events;
use crate::island::WINDOW_LABEL;
use crate::log;
use crate::secrets;

type HmacSha256 = Hmac<Sha256>;

const DEFAULT_PORT: u16 = 19641;
const MAX_BODY: usize = 256 * 1024;
const DEDUPE_CAP: usize = 256;
const STALE_SECS: i64 = 5 * 60;

static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Recent delivery ids so Hermes' single retry does not double-update the island.
struct Dedupe {
    seen: Mutex<VecDeque<String>>,
}

impl Dedupe {
    fn new() -> Self {
        Self {
            seen: Mutex::new(VecDeque::with_capacity(DEDUPE_CAP)),
        }
    }

    fn check_and_insert(&self, id: &str) -> bool {
        if id.is_empty() {
            return true;
        }
        let mut q = self.seen.lock().unwrap();
        if q.iter().any(|x| x == id) {
            return false;
        }
        if q.len() >= DEDUPE_CAP {
            q.pop_front();
        }
        q.push_back(id.to_string());
        true
    }
}

/// Start (or restart) the outbound-webhook listener.
pub fn start(app: AppHandle, port: u16, enabled: bool) {
    let gen = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    if !enabled {
        log::line("hermes-hooks listener disabled");
        return;
    }
    let port = if port == 0 { DEFAULT_PORT } else { port };
    let dedupe = Arc::new(Dedupe::new());
    tauri::async_runtime::spawn(async move {
        if let Err(err) = serve(app, port, gen, dedupe).await {
            log::line(format!("hermes-hooks listener stopped: {err}"));
        }
    });
}

async fn serve(
    app: AppHandle,
    port: u16,
    gen: u64,
    dedupe: Arc<Dedupe>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    log::line(format!(
        "hermes-hooks listening on http://0.0.0.0:{port}/hooks (gen={gen})"
    ));

    loop {
        if GENERATION.load(Ordering::Relaxed) != gen {
            log::line(format!("hermes-hooks gen={gen} superseded"));
            break;
        }
        let (mut stream, peer) = match tokio::time::timeout(
            Duration::from_millis(500),
            listener.accept(),
        )
        .await
        {
            Ok(Ok(pair)) => pair,
            Ok(Err(err)) => return Err(err.into()),
            Err(_) => continue,
        };

        let app = app.clone();
        let dedupe = dedupe.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = handle_connection(&app, &dedupe, &mut stream).await {
                log::line(format!("hermes-hooks {peer}: {err}"));
                let _ = write_response(&mut stream, 400, "bad request").await;
            }
        });
    }
    Ok(())
}

async fn handle_connection(
    app: &AppHandle,
    dedupe: &Dedupe,
    stream: &mut tokio::net::TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 2048];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err("empty request".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buf) {
            header_end = pos;
            break;
        }
        if buf.len() > 16 * 1024 {
            return Err("headers too large".into());
        }
    }

    let header_text = std::str::from_utf8(&buf[..header_end])?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");

    if method != "POST" {
        write_response(stream, 405, "method not allowed").await?;
        return Ok(());
    }
    if !path_ok(path) {
        write_response(stream, 404, "not found").await?;
        return Ok(());
    }

    let mut content_length = 0usize;
    let mut signature = String::new();
    let mut event_header = String::new();
    let mut delivery_header = String::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "content-length" => content_length = value.parse().unwrap_or(0),
            "x-hermes-signature-256" => signature = value.to_string(),
            "x-hermes-event" => event_header = value.to_string(),
            "x-hermes-delivery" => delivery_header = value.to_string(),
            _ => {}
        }
    }

    if content_length == 0 || content_length > MAX_BODY {
        write_response(stream, 413, "payload too large").await?;
        return Ok(());
    }

    let body_start = header_end + 4;
    while buf.len() < body_start + content_length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err("truncated body".into());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body = &buf[body_start..body_start + content_length];

    if let Some(secret) = secrets::get("hermes-webhook-secret") {
        if !verify_signature(body, &signature, &secret) {
            log::line("hermes-hooks bad signature");
            write_response(stream, 401, "invalid signature").await?;
            return Ok(());
        }
    }

    let mut payload: serde_json::Value = serde_json::from_slice(body)?;
    let map = payload
        .as_object_mut()
        .ok_or("payload must be a JSON object")?;

    let delivery_id = map
        .get("delivery_id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(delivery_header);
    if !dedupe.check_and_insert(&delivery_id) {
        write_response(stream, 200, "duplicate").await?;
        return Ok(());
    }

    if let Some(ts) = map.get("timestamp").and_then(|v| v.as_str()) {
        if is_stale(ts) {
            log::line(format!("hermes-hooks stale timestamp={ts}"));
            write_response(stream, 400, "stale").await?;
            return Ok(());
        }
    }

    let raw_event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| (!event_header.is_empty()).then_some(event_header))
        .unwrap_or_default();

    let Some(mapped) = map_event_name(&raw_event, map) else {
        log::line(format!("hermes-hooks ignore event={raw_event}"));
        write_response(stream, 200, "ignored").await?;
        return Ok(());
    };

    // Promote extra.user_message → prompt so hooks.ts UserPromptSubmit works.
    if mapped == "UserPromptSubmit" && !map.contains_key("prompt") {
        let msg = map
            .get("extra")
            .and_then(|v| v.as_object())
            .and_then(|e| e.get("user_message"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        if let Some(msg) = msg {
            map.insert("prompt".into(), serde_json::Value::String(msg));
        }
    }

    // agent:step often nests tool fields under extra.
    if mapped == "PreToolUse" {
        let missing_tool = !map
            .get("tool_name")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        if missing_tool {
            let (name, input) = {
                let extra = map.get("extra").and_then(|v| v.as_object());
                let name = extra
                    .and_then(|e| e.get("tool_name").or_else(|| e.get("name")))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let input = extra
                    .and_then(|e| e.get("tool_input").or_else(|| e.get("args")))
                    .cloned();
                (name, input)
            };
            if let Some(name) = name {
                map.insert("tool_name".into(), serde_json::Value::String(name));
            }
            if let Some(input) = input {
                map.insert("tool_input".into(), input);
            }
        }
    }

    map.insert(
        "hook_event_name".into(),
        serde_json::Value::String(mapped.to_string()),
    );
    map.insert(
        "coucou_agent".into(),
        serde_json::Value::String("hermes".into()),
    );

    log::line(format!("hermes-hooks {raw_event} → {mapped}"));
    let _ = app.emit_to(WINDOW_LABEL, events::HOOK, payload);
    write_response(stream, 200, "ok").await?;
    Ok(())
}

fn path_ok(path: &str) -> bool {
    matches!(
        path,
        "/" | "/hooks" | "/hooks/" | "/hermes-events" | "/hermes-events/" | "/hooks/hermes"
    )
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn verify_signature(body: &[u8], header: &str, secret: &str) -> bool {
    if header.is_empty() || secret.is_empty() {
        return false;
    }
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    let digest = mac.finalize().into_bytes();
    let expected = format!("sha256={}", hex::encode(digest));
    // Constant-time-ish compare via hmac crate helper when lengths match.
    expected.len() == header.len()
        && expected
            .bytes()
            .zip(header.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn is_stale(timestamp: &str) -> bool {
    // Accept RFC3339; if we cannot parse, do not reject — clock skew / formats vary.
    let Ok(parsed) = chrono_lite_parse(timestamp) else {
        return false;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    (now - parsed).abs() > STALE_SECS
}

/// Minimal RFC3339 → unix seconds (enough for Hermes `2026-07-22T14:00:00Z`).
fn chrono_lite_parse(ts: &str) -> Result<i64, ()> {
    // Prefer full parser via time crate? Keep zero-dep: only Zulu timestamps.
    let cleaned = ts.trim().trim_end_matches('Z');
    let (date, time) = cleaned.split_once('T').ok_or(())?;
    let mut d = date.split('-');
    let y: i32 = d.next().ok_or(())?.parse().map_err(|_| ())?;
    let mo: u32 = d.next().ok_or(())?.parse().map_err(|_| ())?;
    let day: u32 = d.next().ok_or(())?.parse().map_err(|_| ())?;
    let mut t = time.split(':');
    let h: u32 = t.next().ok_or(())?.parse().map_err(|_| ())?;
    let mi: u32 = t.next().ok_or(())?.parse().map_err(|_| ())?;
    let se_str = t.next().unwrap_or("0");
    let se: u32 = se_str
        .split(['.', '+', '-'])
        .next()
        .unwrap_or("0")
        .parse()
        .map_err(|_| ())?;
    days_from_civil(y, mo, day).map(|days| {
        days * 86400 + i64::from(h) * 3600 + i64::from(mi) * 60 + i64::from(se)
    })
}

/// Howard Hinnant civil-from-days inverse (proleptic Gregorian → days since 1970-01-01).
fn days_from_civil(y: i32, m: u32, d: u32) -> Result<i64, ()> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return Err(());
    }
    let y = y as i64 - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = m as i64 + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Ok(era * 146097 + doe - 719468)
}

fn map_event_name(raw: &str, map: &serde_json::Map<String, serde_json::Value>) -> Option<&'static str> {
    // Already Claude-shaped (custom bridge scripts).
    match raw {
        "SessionStart" | "SessionEnd" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse"
        | "PostToolUseFailure" | "Notification" | "Stop" | "StopFailure" | "SubagentStart"
        | "SubagentStop" => return Some(match raw {
            "SessionStart" => "SessionStart",
            "SessionEnd" => "SessionEnd",
            "UserPromptSubmit" => "UserPromptSubmit",
            "PreToolUse" => "PreToolUse",
            "PostToolUse" => "PostToolUse",
            "PostToolUseFailure" => "PostToolUseFailure",
            "Notification" => "Notification",
            "Stop" => "Stop",
            "StopFailure" => "StopFailure",
            "SubagentStart" => "SubagentStart",
            "SubagentStop" => "SubagentStop",
            _ => unreachable!(),
        }),
        // Approvals / permission: outbound cannot answer — leave to gateway WS.
        "PermissionRequest" | "pre_approval_request" | "post_approval_response" => return None,
        _ => {}
    }

    match raw {
        "on_session_start" | "session:start" | "gateway:startup" => Some("SessionStart"),
        "on_session_end" | "session:end" | "session:reset" => {
            let extra = map.get("extra").and_then(|v| v.as_object());
            let failed = extra
                .and_then(|e| e.get("failed"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let completed = extra
                .and_then(|e| e.get("completed"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if failed {
                Some("StopFailure")
            } else if completed {
                Some("Stop")
            } else {
                Some("SessionEnd")
            }
        }
        "pre_llm_call" | "agent:start" => Some("UserPromptSubmit"),
        "pre_tool_call" | "agent:step" => Some("PreToolUse"),
        "post_tool_call" => {
            let extra = map.get("extra").and_then(|v| v.as_object());
            let status = extra
                .and_then(|e| e.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("ok");
            if status == "error" {
                Some("PostToolUseFailure")
            } else {
                Some("PostToolUse")
            }
        }
        // End-of-turn / loop-end fallbacks from Hermes outbound webhooks.
        // `post_llm_call` is the normal successful turn terminator; `on_session_finalize`
        // and `agent_loop_stopped` are last-chance boundaries that still mean the island
        // should stop showing the last tool step if the primary stop event was missed.
        "post_llm_call" | "agent:end" | "on_session_finalize" | "agent_loop_stopped" => Some("Stop"),
        "subagent_start" => Some("SubagentStart"),
        "subagent_stop" => Some("SubagentStop"),
        _ => None,
    }
}

async fn write_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        _ => "Error",
    };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(resp.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}
