use crate::state::SharedState;
use parking_lot::Mutex;
use std::sync::LazyLock;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};
use tauri::webview::WebviewBuilder;

const EMBED_LABEL: &str = "embed-panel";

struct EmbedState {
    last_url: Option<String>,
}

static EMBED: LazyLock<Mutex<EmbedState>> =
    LazyLock::new(|| Mutex::new(EmbedState { last_url: None }));

#[derive(Clone, Copy)]
struct EmbedBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

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

/// Tear down legacy native overlay webviews from v1.0.2–v1.0.3.
pub fn destroy_native_embed(app: &AppHandle) {
    if let Some(legacy) = app.get_webview_window(EMBED_LABEL) {
        let _ = legacy.close();
    }
    if let Some(w) = app.get_webview(EMBED_LABEL) {
        let _ = w.close();
    }
    EMBED.lock().last_url = None;
}

fn close_legacy_window(app: &AppHandle) {
    if let Some(legacy) = app.get_webview_window(EMBED_LABEL) {
        let _ = legacy.close();
    }
}

fn apply_bounds(embed: &tauri::Webview, bounds: EmbedBounds) -> Result<(), String> {
    embed
        .set_position(Position::Logical(LogicalPosition::new(bounds.x, bounds.y)))
        .map_err(|e| e.to_string())?;
    embed
        .set_size(Size::Logical(LogicalSize::new(
            bounds.width.max(120.0),
            bounds.height.max(120.0),
        )))
        .map_err(|e| e.to_string())
}

pub fn embed_open(
    app: &AppHandle,
    state: &SharedState,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if width < 8.0 || height < 8.0 {
        return Err("Embed area too small".into());
    }

    close_legacy_window(app);

    if app.get_webview(EMBED_LABEL).is_some() {
        return embed_move(app, state, url, x, y, width, height);
    }

    let window = app.get_window("main").ok_or("Main window not found")?;
    let parsed: url::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    let bounds = EmbedBounds {
        x,
        y,
        width,
        height,
    };

    let init = auth_init_script(state)?;
    let download_hook = r#"
(function(){
  function notify(name){
    try{window.__TAURI_INTERNALS__.invoke('transfer_download_notify',{name:name||'Download'});}catch(e){}
  }
  window.__fileshotDesktopDownload=notify;
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;
    if(a) notify(a.download||a.textContent||'Download');
  },true);
  var origClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.hasAttribute('download')) notify(this.download||this.textContent||'Download');
    return origClick.call(this);
  };
})();
"#;

    let builder = WebviewBuilder::new(EMBED_LABEL, WebviewUrl::External(parsed))
        .initialization_script(&init)
        .initialization_script(download_hook)
        .focused(false);

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;

    EMBED.lock().last_url = Some(url.to_string());
    let _ = webview.show();
    Ok(())
}

pub fn embed_move(
    app: &AppHandle,
    state: &SharedState,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if width < 8.0 || height < 8.0 {
        if let Some(w) = app.get_webview(EMBED_LABEL) {
            park_embed_offscreen(&w);
        }
        return Ok(());
    }

    let bounds = EmbedBounds {
        x,
        y,
        width,
        height,
    };

    if let Some(existing) = app.get_webview(EMBED_LABEL) {
        let same_url = EMBED.lock().last_url.as_deref() == Some(url);
        if !same_url {
            let parsed: url::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
            existing.navigate(parsed).map_err(|e| e.to_string())?;
            let init = auth_init_script(state)?;
            let _ = existing.eval(&init);
            EMBED.lock().last_url = Some(url.to_string());
        }
        apply_bounds(&existing, bounds)?;
        let _ = existing.show();
        return Ok(());
    }

    embed_open(app, state, url, x, y, width, height)
}

fn park_embed_offscreen(embed: &tauri::Webview) {
    let _ = embed.set_position(Position::Logical(LogicalPosition::new(-10_000.0, -10_000.0)));
    let _ = embed.set_size(Size::Logical(LogicalSize::new(1.0, 1.0)));
    let _ = embed.hide();
}

pub fn embed_close(app: &AppHandle) {
    if let Some(w) = app.get_webview(EMBED_LABEL) {
        let _ = w.close();
    }
    EMBED.lock().last_url = None;
}

pub fn embed_resize(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) {
    let Some(embed) = app.get_webview(EMBED_LABEL) else {
        return;
    };
    if width < 8.0 || height < 8.0 {
        if let Some(w) = app.get_webview(EMBED_LABEL) {
            park_embed_offscreen(&w);
        }
        return;
    }
    let bounds = EmbedBounds {
        x,
        y,
        width,
        height,
    };
    let _ = apply_bounds(&embed, bounds);
    let _ = embed.show();
}
