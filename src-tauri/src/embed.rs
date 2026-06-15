use crate::state::SharedState;
use parking_lot::Mutex;
use std::sync::LazyLock;
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};

const EMBED_LABEL: &str = "embed-panel";

/// Main content inset: icon rail + sidebar + titlebar + header row (logical px).
const EMBED_X: f64 = 276.0;
const EMBED_Y: f64 = 92.0;

struct EmbedState {
    last_url: Option<String>,
}

static EMBED: LazyLock<Mutex<EmbedState>> =
    LazyLock::new(|| Mutex::new(EmbedState { last_url: None }));

fn auth_init_script(state: &SharedState) -> Result<String, String> {
    let session = state.session.read();
    let token = session.token.clone().unwrap_or_default();
    let csrf = session.csrf_token.clone().unwrap_or_default();
    Ok(format!(
        "try{{localStorage.setItem('authToken',{});localStorage.setItem('csrfToken',{});}}catch(e){{}}",
        serde_json::to_string(&token).map_err(|e| e.to_string())?,
        serde_json::to_string(&csrf).map_err(|e| e.to_string())?
    ))
}

fn close_legacy_window(app: &AppHandle) {
    if let Some(legacy) = app.get_webview_window(EMBED_LABEL) {
        let _ = legacy.close();
    }
}

fn embed_content_size(main: &tauri::WebviewWindow) -> Result<(f64, f64), String> {
    let scale = main.scale_factor().unwrap_or(1.0);
    let inner = main.inner_size().map_err(|e| e.to_string())?;
    let w = (inner.width as f64 / scale) - EMBED_X;
    let h = (inner.height as f64 / scale) - EMBED_Y;
    Ok((w.max(400.0), h.max(300.0)))
}

fn embed_resize_inner(main: &tauri::WebviewWindow, embed: &tauri::Webview) {
    if let Ok((w, h)) = embed_content_size(main) {
        let _ = embed.set_position(Position::Logical(LogicalPosition::new(EMBED_X, EMBED_Y)));
        let _ = embed.set_size(Size::Logical(LogicalSize::new(w, h)));
    }
}

pub fn embed_open(app: &AppHandle, state: &SharedState, url: &str) -> Result<(), String> {
    close_legacy_window(app);

    let main_win = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let window = app.get_window("main").ok_or("Main window not found")?;
    let parsed: url::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;

    if let Some(existing) = app.get_webview(EMBED_LABEL) {
        let same_url = EMBED.lock().last_url.as_deref() == Some(url);
        if same_url {
            let _ = existing.show();
            embed_resize_inner(&main_win, &existing);
            return Ok(());
        }
        existing.navigate(parsed).map_err(|e| e.to_string())?;
        let init = auth_init_script(state)?;
        let _ = existing.eval(&init);
        EMBED.lock().last_url = Some(url.to_string());
        let _ = existing.show();
        embed_resize_inner(&main_win, &existing);
        return Ok(());
    }

    let init = auth_init_script(state)?;
    let (w, h) = embed_content_size(&main_win)?;

    let builder = WebviewBuilder::new(EMBED_LABEL, WebviewUrl::External(parsed))
        .initialization_script(&init);

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(EMBED_X, EMBED_Y),
            LogicalSize::new(w, h),
        )
        .map_err(|e| e.to_string())?;

    let _ = webview.show();
    EMBED.lock().last_url = Some(url.to_string());
    Ok(())
}

pub fn embed_close(app: &AppHandle) {
    if let Some(w) = app.get_webview(EMBED_LABEL) {
        let _ = w.hide();
    }
    EMBED.lock().last_url = None;
}

pub fn embed_resize(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(embed) = app.get_webview(EMBED_LABEL) else {
        return;
    };
    embed_resize_inner(&main, &embed);
}
