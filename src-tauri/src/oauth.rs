use crate::services::{persist_session, ApiClient};
use crate::state::SharedState;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl};
use url::Url;

type OAuthResult = Result<Value, String>;
type OAuthSender = tokio::sync::oneshot::Sender<OAuthResult>;

fn query_param(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}

fn finish_oauth(
    tx_holder: &Arc<Mutex<Option<OAuthSender>>>,
    app: &AppHandle,
    label: &str,
    completed: &Arc<AtomicBool>,
    result: OAuthResult,
) {
    if completed.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(mut guard) = tx_holder.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(result);
        }
    }
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
}

async fn exchange_oauth_code(
    app: &AppHandle,
    state: &SharedState,
    api: &ApiClient,
    code: &str,
) -> OAuthResult {
    let res = api
        .post_json(
            state,
            "/auth/exchange-code",
            &json!({ "code": code }),
            false,
        )
        .await?;
    super::apply_session(state, &res)?;
    persist_session(app, state).await?;
    super::schedule_vault_hydrate(api.clone(), state.clone(), app.clone());
    Ok(res)
}

pub async fn run_oauth_flow(
    app: AppHandle,
    state: SharedState,
    api: ApiClient,
    provider: &str,
) -> OAuthResult {
    if provider != "google" && provider != "github" {
        return Err("Unsupported OAuth provider".into());
    }

    let oauth_url = format!("{}/auth/{}?redirect=/", state.api_base, provider);
    let parsed: Url = oauth_url
        .parse()
        .map_err(|e| format!("Invalid OAuth URL: {e}"))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<OAuthResult>();
    let tx_holder: Arc<Mutex<Option<OAuthSender>>> = Arc::new(Mutex::new(Some(tx)));
    let completed = Arc::new(AtomicBool::new(false));

    let label = format!("oauth-{}", uuid::Uuid::new_v4());
    let win_label = label.clone();

    let app_nav = app.clone();
    let state_nav = state.clone();
    let api_nav = api.clone();
    let tx_nav = tx_holder.clone();
    let label_nav = label.clone();
    let completed_nav = completed.clone();

    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(format!("Sign in with {}", provider))
        .inner_size(520.0, 700.0)
        .center()
        .on_navigation(move |url| {
            if let Some(code) = query_param(url, "auth_code") {
                let app = app_nav.clone();
                let state = state_nav.clone();
                let api = api_nav.clone();
                let tx_holder = tx_nav.clone();
                let label = label_nav.clone();
                let completed = completed_nav.clone();
                tauri::async_runtime::spawn(async move {
                    let result = exchange_oauth_code(&app, &state, &api, &code).await;
                    finish_oauth(&tx_holder, &app, &label, &completed, result);
                });
                return false;
            }
            if let Some(err) = query_param(url, "error") {
                finish_oauth(
                    &tx_nav,
                    &app_nav,
                    &label_nav,
                    &completed_nav,
                    Err(err.replace('_', " ")),
                );
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    let tx_close = tx_holder.clone();
    let app_close = app.clone();
    let completed_close = completed.clone();
    win.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            finish_oauth(
                &tx_close,
                &app_close,
                &win_label,
                &completed_close,
                Err("Sign-in window closed".into()),
            );
        }
    });

    rx.await.map_err(|_| "OAuth flow interrupted".to_string())?
}
