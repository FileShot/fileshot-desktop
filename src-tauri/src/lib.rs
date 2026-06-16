mod chat;
mod embed;
mod oauth;
mod services;
mod state;
mod zke;

use services::share::build_share_url;
use services::upload::{download_file, notify_embed_download, upload_files, UploadOptions};
use services::preview::preview_thumb_path;
use services::{
    load_session, persist_favorites, persist_keyring, persist_session, persist_settings, ApiClient,
};
use serde_json::json;
use state::{AppSettings, KeyringEntry, SessionState, SharedState};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

struct AppCtx {
    state: SharedState,
    api: ApiClient,
}

#[tauri::command]
async fn auth_login(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    email: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let res = ctx
        .api
        .post_json(
            &ctx.state,
            "/auth/login",
            &json!({ "email": email, "password": password }),
            false,
        )
        .await?;
    if res.get("requires_2fa").and_then(|v| v.as_bool()) == Some(true) {
        return Err("Two-factor authentication required. Use the web app to complete login.".into());
    }
    apply_session(&ctx.state, &res)?;
    persist_session(&app, &ctx.state).await?;
    Ok(res)
}

#[tauri::command]
async fn auth_register(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    email: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let res = ctx
        .api
        .post_json(
            &ctx.state,
            "/auth/register",
            &json!({ "email": email, "password": password }),
            false,
        )
        .await?;
    apply_session(&ctx.state, &res)?;
    persist_session(&app, &ctx.state).await?;
    Ok(res)
}

#[tauri::command]
async fn auth_oauth(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    provider: String,
) -> Result<serde_json::Value, String> {
    oauth::run_oauth_flow(app, ctx.state.clone(), ctx.api.clone(), &provider).await
}

#[tauri::command]
async fn auth_exchange_code(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    code: String,
) -> Result<serde_json::Value, String> {
    let res = ctx
        .api
        .post_json(
            &ctx.state,
            "/auth/exchange-code",
            &json!({ "code": code }),
            false,
        )
        .await?;
    apply_session(&ctx.state, &res)?;
    persist_session(&app, &ctx.state).await?;
    Ok(res)
}

