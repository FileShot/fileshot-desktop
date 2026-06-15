use crate::state::SharedState;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl};

pub fn open_chat(app: &AppHandle, state: &SharedState) -> Result<(), String> {
    let token = state
        .session
        .read()
        .token
        .clone()
        .ok_or("Not signed in")?;

    let label = "chat-panel";
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let main = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    let init = format!(
        "try{{localStorage.setItem('authToken',{});}}catch(e){{}}",
        serde_json::to_string(&token).map_err(|e| e.to_string())?
    );

    let parsed: url::Url = "https://fileshot.io/chat.html"
        .parse()
        .map_err(|e| format!("Invalid chat URL: {e}"))?;

    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title("FileShot Chat")
        .parent(&main)
        .map_err(|e| e.to_string())?
        .inner_size(900.0, 640.0)
        .center()
        .initialization_script(&init)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win;

    Ok(())
}

pub fn close_chat(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("chat-panel") {
        let _ = w.close();
    }
}
