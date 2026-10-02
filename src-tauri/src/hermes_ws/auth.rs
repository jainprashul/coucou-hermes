// Authentication and URL preparation helpers for Hermes WebSocket connection.

use std::time::Duration;

use serde_json::json;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;

use crate::log;
use crate::util::base64;

/// Normalize a host/URL string into a WebSocket URL pointing to `/api/ws`.
pub fn normalize_ws_url(url_str: &str) -> String {
    if url_str.starts_with("http://") {
        format!("ws://{}/api/ws", &url_str[7..].trim_end_matches('/'))
    } else if url_str.starts_with("https://") {
        format!("wss://{}/api/ws", &url_str[8..].trim_end_matches('/'))
    } else if !url_str.starts_with("ws://") && !url_str.starts_with("wss://") {
        format!("ws://{}/api/ws", url_str.trim_end_matches('/'))
    } else if !url_str.contains("/api/ws") {
        format!("{}/api/ws", url_str.trim_end_matches('/'))
    } else {
        url_str.to_string()
    }
}

/// Derive the HTTP base URL from a WebSocket or HTTP URL string.
pub fn http_base_url(url_str: &str) -> String {
    if url_str.starts_with("wss://") {
        format!("https://{}", &url_str[6..].trim_end_matches('/'))
    } else if url_str.starts_with("ws://") {
        format!("http://{}", &url_str[5..].trim_end_matches('/'))
    } else if url_str.starts_with("http://") || url_str.starts_with("https://") {
        url_str.trim_end_matches('/').to_string()
    } else {
        format!("http://{}", url_str.trim_end_matches('/'))
    }
}

/// Extract session token from `hermes_session_at` cookie string if present.
pub fn extract_token_from_cookie(cookie_str: &str) -> Option<String> {
    if let Some(pos) = cookie_str.find("hermes_session_at=") {
        let rest = &cookie_str[pos + 18..];
        let token_raw = rest
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"');
        if !token_raw.is_empty() {
            return Some(token_raw.to_string());
        }
    }
    None
}

/// Append token to WebSocket URL query parameters.
pub fn append_token_to_url(url: &str, token: &str) -> String {
    if url.contains('?') {
        format!("{url}&token={token}")
    } else {
        format!("{url}?token={token}")
    }
}

/// Perform password-login HTTP request to obtain a session token.
pub async fn fetch_password_login_token(
    http_base: &str,
    user: &str,
    pass: &str,
    gen: u64,
) -> Option<String> {
    let login_url = format!("{http_base}/auth/password-login");
    log::line(format!("hermes password-login gen={gen} → {login_url}"));
    let http_client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            log::line(format!("hermes password-login error gen={gen}: {err}"));
            return None;
        }
    };
    let body = json!({
        "provider": "basic",
        "username": user,
        "password": pass
    });

    match http_client.post(&login_url).json(&body).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                let mut got_token = false;
                let mut token_found = None;
                for cookie in resp.headers().get_all(reqwest::header::SET_COOKIE) {
                    if let Ok(cookie_str) = cookie.to_str() {
                        if let Some(token) = extract_token_from_cookie(cookie_str) {
                            token_found = Some(token);
                            got_token = true;
                            break;
                        }
                    }
                }
                log::line(format!(
                    "hermes password-login ok gen={gen} token={}",
                    if got_token { "yes" } else { "no" }
                ));
                token_found
            } else {
                log::line(format!("hermes password-login failed gen={gen} status={status}"));
                None
            }
        }
        Err(err) => {
            log::line(format!("hermes password-login error gen={gen}: {err}"));
            None
        }
    }
}

/// Format Basic Authorization header value for username and password.
pub fn format_basic_auth_header(user: &str, pass: &str) -> String {
    use std::io::Write;
    let mut auth_bytes = Vec::new();
    let _ = write!(auth_bytes, "{user}:{pass}");
    let encoded = base64::encode(&auth_bytes);
    format!("Basic {encoded}")
}

/// Apply Basic auth to a tungstenite client request if credentials are provided.
pub fn apply_basic_auth(req: &mut Request, auth_user: Option<&str>, auth_pass: Option<&str>) {
    if let (Some(u), Some(p)) = (auth_user, auth_pass) {
        if !u.is_empty() {
            let header_val = format_basic_auth_header(u, p);
            if let Ok(val) = header_val.parse() {
                req.headers_mut().insert("Authorization", val);
            }
        }
    }
}

