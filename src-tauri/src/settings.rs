// Preferences, stored as plain JSON in %APPDATA%\CoucouHermes\settings.json.
// No secret ever lands here — API keys & passwords live in Windows Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    #[serde(default = "default_model")]
    pub model: String,

    // Hermes Gateway Configuration
    #[serde(default = "default_gateway_url")]
    pub gateway_url: String,
    #[serde(default = "default_api_server_url")]
    pub api_server_url: String,
    #[serde(default = "default_auth_username")]
    pub auth_username: String,
    #[serde(default = "default_auto_connect")]
    pub auto_connect: bool,

    /// Listen for Hermes `hooks.outbound` POSTs (Claude-style island updates).
    #[serde(default = "default_webhook_enabled")]
    pub webhook_enabled: bool,
    #[serde(default = "default_webhook_port")]
    pub webhook_port: u16,
}

fn default_model() -> String {
    "hermes-agent".to_string()
}

fn default_gateway_url() -> String {
    "http://h9-xpvm.taila48f73.ts.net:9119".to_string()
}

fn default_api_server_url() -> String {
    "http://h9-xpvm.taila48f73.ts.net:8642".to_string()
}

fn default_auth_username() -> String {
    "admin".to_string()
}

fn default_auto_connect() -> bool {
    true
}

fn default_webhook_enabled() -> bool {
    true
}

fn default_webhook_port() -> u16 {
    19641
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_hermes".into(),
                "subagent_antigravity".into(),
                "subagent_codex".into(),
            ],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            gateway_url: default_gateway_url(),
            api_server_url: default_api_server_url(),
            auth_username: default_auth_username(),
            auto_connect: default_auto_connect(),
            webhook_enabled: default_webhook_enabled(),
            webhook_port: default_webhook_port(),
        }
    }
}

/// %APPDATA%\CoucouHermes
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("CoucouHermes")
}

/// %LOCALAPPDATA%\CoucouHermes — where logs and file cache live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("CoucouHermes")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("coucou-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
