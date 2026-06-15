use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub autostart: bool,
    pub minimize_to_tray: bool,
    pub start_minimized: bool,
    pub chat_notifications: bool,
    #[serde(default = "default_notification_sound")]
    pub notification_sound: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub master_key_enabled: bool,
    #[serde(default)]
    pub master_key: Option<String>,
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_notification_sound() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub token: Option<String>,
    pub csrf_token: Option<String>,
    pub email: Option<String>,
    pub user_id: Option<i64>,
    pub tier: Option<String>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            token: None,
            csrf_token: None,
            email: None,
            user_id: None,
            tier: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyringEntry {
    pub file_id: String,
    pub raw_key: String,
    pub original_name: String,
    #[serde(default)]
    pub share_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    pub progress: f64,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub share_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub at: i64,
    pub file_id: Option<String>,
}

pub struct AppState {
    pub session: RwLock<SessionState>,
    pub settings: RwLock<AppSettings>,
    pub keyring: RwLock<HashMap<String, KeyringEntry>>,
    pub transfers: RwLock<Vec<TransferItem>>,
    pub favorites: RwLock<Vec<String>>,
    pub activity: RwLock<Vec<ActivityItem>>,
    pub api_base: String,
}

impl AppState {
    pub fn new() -> Self {
        let api_base = std::env::var("FILESHOT_API_BASE")
            .unwrap_or_else(|_| "https://api.fileshot.io/api".into());
        Self {
            session: RwLock::new(SessionState::default()),
            settings: RwLock::new(AppSettings {
                autostart: false,
                minimize_to_tray: true,
                start_minimized: false,
                chat_notifications: true,
                notification_sound: true,
                theme: "system".to_string(),
                master_key_enabled: false,
                master_key: None,
            }),
            keyring: RwLock::new(HashMap::new()),
            transfers: RwLock::new(Vec::new()),
            favorites: RwLock::new(Vec::new()),
            activity: RwLock::new(Vec::new()),
            api_base,
        }
    }
}

pub type SharedState = Arc<AppState>;