/// Prepare the final WebSocket URL by normalizing and optionally obtaining a session token.
pub async fn prepare_ws_url(
    url_str: &str,
    auth_user: Option<&str>,
    auth_pass: Option<&str>,
    gen: u64,
) -> String {
    let ws_url = normalize_ws_url(url_str);
    let mut final_ws_url = ws_url;
    if let (Some(u), Some(p)) = (auth_user, auth_pass) {
        if !u.is_empty() && !p.is_empty() {
            let http_base = http_base_url(url_str);
            if let Some(token) = fetch_password_login_token(&http_base, u, p, gen).await {
                final_ws_url = append_token_to_url(&final_ws_url, &token);
            }
        }
    }
    final_ws_url
}

/// Build a tungstenite Client Request from the target URL and optional auth credentials.
pub async fn build_ws_request(
    url_str: &str,
    auth_user: Option<&str>,
    auth_pass: Option<&str>,
    gen: u64,
) -> Result<Request, Box<dyn std::error::Error + Send + Sync>> {
    let final_ws_url = prepare_ws_url(url_str, auth_user, auth_pass, gen).await;
    let mut req = final_ws_url.into_client_request()?;
    apply_basic_auth(&mut req, auth_user, auth_pass);
    Ok(req)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_ws_url() {
        assert_eq!(normalize_ws_url("http://127.0.0.1:9119"), "ws://127.0.0.1:9119/api/ws");
        assert_eq!(normalize_ws_url("http://127.0.0.1:9119/"), "ws://127.0.0.1:9119/api/ws");
        assert_eq!(normalize_ws_url("https://secure.host:9119"), "wss://secure.host:9119/api/ws");
        assert_eq!(normalize_ws_url("100.64.0.1:9119"), "ws://100.64.0.1:9119/api/ws");
        assert_eq!(normalize_ws_url("ws://custom:9119"), "ws://custom:9119/api/ws");
        assert_eq!(normalize_ws_url("ws://custom:9119/api/ws"), "ws://custom:9119/api/ws");
        assert_eq!(normalize_ws_url("wss://custom:9119/api/ws"), "wss://custom:9119/api/ws");
    }

    #[test]
    fn test_http_base_url() {
        assert_eq!(http_base_url("wss://host.ts.net:9119/api/ws"), "https://host.ts.net:9119");
        assert_eq!(http_base_url("ws://host.ts.net:9119/api/ws"), "http://host.ts.net:9119");
        assert_eq!(http_base_url("http://host:9119/"), "http://host:9119");
        assert_eq!(http_base_url("https://host:9119/"), "https://host:9119");
        assert_eq!(http_base_url("host:9119/"), "http://host:9119");
    }

    #[test]
    fn test_extract_token_from_cookie() {
        assert_eq!(
            extract_token_from_cookie("hermes_session_at=token_val; Path=/; HttpOnly"),
            Some("token_val".to_string())
        );
        assert_eq!(
            extract_token_from_cookie("hermes_session_at=\"quoted_token\"; Path=/"),
            Some("quoted_token".to_string())
        );
        assert_eq!(
            extract_token_from_cookie("other_cookie=xyz; Path=/"),
            None
        );
        assert_eq!(
            extract_token_from_cookie("hermes_session_at=; Path=/"),
            None
        );
    }

    #[test]
    fn test_append_token_to_url() {
        assert_eq!(
            append_token_to_url("ws://127.0.0.1:9119/api/ws", "tok123"),
            "ws://127.0.0.1:9119/api/ws?token=tok123"
        );
        assert_eq!(
            append_token_to_url("ws://127.0.0.1:9119/api/ws?foo=bar", "tok123"),
            "ws://127.0.0.1:9119/api/ws?foo=bar&token=tok123"
        );
    }

    #[test]
    fn test_format_basic_auth_header() {
        // "user:secret" in base64 is "dXNlcjpzZWNyZXQ="
        assert_eq!(format_basic_auth_header("user", "secret"), "Basic dXNlcjpzZWNyZXQ=");
    }

    #[test]
    fn test_apply_basic_auth() {
        let mut req = "ws://127.0.0.1:9119/api/ws".into_client_request().unwrap();
        apply_basic_auth(&mut req, Some("user"), Some("secret"));
        assert_eq!(
            req.headers().get("Authorization").and_then(|v| v.to_str().ok()),
            Some("Basic dXNlcjpzZWNyZXQ=")
        );

        let mut req_no_auth = "ws://127.0.0.1:9119/api/ws".into_client_request().unwrap();
        apply_basic_auth(&mut req_no_auth, None, None);
        assert!(req_no_auth.headers().get("Authorization").is_none());

        let mut req_empty_user = "ws://127.0.0.1:9119/api/ws".into_client_request().unwrap();
        apply_basic_auth(&mut req_empty_user, Some(""), Some("secret"));
        assert!(req_empty_user.headers().get("Authorization").is_none());
    }
}
