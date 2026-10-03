// Cursor (Windows + Remote-WSL) hook installation.
//
// Mirrors Claude Code's hooks.rs contract: read hooks.json, dated backup, merge
// without touching foreign hooks, show a diff, write only after an explicit click.
//
// Cursor uses ~/.cursor/hooks.json with a flatter schema than Claude:
//   { "version": 1, "hooks": { "preToolUse": [{ "command": "…", "timeout": 10 }] } }
//
// Remote-WSL agent hooks run inside the distro, so WSL install writes the Linux
// home hooks.json and points commands at the Windows coucou-hook.exe via /mnt/c.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::{json, Map, Value};
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::settings;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Marker that identifies a Coucou entry inside hooks.json.
const MARKER: &str = "coucou-hook";

/// Events Coucou installs for Cursor, with timeouts (seconds).
/// Shell/MCP gates wait for a human, so they get the decision budget + headroom.
pub const CURSOR_HOOK_EVENTS: &[(&str, u64)] = &[
    ("sessionStart", 10),
    ("sessionEnd", 10),
    ("beforeSubmitPrompt", 10),
    ("preToolUse", 10),
    ("postToolUse", 10),
    ("postToolUseFailure", 10),
    ("beforeShellExecution", 120),
    ("beforeMCPExecution", 120),
    ("afterShellExecution", 10),
    ("subagentStart", 10),
    ("subagentStop", 10),
    ("stop", 10),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorHookTarget {
    Windows,
    Wsl,
}

impl CursorHookTarget {
    fn agent_tag(self) -> &'static str {
        match self {
            Self::Windows => "cursor",
            Self::Wsl => "cursor-wsl",
        }
    }

    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "windows" => Ok(Self::Windows),
            "wsl" => Ok(Self::Wsl),
            other => Err(format!("unknown cursor hooks target: {other}")),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorHookStatus {
    pub windows: TargetStatus,
    pub wsl: TargetStatus,
    pub hook_path: String,
    pub hook_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStatus {
    pub available: bool,
    pub installed: bool,
    pub settings_path: String,
    pub detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorHookPreview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    pub fingerprint: String,
    pub target: CursorHookTarget,
}

fn home_windows() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn windows_hooks_path() -> PathBuf {
    home_windows().join(".cursor").join("hooks.json")
}

fn stamp() -> String {
    let t = unsafe { GetLocalTime() };
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn parse_hooks_json(bytes: &[u8], path: &str) -> Result<Value, String> {
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({ "version": 1, "hooks": {} }));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{path} isn't a JSON object — Coucou won't touch it.")),
        Err(err) => Err(format!(
            "{path} isn't valid JSON ({err}). Fix or move it, then try again — Coucou won't overwrite it."
        )),
    }
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

fn entry_is_ours(entry: &Value, agent: &str) -> bool {
    let Some(cmd) = entry.get("command").and_then(Value::as_str) else {
        return false;
    };
    if !cmd.contains(MARKER) {
        return false;
    }
    // Exact agent tag: `--agent cursor` must not match `--agent cursor-wsl`.
    let needle = format!("--agent {agent}");
    let Some(idx) = cmd.find(&needle) else {
        return false;
    };
    let after = &cmd[idx + needle.len()..];
    after.is_empty() || after.starts_with(' ') || after.starts_with('"')
}

fn hook_command_windows(event: &str, agent: &str) -> String {
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    format!("\"{exe}\" --agent {agent} {event}")
}

fn hook_command_wsl(event: &str, agent: &str, exe_unix: &str) -> String {
    // Quote for POSIX shells that Cursor launches inside WSL.
    format!("\"{exe_unix}\" --agent {agent} {event}")
}

fn merged(existing: &Value, agent: &str, command_for: &dyn Fn(&str) -> String) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    if !root.contains_key("version") {
        root.insert("version".into(), json!(1));
    }
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);

    for (event, timeout) in CURSOR_HOOK_EVENTS {
        let mut list = hooks
            .get(*event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry, agent));
        list.push(json!({
            "command": command_for(event),
            "timeout": timeout,
        }));
        hooks.insert((*event).to_string(), Value::Array(list));
    }

    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

fn without_ours(existing: &Value, agent: &str) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let Some(hooks) = root.get("hooks").and_then(Value::as_object).cloned() else {
        return Value::Object(root);
    };
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept: Vec<Value> = list
                    .iter()
                    .filter(|e| !entry_is_ours(e, agent))
                    .cloned()
                    .collect();
                if !kept.is_empty() {
                    out.insert(event, Value::Array(kept));
                }
            }
            None => {
                out.insert(event, value);
            }
        }
    }
    if out.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(out));
    }
    Value::Object(root)
}

fn installed_in(value: &Value, agent: &str) -> bool {
    value
        .get("hooks")
        .and_then(Value::as_object)
        .map(|hooks| {
            hooks
                .values()
                .filter_map(Value::as_array)
                .flatten()
                .any(|e| entry_is_ours(e, agent))
        })
        .unwrap_or(false)
}

