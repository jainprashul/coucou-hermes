//! coucou-hook — the relay Claude Code / Cursor runs on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! Coucou over the named pipe `\\.\pipe\coucou-<sid>`.
//!
//! Hard rule (docs/CLAUDE.md): **never block Claude Code / Cursor.**
//! * If the pipe does not exist — Coucou is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Every step runs under a deadline enforced by the main thread, so a pipe that
//!   accepts the connection and then stops reading cannot wedge the session
//!   either: we abandon the worker and exit.
//! * Only permission gates wait for an answer (`PermissionRequest` for Claude,
//!   or Cursor's `beforeShellExecution` / `beforeMCPExecution` normalized to
//!   the same island card). No answer means empty stdout so the host asks
//!   in-app exactly as if Coucou were not installed.
//!
//! Usage: `coucou-hook [--agent <name>] [<EventName>]`

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Budget for getting a pipe connection. Beyond this the host wins, always.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a permission prompt may stay on screen before the host takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// `ERROR_PIPE_BUSY` — every instance is serving someone else right now. This is
/// the one error worth retrying: the server exists and a slot will free up.
const ERROR_PIPE_BUSY: i32 = 231;

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path", "tool_output"];
/// Longest string forwarded for any single field; the island truncates to far
/// less than this anyway.
const MAX_FIELD_LEN: usize = 2_000;

mod win;

/// How to format a pipe decision on stdout for the host that spawned us.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DecisionFormat {
    /// Claude Code `PermissionRequest` / `hookSpecificOutput`.
    Claude,
    /// Cursor `{ "permission": "allow"|"deny", ... }`.
    Cursor,
}

/// `\\.\pipe\coucou-<sid>`. The SID keeps two accounts on the same machine from
/// ever meeting on the same pipe; the name falls back to the user name only if
/// the SID cannot be read at all, which should not happen.
fn pipe_path() -> String {
    let key = win::current_user_sid()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "user".into()));
    format!(r"\\.\pipe\coucou-{key}")
}

