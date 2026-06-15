pub mod preview;
pub mod share;
pub mod upload;

use crate::state::{ActivityItem, SharedState, TransferItem};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
    pub message: String,
}

impl From<reqwest::Error> for ApiError {
    fn from(e: reqwest::Error) -> Self {
        ApiError {
            message: e.to_string(),
        }
    }
}

pub struct ApiClient {
    pub client: reqwest::Client,
}

impl Clone for ApiClient {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
        }
    }
}

impl ApiClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("FileShot-Desktop/1.0.0")
                .build()
                .unwrap_or_default(),
        }
    }

    pub fn auth_header(state: &SharedState) -> Option<String> {
        state
            .session
            .read()
            .token
            .as_ref()
            .map(|t| format!("Bearer {t}"))
    }

    pub async fn post_json(
        &self,
        state: &SharedState,
        path: &str,
        body: &Value,
        with_csrf: bool,
    ) -> Result<Value, String> {
        let url = format!("{}{}", state.api_base, path);
        let mut req = self.client.post(&url).json(body);
        if let Some(h) = Self::auth_header(state) {
            req = req.header("Authorization", h);
        }
        if with_csrf {
            if let Some(csrf) = state.session.read().csrf_token.clone() {
                req = req.header("X-CSRF-Token", csrf);
            }
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status();
        let text = res.text().await.map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
            serde_json::json!({ "error": text })
        });
        if !status.is_success() {
            return Err(json
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed")
                .to_string());
        }
        Ok(json)
    }

    pub async fn get_json(&self, state: &SharedState, path: &str) -> Result<Value, String> {
        let url = format!("{}{}", state.api_base, path);
        let mut req = self.client.get(&url);
        if let Some(h) = Self::auth_header(state) {
            req = req.header("Authorization", h);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status();
        let text = res.text().await.map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
            serde_json::json!({ "error": text })
        });
        if !status.is_success() {
            return Err(json
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed")
                .to_string());
        }
        Ok(json)
    }

    pub async fn delete(
        &self,
        state: &SharedState,
        path: &str,
    ) -> Result<Value, String> {
        let url = format!("{}{}", state.api_base, path);
        let mut req = self.client.delete(&url);
        if let Some(h) = Self::auth_header(state) {
            req = req.header("Authorization", h);
        }
        if let Some(csrf) = state.session.read().csrf_token.clone() {
            req = req.header("X-CSRF-Token", csrf);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status();
        let text = res.text().await.map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
            serde_json::json!({ "error": text })
        });
        if !status.is_success() {
            return Err(json
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed")
                .to_string());
        }
        Ok(json)
    }

    pub async fn put_json(
        &self,
        state: &SharedState,
        path: &str,
        body: &Value,
    ) -> Result<Value, String> {
        let url = format!("{}{}", state.api_base, path);
        let mut req = self.client.put(&url).json(body);
        if let Some(h) = Self::auth_header(state) {
            req = req.header("Authorization", h);
        }
        if let Some(csrf) = state.session.read().csrf_token.clone() {
            req = req.header("X-CSRF-Token", csrf);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status();
        let text = res.text().await.map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
            serde_json::json!({ "error": text })
        });
        if !status.is_success() {
            return Err(json
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed")
                .to_string());
        }
        Ok(json)
    }
}

pub fn emit_transfer_update(app: &AppHandle, transfers: &[TransferItem]) {
    let _ = app.emit("transfers-updated", transfers);
}

pub fn add_activity(state: &SharedState, kind: &str, name: &str, file_id: Option<String>) {
    let item = ActivityItem {
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.into(),
        name: name.into(),
        at: chrono::Utc::now().timestamp(),
        file_id,
    };
    let mut act = state.activity.write();
    act.insert(0, item);
    if act.len() > 200 {
        act.truncate(200);
    }
}

pub fn app_data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

pub async fn persist_session(app: &AppHandle, state: &SharedState) -> Result<(), String> {
    let path = app_data_file(app, "session.json")?;
    let session = state.session.read().clone();
    let data = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_session(app: &AppHandle, state: &SharedState) {
    if let Ok(path) = app_data_file(app, "session.json") {
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(session) = serde_json::from_str(&data) {
                *state.session.write() = session;
            }
        }
    }
    if let Ok(path) = app_data_file(app, "settings.json") {
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str(&data) {
                *state.settings.write() = settings;
            }
        }
    }
    if let Ok(path) = app_data_file(app, "keyring.json") {
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(map) = serde_json::from_str(&data) {
                *state.keyring.write() = map;
            }
        }
    }
    if let Ok(path) = app_data_file(app, "favorites.json") {
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(fav) = serde_json::from_str(&data) {
                *state.favorites.write() = fav;
            }
        }
    }
}

pub async fn persist_settings(app: &AppHandle, state: &SharedState) -> Result<(), String> {
    let path = app_data_file(app, "settings.json")?;
    let settings = state.settings.read().clone();
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn persist_keyring(app: &AppHandle, state: &SharedState) -> Result<(), String> {
    let path = app_data_file(app, "keyring.json")?;
    let keyring = state.keyring.read().clone();
    let data = serde_json::to_string_pretty(&keyring).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn persist_favorites(app: &AppHandle, state: &SharedState) -> Result<(), String> {
    let path = app_data_file(app, "favorites.json")?;
    let favorites = state.favorites.read().clone();
    let data = serde_json::to_string_pretty(&favorites).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}