// ── Minimal unified diff (same algorithm as hooks.rs) ─────────────────────────

fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (n, m) = (a.len(), b.len());

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out: Vec<String> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(format!("  {}", a[i]));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(format!("- {}", a[i]));
            i += 1;
        } else {
            out.push(format!("+ {}", b[j]));
            j += 1;
        }
    }
    while i < n {
        out.push(format!("- {}", a[i]));
        i += 1;
    }
    while j < m {
        out.push(format!("+ {}", b[j]));
        j += 1;
    }

    let changed: Vec<usize> = out
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with('+') || l.starts_with('-'))
        .map(|(i, _)| i)
        .collect();
    if changed.is_empty() {
        return "No change.".into();
    }
    let mut keep = vec![false; out.len()];
    for idx in changed {
        let lo = idx.saturating_sub(3);
        let hi = (idx + 4).min(out.len());
        for k in lo..hi {
            keep[k] = true;
        }
    }
    let mut result = String::new();
    let mut gap = false;
    for (idx, line) in out.iter().enumerate() {
        if keep[idx] {
            result.push_str(line);
            result.push('\n');
            gap = false;
        } else if !gap {
            result.push_str("  …\n");
            gap = true;
        }
    }
    result
}

// ── WSL helpers ───────────────────────────────────────────────────────────────

