// Notion integration poller: recently edited pages and databases.

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::secrets;

use super::{client, emit, emit_status_error, IntegrationUpdate};

pub async fn poll(app: AppHandle) {
    let Some(token) = secrets::get("notion-api-key") else { return };
    let response = client()
        .post("https://api.notion.com/v1/search")
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", "2022-06-28")
        .header("Content-Type", "application/json")
        .json(&json!({
            "sort": { "direction": "descending", "timestamp": "last_edited_time" },
            "page_size": 3
        }))
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit_status_error(&app, "integration_notion", response.status().as_u16(), "Integration lacks access");
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let pages: Vec<Value> = json
        .get("results")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(parse_notion_page).collect())
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_notion",
        data: json!({ "pages": pages }),
        error: None,
        event: None,
    });
}

pub fn parse_notion_page(obj: &Value) -> Option<Value> {
    let id = obj.get("id")?.as_str()?;
    let is_database = obj.get("object").and_then(Value::as_str) == Some("database");

    let mut title = "Untitled".to_string();
    if is_database {
        if let Some(text) = obj
            .get("title")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|t| t.get("plain_text"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                title = text.to_string();
            }
        }
    } else if let Some(props) = obj.get("properties").and_then(Value::as_object) {
        for prop in props.values() {
            if prop.get("type").and_then(Value::as_str) != Some("title") {
                continue;
            }
            if let Some(text) = prop
                .get("title")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(|t| t.get("plain_text"))
                .and_then(Value::as_str)
            {
                if !text.is_empty() {
                    title = text.to_string();
                    break;
                }
            }
        }
    }

    let emoji = obj
        .get("icon")
        .filter(|i| i.get("type").and_then(Value::as_str) == Some("emoji"))
        .and_then(|i| i.get("emoji"))
        .and_then(Value::as_str);

    Some(json!({
        "id": id,
        "title": title,
        "emoji": emoji,
        "lastEditedAt": obj.get("last_edited_time").and_then(Value::as_str)?,
        "url": obj.get("url").and_then(Value::as_str).unwrap_or("https://notion.so"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_notion_page_database() {
        let db = json!({
            "id": "db-123",
            "object": "database",
            "last_edited_time": "2026-10-02T12:00:00Z",
            "url": "https://notion.so/db-123",
            "title": [
                { "plain_text": "Projects DB" }
            ],
            "icon": {
                "type": "emoji",
                "emoji": "📁"
            }
        });
        let parsed = parse_notion_page(&db).expect("should parse");
        assert_eq!(parsed["id"], "db-123");
        assert_eq!(parsed["title"], "Projects DB");
        assert_eq!(parsed["emoji"], "📁");
        assert_eq!(parsed["lastEditedAt"], "2026-10-02T12:00:00Z");
        assert_eq!(parsed["url"], "https://notion.so/db-123");
    }

    #[test]
    fn test_parse_notion_page_regular_page() {
        let page = json!({
            "id": "page-456",
            "object": "page",
            "last_edited_time": "2026-10-02T13:00:00Z",
            "properties": {
                "Name": {
                    "type": "title",
                    "title": [{ "plain_text": "My Document" }]
                }
            }
        });
        let parsed = parse_notion_page(&page).expect("should parse");
        assert_eq!(parsed["id"], "page-456");
        assert_eq!(parsed["title"], "My Document");
        assert_eq!(parsed["emoji"], Value::Null);
        assert_eq!(parsed["url"], "https://notion.so");
    }
}