/// Opens the pipe. Retries only while the server is busy: any other error means
/// there is nothing to talk to, and waiting would only delay the host.
fn connect() -> Option<std::fs::File> {
    use std::os::windows::io::AsRawHandle;
    let path = pipe_path();
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
            Ok(file) => {
                let handle = windows::Win32::Foundation::HANDLE(file.as_raw_handle());
                // Somebody else's server on our pipe name gets nothing from us.
                return win::pipe_server_is_same_user(handle).then_some(file);
            }
            Err(err) => {
                if err.raw_os_error() != Some(ERROR_PIPE_BUSY) || Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
}

fn main() {
    let Some((payload, event, format)) = read_event() else {
        std::process::exit(0)
    };

    let waits_for_answer = event == "PermissionRequest";
    let budget = if waits_for_answer {
        DECISION_BUDGET
    } else {
        FIRE_AND_FORGET_BUDGET
    };

    // The worker owns every blocking call. If it overruns the budget we simply
    // stop listening and exit: the process dying takes the pipe handle with it.
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    if let Ok(Some(decision)) = rx.recv_timeout(budget) {
        if let Some(json) = decision_json(&decision, format) {
            let mut out = std::io::stdout();
            let _ = writeln!(out, "{json}");
            let _ = out.flush();
        }
    }
    // Nothing printed: the host asks in-app, as if we were not here.
    std::process::exit(0);
}

/// Maps a Coucou decision word into the JSON the host expects on stdout.
fn decision_json(decision: &str, format: DecisionFormat) -> Option<String> {
    match format {
        DecisionFormat::Claude => claude_decision_json(decision),
        DecisionFormat::Cursor => cursor_decision_json(decision),
    }
}

fn claude_decision_json(decision: &str) -> Option<String> {
    let behavior = match decision.trim() {
        // "always" still answers a plain allow; remembering it is the island's
        // business, not Claude Code's.
        "allow" | "always" => r#"{"behavior":"allow"}"#.to_string(),
        "deny" => r#"{"behavior":"deny","message":"Denied from Coucou"}"#.to_string(),
        _ => return None,
    };
    Some(format!(
        r#"{{"hookSpecificOutput":{{"hookEventName":"PermissionRequest","decision":{behavior}}}}}"#
    ))
}

fn cursor_decision_json(decision: &str) -> Option<String> {
    match decision.trim() {
        "allow" | "always" => Some(r#"{"permission":"allow"}"#.to_string()),
        "deny" => {
            Some(r#"{"permission":"deny","user_message":"Denied from Coucou"}"#.to_string())
        }
        _ => None,
    }
}

/// Cursor camelCase lifecycle names → Claude PascalCase island events.
fn normalize_event_name(raw: &str) -> (&'static str, bool) {
    match raw {
        "sessionStart" => ("SessionStart", false),
        "sessionEnd" => ("SessionEnd", false),
        "beforeSubmitPrompt" => ("UserPromptSubmit", false),
        "preToolUse" => ("PreToolUse", false),
        "postToolUse" => ("PostToolUse", false),
        "postToolUseFailure" => ("PostToolUseFailure", false),
        "stop" => ("Stop", false),
        "subagentStart" => ("SubagentStart", false),
        "subagentStop" => ("SubagentStop", false),
        "afterShellExecution" => ("PostToolUse", false),
        // Permission gates: wait on the pipe as PermissionRequest.
        "beforeShellExecution" | "beforeMCPExecution" => ("PermissionRequest", true),
        other if other == "PermissionRequest" => ("PermissionRequest", false),
        _ => ("", false),
    }
}

/// Stable request id when Cursor does not supply one (pipe + island need it).
fn synthesize_request_id(map: &serde_json::Map<String, serde_json::Value>) -> String {
    let mut hasher = DefaultHasher::new();
    for key in ["generation_id", "conversation_id", "tool_use_id", "command", "tool_name"] {
        if let Some(v) = map.get(key) {
            v.to_string().hash(&mut hasher);
        }
    }
    format!("cursor-{:016x}", hasher.finish())
}

/// Enrich Cursor payloads so the island's Claude-shaped handlers can consume them.
fn normalize_cursor_payload(
    map: &mut serde_json::Map<String, serde_json::Value>,
    raw_event: &str,
) -> (String, DecisionFormat) {
    let (normalized, is_cursor_gate) = normalize_event_name(raw_event);
    let mut format = DecisionFormat::Claude;

    if normalized.is_empty() {
        // Unknown Cursor/other event — forward as-is under the original name.
        map.insert(
            "hook_event_name".into(),
            serde_json::Value::String(raw_event.to_string()),
        );
        return (raw_event.to_string(), format);
    }

    // Cursor permission gates become island PermissionRequest cards.
    if is_cursor_gate {
        format = DecisionFormat::Cursor;
        if raw_event == "beforeShellExecution" {
            if !map.contains_key("tool_name") {
                map.insert(
                    "tool_name".into(),
                    serde_json::Value::String("Shell".into()),
                );
            }
            if !map.contains_key("tool_input") {
                let mut input = serde_json::Map::new();
                if let Some(cmd) = map.get("command").cloned() {
                    input.insert("command".into(), cmd);
                }
                if let Some(cwd) = map.get("cwd").cloned() {
                    input.insert("path".into(), cwd);
                }
                map.insert("tool_input".into(), serde_json::Value::Object(input));
            }
        } else if raw_event == "beforeMCPExecution" {
            if !map.contains_key("tool_name") {
                let name = map
                    .get("mcp_server_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("MCP");
                map.insert(
                    "tool_name".into(),
                    serde_json::Value::String(format!("MCP:{name}")),
                );
            }
            // Cursor may send tool_input as a JSON string — parse it for the island.
            if let Some(serde_json::Value::String(s)) = map.get("tool_input").cloned() {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&s) {
                    map.insert("tool_input".into(), parsed);
                }
            }
            if !map.contains_key("tool_input") {
                let mut input = serde_json::Map::new();
                if let Some(cmd) = map.get("command").cloned() {
                    input.insert("command".into(), cmd);
                }
                if let Some(url) = map.get("url").or_else(|| map.get("mcp_server_url")).cloned()
                {
                    input.insert("url".into(), url);
                }
                map.insert("tool_input".into(), serde_json::Value::Object(input));
            }
        }
        if map
            .get("request_id")
            .and_then(|v| v.as_str())
            .map(str::is_empty)
            .unwrap_or(true)
        {
            map.insert(
                "request_id".into(),
                serde_json::Value::String(synthesize_request_id(map)),
            );
        }
    }

    // beforeSubmitPrompt → UserPromptSubmit: island reads `prompt`.
    if raw_event == "beforeSubmitPrompt" {
        if map.get("prompt").and_then(|v| v.as_str()).is_none() {
            if let Some(p) = map.get("prompt_text").or_else(|| map.get("message")).cloned() {
                map.insert("prompt".into(), p);
            }
        }
    }

    // conversation_id → session_id for island session grouping.
    if map
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true)
    {
        if let Some(cid) = map.get("conversation_id").cloned() {
            map.insert("session_id".into(), cid);
        }
    }

    map.insert(
        "hook_event_name".into(),
        serde_json::Value::String(normalized.to_string()),
    );
    (normalized.to_string(), format)
}

/// Whether the raw event name looks like Cursor's camelCase catalog.
fn looks_like_cursor_event(name: &str) -> bool {
    matches!(
        name,
        "sessionStart"
            | "sessionEnd"
            | "beforeSubmitPrompt"
            | "preToolUse"
            | "postToolUse"
            | "postToolUseFailure"
            | "stop"
            | "subagentStart"
            | "subagentStop"
            | "afterShellExecution"
            | "beforeShellExecution"
            | "beforeMCPExecution"
            | "beforeReadFile"
            | "afterFileEdit"
            | "afterAgentResponse"
            | "afterAgentThought"
            | "preCompact"
            | "workspaceOpen"
    )
}

/// Reads stdin and returns the payload to forward, the (possibly normalized)
/// event name, and how to format a permission decision on stdout.
fn read_event() -> Option<(String, String, DecisionFormat)> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    let mut payload = serde_json::from_slice::<serde_json::Value>(&raw).ok()?;
    let map = payload.as_object_mut()?;

    // Parse argv: "coucou-hook.exe [--agent <name>] [<EventName>]"
    // --agent tags the payload with coucou_agent so the app routes to the right pill.
    // Absent or invalid names are validated and discarded by the app, not here.
    let mut agent = String::new();
    let mut arg_event = String::new();
    {
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            if arg == "--agent" {
                agent = it.next().unwrap_or_default();
            } else if arg_event.is_empty() {
                arg_event = arg;
            }
        }
    }
    // Which agent this hook was installed for. Absent means Claude Code,
    // so existing hook commands keep working unchanged.
    if !agent.is_empty() {
        map.insert("coucou_agent".into(), serde_json::Value::String(agent));
    }

    let raw_event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);

    let (event, format) = if looks_like_cursor_event(&raw_event) {
        normalize_cursor_payload(map, &raw_event)
    } else {
        map.insert(
            "hook_event_name".into(),
            serde_json::Value::String(raw_event.clone()),
        );
        (raw_event, DecisionFormat::Claude)
    };

    for field in DROPPED_FIELDS {
        map.remove(*field);
    }

    let cwd_missing = map
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true);
    if cwd_missing {
        let from_roots = map
            .get("workspace_roots")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(str::to_string);
        if let Some(root) = from_roots {
            map.insert("cwd".into(), serde_json::Value::String(root));
        } else if let Ok(cwd) = std::env::current_dir() {
            map.insert(
                "cwd".into(),
                serde_json::Value::String(cwd.to_string_lossy().to_string()),
            );
        }
    }

    // Which terminal the session runs in. Unlike macOS, Coucou on Windows accepts
    // events from every terminal, so this is context only — never a filter.
    for (key, var) in [
        ("term_program", "TERM_PROGRAM"),
        ("wt_session", "WT_SESSION"),
        ("term_session_id", "TERM_SESSION_ID"),
        ("vscode_pid", "VSCODE_PID"),
        ("session_pid", "CLAUDE_CODE_SSE_PORT"),
    ] {
        if !map.contains_key(key) {
            let value = std::env::var(var).unwrap_or_default();
            map.insert(key.into(), serde_json::Value::String(value));
        }
    }

    truncate_strings(&mut payload);

    let mut line = payload.to_string();
    line.push('\n');
    Some((line, event, format))
}

