// Integration pollers — the Rust side of StripePoller / GithubPoller /
// VercelPoller / N8nPoller / ResendPoller / NotionPoller / CalcomPoller.
//
// Same endpoints, same first-run delays and intervals as the Swift pollers. Each
// one emits an `integration` event; the island owns the badge, the sound and the
// 60 s auto-clear, exactly as the Swift handlers do.
//
// Nothing is polled until its key exists in the Credential Manager, and no
// request goes anywhere the user has not configured.

pub mod calcom;
pub mod github;
pub mod n8n;
pub mod notion;
pub mod resend;
pub mod stripe;
pub mod vercel;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::events;
use crate::island::WINDOW_LABEL;


pub(crate) const TIMEOUT: Duration = Duration::from_secs(10);

/// What the island receives. `event` is only set when something actually changed,
/// which is what drives the pill badge and the sound.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationUpdate {
    pub id: &'static str,
    pub data: Value,
    pub error: Option<String>,
    pub event: Option<IntegrationEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationEvent {
    pub success: bool,
    pub label: String,
    pub detail: Option<String>,
}

pub(crate) fn emit(app: &AppHandle, update: IntegrationUpdate) {
    let _ = app.emit_to(WINDOW_LABEL, events::INTEGRATION, update);
}

pub(crate) fn emit_error(app: &AppHandle, id: &'static str, error: impl Into<String>) {
    emit(app, IntegrationUpdate {
        id,
        data: json!({}),
        error: Some(error.into()),
        event: None,
    });
}

pub(crate) fn status_error(code: u16, unauthorised_hint: &str) -> String {
    match code {
        401 => "Invalid API key (401)".into(),
        403 => unauthorised_hint.into(),
        _ => format!("API error {code}"),
    }
}

pub(crate) fn emit_status_error(app: &AppHandle, id: &'static str, code: u16, unauthorised_hint: &str) {
    emit_error(app, id, status_error(code, unauthorised_hint));
}

pub(crate) fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .unwrap_or_default()
}

/// Set from the tray's Pause item. While it is on, nothing reaches the network:
/// pausing Coucou has to mean pausing Coucou, not just hiding the island.
pub static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn set_paused(on: bool) {
    PAUSED.store(on, Ordering::Relaxed);
}

/// Spawns every poller with the macOS delays and intervals.
pub fn start(app: AppHandle) {
    spawn(app.clone(), "integration_n8n", 3, 15, n8n::poll);
    spawn(app.clone(), "integration_vercel", 5, 30, vercel::poll);
    spawn(app.clone(), "integration_stripe", 6, 30, stripe::poll);
    spawn(app.clone(), "integration_resend", 6, 60, resend::poll);
    spawn(app.clone(), "integration_github", 7, 300, github::poll);
    spawn(app.clone(), "integration_calcom", 8, 300, calcom::poll);
    spawn(app, "integration_notion", 9, 300, notion::poll);
}

/// True when the user has this integration switched on in settings.
fn enabled(app: &AppHandle, id: &str) -> bool {
    app.try_state::<crate::Shared>()
        .map(|shared| {
            let settings = shared.settings.lock().unwrap();
            settings.active_integrations.iter().any(|x| x == id)
        })
        .unwrap_or(false)
}

fn spawn<F, Fut>(app: AppHandle, id: &'static str, delay_secs: u64, every_secs: u64, poll: F)
where
    F: Fn(AppHandle) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_secs)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(every_secs));
        loop {
            ticker.tick().await;
            // The ticker keeps its cadence; we just decline to do the work. An
            // integration the user switched off, or a paused app, must make no
            // network calls at all — CLAUDE.md allows talking only to services
            // the user configured, and a disabled one is not configured.
            if PAUSED.load(Ordering::Relaxed) || !enabled(&app, id) {
                continue;
            }
            poll(app.clone()).await;
        }
    });
}

/// One-shot refresh from the Refresh buttons in the island.
pub async fn poll_once(app: AppHandle, id: &str) {
    match id {
        "integration_stripe" => stripe::poll(app).await,
        "integration_github" => github::poll(app).await,
        "integration_vercel" => vercel::poll(app).await,
        "integration_n8n" => n8n::poll(app).await,
        "integration_resend" => resend::poll(app).await,
        "integration_notion" => notion::poll(app).await,
        "integration_calcom" => calcom::poll(app).await,
        _ => {}
    }
}

/// Remembers the newest id per integration so an event fires once, not on every poll.
struct Seen(Mutex<std::collections::HashMap<&'static str, String>>);

static SEEN: std::sync::LazyLock<Seen> =
    std::sync::LazyLock::new(|| Seen(Mutex::new(std::collections::HashMap::new())));

/// Returns true the first time a given id is seen (and false on the very first
/// load, which only fills the card).
pub(crate) fn is_new(key: &'static str, id: &str) -> bool {
    let mut map = SEEN.0.lock().unwrap();
    match map.insert(key, id.to_string()) {
        Some(previous) => previous != id,
        None => false, // first poll: populate silently, like the Swift pollers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_error() {
        assert_eq!(status_error(401, "hint"), "Invalid API key (401)");
        assert_eq!(status_error(403, "custom hint"), "custom hint");
        assert_eq!(status_error(500, "hint"), "API error 500");
    }

    #[test]
    fn test_is_new() {
        assert!(!is_new("test_service", "id_1"));
        assert!(!is_new("test_service", "id_1"));
        assert!(is_new("test_service", "id_2"));
        assert!(!is_new("test_service", "id_2"));
    }
}
