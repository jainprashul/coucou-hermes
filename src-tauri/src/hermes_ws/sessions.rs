// Pure session selection helpers for Hermes gateway protocol.

use serde_json::Value;

pub fn is_ended(entry: &Value) -> bool {
    match entry.get("ended_at") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|v| v > 0.0).unwrap_or(false),
        _ => false,
    }
}

pub fn get_activity_time(entry: &Value) -> f64 {
    entry
        .get("last_active")
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        .or_else(|| {
            entry
                .get("started_at")
                .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
        })
        .unwrap_or(0.0)
}

pub fn pick_recent_session_id(result_val: &Value) -> Option<String> {
    let sessions = result_val
        .get("sessions")
        .or_else(|| result_val.get("data"))
        .and_then(Value::as_array)
        .or_else(|| result_val.as_array())?;

    if sessions.is_empty() {
        return None;
    }

    let non_ended: Vec<&Value> = sessions.iter().filter(|s| !is_ended(s)).collect();
    let candidates = if !non_ended.is_empty() {
        non_ended
    } else {
        sessions.iter().collect()
    };

    let chosen = candidates
        .into_iter()
        .fold(None, |acc: Option<&Value>, item| match acc {
            None => Some(item),
            Some(best) => {
                let t_best = get_activity_time(best);
                let t_item = get_activity_time(item);
                if t_item > t_best {
                    Some(item)
                } else {
                    Some(best)
                }
            }
        });

    chosen
        .and_then(|s| s.get("id"))
        .and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| v.as_u64().map(|n| n.to_string()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_pick_recent_session_id() {
        // Non-ended sessions with timestamps
        let result = json!({
            "sessions": [
                { "id": "s_old", "last_active": 100.0 },
                { "id": "s_ended", "ended_at": 500.0, "last_active": 400.0 },
                { "id": "s_new", "last_active": 300.0 }
            ]
        });
        assert_eq!(pick_recent_session_id(&result).as_deref(), Some("s_new"));

        // Live gateway format without ended_at or last_active
        let result_live = json!({
            "sessions": [
                { "id": "20261002_104227_d70b0d6b", "title": "Run Hermes hook", "started_at": 1790952147.97 },
                { "id": "api-414ed9885e13e61f", "title": "Other", "started_at": 1790950000.0 }
            ]
        });
        assert_eq!(
            pick_recent_session_id(&result_live).as_deref(),
            Some("20261002_104227_d70b0d6b")
        );

        // All ended sessions fall back to the first
        let result_all_ended = json!({
            "sessions": [
                { "id": "s_ended_1", "ended_at": 100 },
                { "id": "s_ended_2", "ended_at": 200 }
            ]
        });
        assert_eq!(pick_recent_session_id(&result_all_ended).as_deref(), Some("s_ended_1"));

        // Empty sessions
        let result_empty = json!({ "sessions": [] });
        assert_eq!(pick_recent_session_id(&result_empty), None);
    }

    #[test]
    fn test_is_ended_and_get_activity_time() {
        let not_ended = json!({ "id": "1", "last_active": 50.5 });
        assert!(!is_ended(&not_ended));
        assert_eq!(get_activity_time(&not_ended), 50.5);

        let ended_bool = json!({ "id": "2", "ended_at": true });
        assert!(is_ended(&ended_bool));

        let fallback_started = json!({ "id": "3", "started_at": "123.45" });
        assert_eq!(get_activity_time(&fallback_started), 123.45);
    }
}
