use crate::services::ApiClient;
use crate::state::SharedState;
use crate::zke;
use tauri::{AppHandle, Manager};

pub async fn preview_thumb_path(
    app: &AppHandle,
    state: &SharedState,
    api: &ApiClient,
    file_id: &str,
    is_zke: bool,
) -> Result<Option<String>, String> {
    if !is_zke {
        return Ok(None);
    }

    let raw_key = {
        let kr = state.keyring.read();
        kr.get(file_id).map(|e| e.raw_key.clone())
    };
    let Some(raw_key) = raw_key else {
        return Ok(None);
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("previews");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let out_path = cache_dir.join(format!("{file_id}.thumb"));

    if out_path.is_file() {
        return Ok(Some(out_path.to_string_lossy().into_owned()));
    }

    let url = format!("{}/files/download/{}", state.api_base, file_id);
    let mut req = api.client.get(&url);
    if let Some(h) = ApiClient::auth_header(state) {
        req = req.header("Authorization", h);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("download failed: {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    let tmp_enc = cache_dir.join(format!("{file_id}.enc"));
    std::fs::write(&tmp_enc, &bytes).map_err(|e| e.to_string())?;

    let decrypt_out = cache_dir.join(format!("{file_id}.dec"));
    zke::decrypt_zke_container(&tmp_enc, &decrypt_out, Some(&raw_key), None)
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp_enc);

    let meta = std::fs::metadata(&decrypt_out).map_err(|e| e.to_string())?;
    if meta.len() > 8 * 1024 * 1024 {
        let _ = std::fs::remove_file(&decrypt_out);
        return Ok(None);
    }

    if std::fs::rename(&decrypt_out, &out_path).is_err() {
        std::fs::copy(&decrypt_out, &out_path).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&decrypt_out);
    }

    Ok(Some(out_path.to_string_lossy().into_owned()))
}