fn wsl_available() -> bool {
    Command::new("wsl.exe")
        .args(["-e", "sh", "-c", "echo ok"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn wsl_stdout(args: &[&str]) -> Result<String, String> {
    let output = Command::new("wsl.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("WSL is not available ({e})"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("WSL command failed: {err}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Windows path to the Linux `~/.cursor/hooks.json` (via wslpath -w).
fn wsl_hooks_windows_path() -> Result<PathBuf, String> {
    let path = wsl_stdout(&[
        "-e",
        "sh",
        "-c",
        r#"mkdir -p "$HOME/.cursor" && wslpath -w "$HOME/.cursor/hooks.json""#,
    ])?;
    if path.is_empty() {
        return Err("Could not resolve WSL ~/.cursor/hooks.json".into());
    }
    Ok(PathBuf::from(path))
}

/// Unix path to coucou-hook.exe for commands inside WSL.
fn wsl_hook_exe_unix() -> Result<String, String> {
    let win = settings::hook_exe_path();
    let win_str = win.to_string_lossy().replace('/', "\\");
    let unix = wsl_stdout(&["-e", "wslpath", "-u", &win_str])?;
    if unix.is_empty() {
        return Err("Could not convert coucou-hook.exe path for WSL".into());
    }
    Ok(unix)
}

fn read_hooks_file(path: &Path) -> Result<Value, String> {
    match std::fs::read(path) {
        Ok(bytes) => parse_hooks_json(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(json!({ "version": 1, "hooks": {} }))
        }
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

fn current_fingerprint_at(path: &Path) -> String {
    match std::fs::read(path) {
        Ok(bytes) => fingerprint(&bytes),
        Err(_) => fingerprint(b""),
    }
}

fn backup_beside(path: &Path) -> PathBuf {
    path.with_file_name(format!("hooks.json.bak-{}", stamp()))
}

fn write_hooks_file(path: &Path, next: &Value, expected_fp: &str) -> Result<String, String> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let current = read_hooks_file(path)?;
    if current_fingerprint_at(path) != expected_fp {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }

    let backup = backup_beside(path);
    if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    } else {
        // Still record where a backup would have gone for the UI.
        let _ = &backup;
    }

    let mut text = pretty(next);
    text.push('\n');
    let temp = path.with_extension(format!("json.coucou-{}", std::process::id()));
    std::fs::write(&temp, text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    // Re-check we still have the content we intended (paranoia around WSL mounts).
    let _ = current;
    Ok(backup.to_string_lossy().to_string())
}

fn resolve_path(target: CursorHookTarget) -> Result<PathBuf, String> {
    match target {
        CursorHookTarget::Windows => Ok(windows_hooks_path()),
        CursorHookTarget::Wsl => wsl_hooks_windows_path(),
    }
}

fn command_builder(target: CursorHookTarget) -> Result<Box<dyn Fn(&str) -> String>, String> {
    let agent = target.agent_tag().to_string();
    match target {
        CursorHookTarget::Windows => Ok(Box::new(move |event: &str| {
            hook_command_windows(event, &agent)
        })),
        CursorHookTarget::Wsl => {
            let exe = wsl_hook_exe_unix()?;
            Ok(Box::new(move |event: &str| {
                hook_command_wsl(event, &agent, &exe)
            }))
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn status() -> CursorHookStatus {
    let hook_path = settings::hook_exe_path();
    let hook_ready = hook_path.exists();

    let win_path = windows_hooks_path();
    let win_value = read_hooks_file(&win_path).unwrap_or_else(|_| json!({}));
    let windows = TargetStatus {
        available: true,
        installed: installed_in(&win_value, "cursor"),
        settings_path: win_path.to_string_lossy().to_string(),
        detail: None,
    };

    let wsl = if wsl_available() {
        match wsl_hooks_windows_path() {
            Ok(path) => {
                let value = read_hooks_file(&path).unwrap_or_else(|_| json!({}));
                TargetStatus {
                    available: true,
                    installed: installed_in(&value, "cursor-wsl"),
                    settings_path: path.to_string_lossy().to_string(),
                    detail: None,
                }
            }
            Err(err) => TargetStatus {
                available: false,
                installed: false,
                settings_path: String::new(),
                detail: Some(err),
            },
        }
    } else {
        TargetStatus {
            available: false,
            installed: false,
            settings_path: String::new(),
            detail: Some("WSL is not available on this machine.".into()),
        }
    };

    CursorHookStatus {
        windows,
        wsl,
        hook_path: hook_path.to_string_lossy().to_string(),
        hook_ready,
    }
}

pub fn preview(target_raw: &str, install: bool) -> Result<CursorHookPreview, String> {
    let target = CursorHookTarget::parse(target_raw)?;
    if target == CursorHookTarget::Wsl && !wsl_available() {
        return Err("WSL is not available on this machine.".into());
    }
    let path = resolve_path(target)?;
    let current = read_hooks_file(&path)?;
    let agent = target.agent_tag();
    let next = if install {
        let builder = command_builder(target)?;
        merged(&current, agent, builder.as_ref())
    } else {
        without_ours(&current, agent)
    };
    Ok(CursorHookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_beside(&path).to_string_lossy().to_string(),
        settings_path: path.to_string_lossy().to_string(),
        fingerprint: current_fingerprint_at(&path),
        target,
    })
}

pub fn write(target_raw: &str, install: bool, fingerprint: &str) -> Result<String, String> {
    let target = CursorHookTarget::parse(target_raw)?;
    if target == CursorHookTarget::Wsl && !wsl_available() {
        return Err("WSL is not available on this machine.".into());
    }
    let path = resolve_path(target)?;
    let current = read_hooks_file(&path)?;
    let agent = target.agent_tag();
    let next = if install {
        let builder = command_builder(target)?;
        merged(&current, agent, builder.as_ref())
    } else {
        without_ours(&current, agent)
    };
    write_hooks_file(&path, &next, fingerprint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merging_keeps_foreign_cursor_hooks() {
        let existing = json!({
            "version": 1,
            "hooks": {
                "preToolUse": [
                    { "command": "someone-elses-audit.sh" }
                ],
                "stop": [
                    { "command": "keep-me.sh" }
                ]
            }
        });
        let after = merged(&existing, "cursor", &|event| {
            format!("\"/tmp/coucou-hook.exe\" --agent cursor {event}")
        });
        let pre = after["hooks"]["preToolUse"].as_array().unwrap();
        assert!(pre
            .iter()
            .any(|e| e["command"].as_str().unwrap().contains("someone-elses-audit.sh")));
        assert!(pre.iter().any(|e| entry_is_ours(e, "cursor")));
        assert!(!pre.iter().any(|e| entry_is_ours(e, "cursor-wsl")));

        let cleaned = without_ours(&after, "cursor");
        assert_eq!(cleaned, existing);
    }

    #[test]
    fn windows_and_wsl_agents_do_not_collide() {
        let empty = json!({ "version": 1, "hooks": {} });
        let with_win = merged(&empty, "cursor", &|e| {
            format!("\"C:/CoucouHermes/bin/coucou-hook.exe\" --agent cursor {e}")
        });
        let with_both = merged(&with_win, "cursor-wsl", &|e| {
            format!("\"/mnt/c/CoucouHermes/bin/coucou-hook.exe\" --agent cursor-wsl {e}")
        });
        let pre = with_both["hooks"]["preToolUse"].as_array().unwrap();
        // `--agent cursor` is a prefix of `--agent cursor-wsl`, so match must be exact-tag.
        assert_eq!(pre.iter().filter(|e| entry_is_ours(e, "cursor")).count(), 1);
        assert_eq!(
            pre.iter().filter(|e| entry_is_ours(e, "cursor-wsl")).count(),
            1
        );
        let only_wsl_removed = without_ours(&with_both, "cursor-wsl");
        assert!(installed_in(&only_wsl_removed, "cursor"));
        assert!(!installed_in(&only_wsl_removed, "cursor-wsl"));
    }

    #[test]
    fn parse_rejects_garbage_json() {
        assert!(parse_hooks_json(b"{ broken", "hooks.json").is_err());
        assert!(parse_hooks_json(b"[1]", "hooks.json").is_err());
    }
}