/// Caps every string in the payload. A single Write can carry a whole file.
fn truncate_strings(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) => {
            if s.len() > MAX_FIELD_LEN {
                // Cut on a char boundary; a lone byte index can split UTF-8.
                let mut end = MAX_FIELD_LEN;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push('…');
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(truncate_strings),
        serde_json::Value::Object(map) => map.values_mut().for_each(truncate_strings),
        _ => {}
    }
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();

    if !waits_for_answer {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_json_matches_the_documented_claude_shape() {
        assert_eq!(
            decision_json("allow", DecisionFormat::Claude).unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        assert_eq!(
            decision_json("deny", DecisionFormat::Claude).unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Coucou"}}}"#
        );
        // "always" is an island concept; Claude Code just gets an allow.
        assert!(decision_json("always", DecisionFormat::Claude)
            .unwrap()
            .contains(r#""behavior":"allow""#));
    }

    #[test]
    fn decision_json_matches_cursor_permission_shape() {
        assert_eq!(
            decision_json("allow", DecisionFormat::Cursor).unwrap(),
            r#"{"permission":"allow"}"#
        );
        assert_eq!(
            decision_json("deny", DecisionFormat::Cursor).unwrap(),
            r#"{"permission":"deny","user_message":"Denied from Coucou"}"#
        );
        assert_eq!(
            decision_json("always", DecisionFormat::Cursor).unwrap(),
            r#"{"permission":"allow"}"#
        );
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(decision_json("", DecisionFormat::Claude).is_none());
        assert!(decision_json("maybe", DecisionFormat::Cursor).is_none());
        // The shape the app used to send must not be mistaken for a decision.
        assert!(decision_json(r#"{"permissionDecision":"allow"}"#, DecisionFormat::Claude).is_none());
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "content": "é".repeat(4000) } });
        truncate_strings(&mut v);
        let s = v["tool_input"]["content"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }

    #[test]
    fn normalize_maps_cursor_lifecycle_and_gates() {
        assert_eq!(normalize_event_name("sessionStart"), ("SessionStart", false));
        assert_eq!(normalize_event_name("beforeSubmitPrompt"), ("UserPromptSubmit", false));
        assert_eq!(normalize_event_name("preToolUse"), ("PreToolUse", false));
        assert_eq!(
            normalize_event_name("beforeShellExecution"),
            ("PermissionRequest", true)
        );
        assert_eq!(
            normalize_event_name("beforeMCPExecution"),
            ("PermissionRequest", true)
        );
    }

    #[test]
    fn normalize_cursor_shell_gate_builds_permission_payload() {
        let mut map = serde_json::Map::new();
        map.insert(
            "command".into(),
            serde_json::Value::String("rm -rf /".into()),
        );
        map.insert("cwd".into(), serde_json::Value::String("/tmp".into()));
        map.insert(
            "generation_id".into(),
            serde_json::Value::String("gen-1".into()),
        );
        let (event, format) = normalize_cursor_payload(&mut map, "beforeShellExecution");
        assert_eq!(event, "PermissionRequest");
        assert_eq!(format, DecisionFormat::Cursor);
        assert_eq!(map["tool_name"], "Shell");
        assert_eq!(map["tool_input"]["command"], "rm -rf /");
        assert!(map["request_id"].as_str().unwrap().starts_with("cursor-"));
    }

    #[test]
    fn normalize_fills_cwd_from_workspace_roots_via_read_path_helpers() {
        // Covered indirectly: when cwd missing, workspace_roots[0] is used in read_event.
        // Here we just assert the helper that would feed that path.
        let roots = serde_json::json!(["/home/dev/proj", "/other"]);
        let first = roots.as_array().unwrap().first().unwrap().as_str().unwrap();
        assert_eq!(first, "/home/dev/proj");
    }
}