fn apply_session(state: &SharedState, res: &serde_json::Value) -> Result<(), String> {
    let token = res
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or("No token in response")?;
    let user = res.get("user").cloned().unwrap_or(json!({}));
    let mut session = state.session.write();
    session.token = Some(token.to_string());
    session.csrf_token = res
        .get("csrfToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    session.email = user.get("email").and_then(|v| v.as_str()).map(|s| s.to_string());
    session.user_id = user.get("id").and_then(|v| v.as_i64());
    session.tier = user
        .get("effective_tier")
        .or_else(|| user.get("subscription_tier"))
        .or_else(|| user.get("tier"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(())
}

#[tauri::command]
fn auth_get_session(ctx: State<'_, AppCtx>) -> SessionState {
    ctx.state.session.read().clone()
}

#[tauri::command]
async fn auth_logout(ctx: State<'_, AppCtx>, app: AppHandle) -> Result<(), String> {
    let _ = ctx.api.post_json(&ctx.state, "/auth/logout", &json!({}), true).await;
    *ctx.state.session.write() = SessionState::default();
    persist_session(&app, &ctx.state).await?;
    Ok(())
}

#[tauri::command]
async fn auth_me(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/auth/me").await
}

#[tauri::command]
async fn files_list(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/files/my-files").await
}

#[tauri::command]
async fn files_usage(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/files/usage").await
}

#[tauri::command]
async fn files_delete(ctx: State<'_, AppCtx>, file_id: String) -> Result<(), String> {
    ctx.api
        .delete(&ctx.state, &format!("/files/delete/{file_id}"))
        .await?;
    ctx.state.keyring.write().remove(&file_id);
    Ok(())
}

#[tauri::command]
async fn files_update(
    ctx: State<'_, AppCtx>,
    file_id: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ctx.api
        .put_json(&ctx.state, &format!("/files/{file_id}"), &payload)
        .await
}

#[tauri::command]
async fn files_move(
    ctx: State<'_, AppCtx>,
    file_ids: Vec<String>,
    folder_id: Option<String>,
) -> Result<serde_json::Value, String> {
    ctx.api
        .post_json(
            &ctx.state,
            "/files/move",
            &json!({ "fileIds": file_ids, "folderId": folder_id }),
            true,
        )
        .await
}

#[tauri::command]
async fn files_versions(
    ctx: State<'_, AppCtx>,
    file_id: String,
) -> Result<serde_json::Value, String> {
    ctx.api
        .get_json(&ctx.state, &format!("/files/versions/{file_id}"))
        .await
}

#[tauri::command]
async fn folders_list(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/folders").await
}

#[tauri::command]
async fn folders_create(
    ctx: State<'_, AppCtx>,
    name: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    ctx.api
        .post_json(
            &ctx.state,
            "/folders",
            &json!({ "name": name, "parentId": parent_id }),
            true,
        )
        .await
}

#[tauri::command]
async fn inbox_list(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/inbox").await
}

#[tauri::command]
async fn inbox_create(
    ctx: State<'_, AppCtx>,
    title: String,
    description: Option<String>,
) -> Result<serde_json::Value, String> {
    ctx.api
        .post_json(
            &ctx.state,
            "/inbox",
            &json!({
                "title": title,
                "description": description.unwrap_or_default(),
            }),
            true,
        )
        .await
}

#[tauri::command]
async fn inbox_delete(ctx: State<'_, AppCtx>, request_id: String) -> Result<(), String> {
    ctx.api
        .delete(&ctx.state, &format!("/inbox/{request_id}"))
        .await?;
    Ok(())
}

#[tauri::command]
async fn embed_open(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    embed::embed_open(&app, &ctx.state, &url, x, y, width, height)
}

#[tauri::command]
async fn embed_move(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    embed::embed_move(&app, &ctx.state, &url, x, y, width, height)
}

#[tauri::command]
fn embed_close(app: AppHandle) {
    embed::embed_close(&app);
}

#[tauri::command]
async fn preview_thumb(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    file_id: String,
    is_zero_knowledge: bool,
) -> Result<Option<String>, String> {
    preview_thumb_path(&app, &ctx.state, &ctx.api, &file_id, is_zero_knowledge).await
}

#[tauri::command]
async fn chat_rooms(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/chat/my-rooms").await
}

#[tauri::command]
async fn chat_delete(ctx: State<'_, AppCtx>, room_id: String) -> Result<(), String> {
    ctx.api
        .delete(&ctx.state, &format!("/chat/rooms/{room_id}"))
        .await?;
    Ok(())
}

#[tauri::command]
fn embed_resize(app: AppHandle, x: f64, y: f64, width: f64, height: f64) {
    embed::embed_resize(&app, x, y, width, height);
}

#[tauri::command]
async fn chat_open(_ctx: State<'_, AppCtx>, _app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn chat_close(app: AppHandle) {
    embed::embed_close(&app);
}

#[tauri::command]
async fn auth_sync_session(ctx: State<'_, AppCtx>, app: AppHandle) -> Result<SessionState, String> {
    let res = ctx.api.get_json(&ctx.state, "/auth/me").await?;
    if let Some(user) = res.get("user") {
        let mut session = ctx.state.session.write();
        if let Some(email) = user.get("email").and_then(|v| v.as_str()) {
            session.email = Some(email.to_string());
        }
        if let Some(id) = user.get("id").and_then(|v| v.as_i64()) {
            session.user_id = Some(id);
        }
        session.tier = user
            .get("effective_tier")
            .or_else(|| user.get("subscription_tier"))
            .or_else(|| user.get("tier"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    persist_session(&app, &ctx.state).await?;
    Ok(ctx.state.session.read().clone())
}

#[tauri::command]
async fn payments_confirm_checkout(
    ctx: State<'_, AppCtx>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    ctx.api
        .post_json(
            &ctx.state,
            "/payments/confirm-checkout",
            &json!({ "sessionId": session_id }),
            true,
        )
        .await
}

#[tauri::command]
async fn payments_checkout(
    ctx: State<'_, AppCtx>,
    tier: String,
    interval: Option<String>,
) -> Result<serde_json::Value, String> {
    let billing = interval.unwrap_or_else(|| "month".to_string());
    ctx.api
        .post_json(
            &ctx.state,
            "/payments/create-checkout",
            &json!({ "tier": tier, "interval": billing }),
            true,
        )
        .await
}

#[tauri::command]
async fn auth_refresh_csrf(ctx: State<'_, AppCtx>) -> Result<(), String> {
    let res = ctx.api.post_json(&ctx.state, "/auth/refresh-csrf", &json!({}), true).await?;
    if let Some(token) = res.get("csrfToken").and_then(|v| v.as_str()) {
        ctx.state.session.write().csrf_token = Some(token.to_string());
    }
    Ok(())
}

#[tauri::command]
fn file_share_url(ctx: State<'_, AppCtx>, file_id: String, custom_link: Option<String>) -> String {
    let kr = ctx.state.keyring.read();
    if let Some(entry) = kr.get(&file_id) {
        if let Some(ref url) = entry.share_url {
            if !url.is_empty() {
                return url.clone();
            }
        }
        return build_share_url(
            &file_id,
            custom_link.as_deref(),
            Some(entry.raw_key.as_str()),
        );
    }
    build_share_url(&file_id, custom_link.as_deref(), None)
}

#[tauri::command]
fn keyring_has(ctx: State<'_, AppCtx>, file_id: String) -> bool {
    ctx.state.keyring.read().contains_key(&file_id)
}

#[tauri::command]
fn app_log_write(app: AppHandle, message: String) -> Result<(), String> {
    use std::io::Write;
    let path = services::app_data_file(&app, "desktop.log")?;
    let line = format!(
        "{} {}\n",
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ"),
        message
    );
    std::fs::create_dir_all(path.parent().unwrap()).ok();
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn keyring_ids(ctx: State<'_, AppCtx>) -> Vec<String> {
    ctx.state.keyring.read().keys().cloned().collect()
}

#[tauri::command]
async fn api_keys_list(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/keys").await
}

#[tauri::command]
async fn user_change_password(
    ctx: State<'_, AppCtx>,
    current_password: String,
    new_password: String,
) -> Result<serde_json::Value, String> {
    ctx.api
        .post_json(
            &ctx.state,
            "/user/change-password",
            &json!({ "currentPassword": current_password, "newPassword": new_password }),
            true,
        )
        .await
}

#[tauri::command]
async fn user_2fa_status(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/user/2fa/status").await
}

#[tauri::command]
async fn payments_subscription(ctx: State<'_, AppCtx>) -> Result<serde_json::Value, String> {
    ctx.api.get_json(&ctx.state, "/payments/subscription").await
}

#[tauri::command]
async fn upload_paths(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    paths: Vec<String>,
    options: Option<UploadOptions>,
) -> Result<Vec<String>, String> {
    upload_files(
        app,
        ctx.state.clone(),
        ctx.api.clone(),
        paths,
        options.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
async fn download_file_cmd(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    file_id: String,
    save_path: String,
) -> Result<(), String> {
    download_file(app, ctx.state.clone(), ctx.api.clone(), file_id, save_path).await
}

#[tauri::command]
fn transfers_list(ctx: State<'_, AppCtx>) -> Vec<state::TransferItem> {
    ctx.state.transfers.read().clone()
}

#[tauri::command]
fn activity_list(ctx: State<'_, AppCtx>) -> Vec<state::ActivityItem> {
    ctx.state.activity.read().clone()
}

#[tauri::command]
fn favorites_list(ctx: State<'_, AppCtx>) -> Vec<String> {
    ctx.state.favorites.read().clone()
}

#[tauri::command]
async fn favorites_toggle(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    file_id: String,
) -> Result<Vec<String>, String> {
    let out = {
        let mut fav = ctx.state.favorites.write();
        if let Some(i) = fav.iter().position(|id| id == &file_id) {
            fav.remove(i);
        } else {
            fav.push(file_id);
        }
        fav.clone()
    };
    persist_favorites(&app, &ctx.state).await?;
    Ok(out)
}

#[tauri::command]
fn settings_get(ctx: State<'_, AppCtx>) -> AppSettings {
    ctx.state.settings.read().clone()
}

#[tauri::command]
async fn settings_set(
    ctx: State<'_, AppCtx>,
    app: AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    *ctx.state.settings.write() = settings.clone();
    persist_settings(&app, &ctx.state).await?;
    sync_autostart(&app, settings.autostart)?;
    Ok(())
}

fn sync_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let paths = app
        .dialog()
        .file()
        .add_filter("All files", &["*"])
        .blocking_pick_files();
    Ok(paths
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string())
        .collect())
}

#[tauri::command]
async fn pick_save_path(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
fn transfer_download_notify(app: AppHandle, ctx: State<'_, AppCtx>, name: String) {
    notify_embed_download(&app, &ctx.state, name);
}

#[tauri::command]
fn window_minimize(app: AppHandle) -> Result<(), String> {
    embed::embed_close(&app);
    if let Some(w) = app.get_webview_window("main") {
        w.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    embed::embed_close(&app);
    if let Some(w) = app.get_webview_window("main") {
        if w.is_maximized().unwrap_or(false) {
            w.unmaximize().map_err(|e| e.to_string())?;
        } else {
            w.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn window_close(app: AppHandle, ctx: State<'_, AppCtx>) -> Result<(), String> {
    embed::embed_close(&app);
    if let Some(w) = app.get_webview_window("main") {
        if ctx.state.settings.read().minimize_to_tray {
            w.hide().map_err(|e| e.to_string())?;
        } else {
            app.exit(0);
        }
    }
    Ok(())
}

#[tauri::command]
fn export_keyring(ctx: State<'_, AppCtx>) -> Result<String, String> {
    let keyring = ctx.state.keyring.read();
    serde_json::to_string_pretty(&*keyring).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_keyring(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    payload: String,
) -> Result<u32, String> {
    let parsed: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    let obj = parsed.as_object().ok_or("Expected a JSON object")?;
    let mut count = 0u32;
    {
        let mut kr = ctx.state.keyring.write();
        for (k, v) in obj {
            let (file_id, raw_key, original_name) = if let Some(entry) = v.as_object() {
                let fid = entry
                    .get("file_id")
                    .or_else(|| entry.get("fileId"))
                    .and_then(|x| x.as_str())
                    .unwrap_or(k.as_str());
                let key = entry
                    .get("raw_key")
                    .or_else(|| entry.get("rawKey"))
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| format!("Missing raw_key for {k}"))?;
                let name = entry
                    .get("original_name")
                    .or_else(|| entry.get("originalName"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("Imported");
                (fid.to_string(), key.to_string(), name.to_string())
            } else if let Some(s) = v.as_str() {
                (k.clone(), s.to_string(), "Imported".to_string())
            } else {
                continue;
            };
            kr.insert(
                file_id.clone(),
                KeyringEntry {
                    file_id,
                    raw_key,
                    original_name,
                    share_url: None,
                },
            );
            count += 1;
        }
    }
    persist_keyring(&app, &ctx.state).await?;
    Ok(count)
}

pub fn run() {
    let state: SharedState = Arc::new(state::AppState::new());
    let api = ApiClient::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(AppCtx {
            state: state.clone(),
            api: api.clone(),
        })
        .setup(move |app| {
            load_session(app.handle(), &state);
            embed::destroy_native_embed(app.handle());
            setup_tray(app.handle())?;
            let settings = state.settings.read().clone();
            let _ = sync_autostart(app.handle(), settings.autostart);
            if settings.start_minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if let Some(ctx) = app.try_state::<AppCtx>() {
                    if ctx.state.settings.read().minimize_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth_login,
            auth_register,
            auth_oauth,
            auth_exchange_code,
            auth_get_session,
            auth_logout,
            auth_me,
            files_list,
            files_usage,
            files_delete,
            files_update,
            files_move,
            files_versions,
            folders_list,
            folders_create,
            inbox_list,
            inbox_create,
            inbox_delete,
            chat_rooms,
            chat_delete,
            chat_open,
            chat_close,
            embed_open,
            embed_move,
            embed_close,
            embed_resize,
            preview_thumb,
            api_keys_list,
            user_change_password,
            user_2fa_status,
            payments_subscription,
            payments_checkout,
            payments_confirm_checkout,
            auth_refresh_csrf,
            auth_sync_session,
            file_share_url,
            keyring_has,
            keyring_ids,
            app_log_write,
            upload_paths,
            download_file_cmd,
            transfer_download_notify,
            transfers_list,
            activity_list,
            favorites_list,
            favorites_toggle,
            settings_get,
            settings_set,
            pick_files,
            pick_save_path,
            window_minimize,
            window_toggle_maximize,
            window_close,
            export_keyring,
            import_keyring,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Open FileShot", true, None::<&str>)?;
    let upload_i = MenuItem::with_id(app, "upload", "Quick Upload", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &upload_i, &quit_i])?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("FileShot")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "upload" => {
                let _ = app.emit("tray-quick-upload", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
