use crate::state::SharedState;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl};

const EMBED_LABEL: &str = "embed-panel";

/// Main content inset: icon rail + sidebar + titlebar + header row (logical px).
const EMBED_X: f64 = 276.0;
const EMBED_Y: f64 = 92.0;

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

pub fn embed_open(app: &AppHandle, state: &SharedState, url: &str) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Main window not found")?;
    let init = auth_init_script(state)?;
    let parsed: url::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;

    if let Some(existing) = app.get_webview_window(EMBED_LABEL) {
        existing
            .eval(&format!("window.location.replace({});", serde_json::to_string(url).map_err(|e| e.to_string())?))
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let (w, h) = embed_content_size(&main)?;

    let win = WebviewWindowBuilder::new(app, EMBED_LABEL, WebviewUrl::External(parsed))
        .title("FileShot")
        .parent(&main)
        .map_err(|e| e.to_string())?
        .decorations(false)
        .visible(true)
        .focused(true)
        .position(EMBED_X, EMBED_Y)
        .inner_size(w, h)
        .initialization_script(&init)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win;

    Ok(())
}

pub fn embed_close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(EMBED_LABEL) {
        let _ = w.hide();
    }
}

fn embed_content_size(main: &tauri::WebviewWindow) -> Result<(f64, f64), String> {
    let scale = main.scale_factor().unwrap_or(1.0);
    let inner = main.inner_size().map_err(|e| e.to_string())?;
    let w = (inner.width as f64 / scale) - EMBED_X;
    let h = (inner.height as f64 / scale) - EMBED_Y;
    Ok((w.max(400.0), h.max(300.0)))
}

pub fn embed_resize(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(embed) = app.get_webview_window(EMBED_LABEL) else {
        return;
    };
    if let Ok((w, h)) = embed_content_size(&main) {
        let _ = embed.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
            EMBED_X, EMBED_Y,
        )));
        let _ = embed.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
    }
}
