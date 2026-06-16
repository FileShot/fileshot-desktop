use crate::services::{add_activity, append_app_log, emit_transfer_update, persist_keyring, share::build_share_url, ApiClient};
use crate::state::{KeyringEntry, SharedState, TransferItem};
use crate::zke::{self, DEFAULT_CHUNK_SIZE};
use mime_guess::from_path;
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const CHUNK_UPLOAD_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct UploadOptions {
    pub expiration_days: Option<u32>,
    pub max_downloads: Option<u32>,
    pub password: Option<String>,
    pub custom_link: Option<String>,
    pub use_master_key: Option<bool>,
}

pub async fn upload_files(
    app: AppHandle,
    state: SharedState,
    api: ApiClient,
    paths: Vec<String>,
    options: UploadOptions,
) -> Result<Vec<String>, String> {
    let mut opts = options;
    clamp_upload_options(&state, &mut opts)?;
    let mut results = Vec::new();
    for path_str in paths {
        match upload_single_file(app.clone(), state.clone(), api.clone(), &path_str, &opts).await {
            Ok(url) => results.push(url),
            Err(e) => {
                append_app_log(&app, &format!("upload failed {path_str}: {e}"));
                let _ = app.emit("upload-error", json!({ "path": path_str, "error": e }));
            }
        }
    }
    Ok(results)
}

async fn upload_single_file(
    app: AppHandle,
    state: SharedState,
    api: ApiClient,
    path_str: &str,
    options: &UploadOptions,
) -> Result<String, String> {
    let path = PathBuf::from(path_str);
    if !path.is_file() {
        return Err("Not a file".into());
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let transfer_id = uuid::Uuid::new_v4().to_string();

    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let plain_size = meta.len();

    {
        let mut transfers = state.transfers.write();
        transfers.push(TransferItem {
            id: transfer_id.clone(),
            name: file_name.clone(),
            path: path_str.to_string(),
            status: "encrypting".into(),
            progress: 0.0,
            bytes_done: 0,
            bytes_total: plain_size,
            share_url: None,
            error: None,
            kind: "upload".into(),
        });
    }
    push_transfer_emit(&state, &app);

    append_app_log(
        &app,
        &format!("encrypt start: {} ({} bytes)", path_str, plain_size),
    );

    let tmp_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("uploads");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let enc_path = tmp_dir.join(format!("{}.fszk", transfer_id));

    let mime = from_path(&path)
        .first()
        .map(|m| m.essence_str().to_string())
        .unwrap_or_else(|| "application/octet-stream".into());

    let passphrase = resolve_passphrase(&state, options);
    let password_enabled = passphrase.is_some();

    let path_in = path.clone();
    let enc_path_bg = enc_path.clone();
    let file_name_bg = file_name.clone();
    let mime_bg = mime.clone();
    let pass_bg = passphrase.clone();

    let enc = tokio::task::spawn_blocking(move || {
        zke::encrypt_file_to_zke_container(
            &path_in,
            &enc_path_bg,
            Some(&file_name_bg),
            &mime_bg,
            None,
            pass_bg.as_deref(),
            DEFAULT_CHUNK_SIZE,
        )
    })
    .await
    .map_err(|e| format!("encrypt task failed: {e}"))?
    .map_err(|e| {
        let msg = e.to_string();
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "failed",
            0.0,
            0,
            plain_size,
            None,
            Some(msg.clone()),
        );
        msg
    })?;

    append_app_log(
        &app,
        &format!("encrypt done: {} -> {}", file_name, enc_path.display()),
    );

    let raw_key = enc.raw_key.clone().ok_or_else(|| {
        let msg = "Missing encryption key".to_string();
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "failed",
            0.0,
            0,
            plain_size,
            None,
            Some(msg.clone()),
        );
        msg
    })?;
    let enc_meta = std::fs::metadata(&enc_path).map_err(|e| e.to_string())?;
    let enc_size = enc_meta.len();
    let expiration_days = options.expiration_days.unwrap_or(180).max(1);

    update_transfer(
        &state,
        &app,
        &transfer_id,
        "uploading",
        5.0,
        0,
        enc_size,
        None,
        None,
    );

    let pre = api
        .post_json(
            &state,
            "/files/pre-upload",
            &json!({
                "fileName": format!("{}.encrypted", file_name),
                "originalFileName": file_name,
                "fileSize": enc_size,
                "originalFileSize": plain_size,
                "originalMimeType": mime,
                "isZeroKnowledge": "true",
                "isPasswordProtected": if password_enabled { "true" } else { "false" },
                "expirationDays": expiration_days,
                "maxDownloads": options.max_downloads,
                "customLink": options.custom_link.as_deref().unwrap_or("")
            }),
            false,
        )
        .await
        .map_err(|e| {
            update_transfer(
                &state,
                &app,
                &transfer_id,
                "failed",
                5.0,
                0,
                enc_size,
                None,
                Some(e.clone()),
            );
            e
        })?;

    let file_id = pre
        .get("fileId")
        .and_then(|v| v.as_str())
        .ok_or("pre-upload missing fileId")?
        .to_string();

    let total_chunks = ((enc_size as f64) / (CHUNK_UPLOAD_BYTES as f64)).ceil() as u32;
    let mut file = File::open(&enc_path).await.map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; CHUNK_UPLOAD_BYTES];
    let mut chunk_index: u32 = 0;
    let mut bytes_sent: u64 = 0;

    while bytes_sent < enc_size {
        let n = file.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        let chunk_data = &buffer[..n];
        let url = format!(
            "{}/files/upload-chunk/{}/{}",
            state.api_base, file_id, chunk_index
        );
        let part = reqwest::multipart::Part::bytes(chunk_data.to_vec())
            .file_name(format!("chunk_{chunk_index}"))
            .mime_str("application/octet-stream")
            .map_err(|e| e.to_string())?;
        let form = reqwest::multipart::Form::new()
            .part("chunk", part)
            .text("totalChunks", total_chunks.to_string());

        let mut req = api
            .client
            .post(&url)
            .multipart(form);
        if let Some(h) = ApiClient::auth_header(&state) {
            req = req.header("Authorization", h);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(format!("chunk upload failed: {text}"));
        }

        bytes_sent += n as u64;
        chunk_index += 1;
        let pct = 5.0 + (bytes_sent as f64 / enc_size as f64) * 90.0;
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "uploading",
            pct,
            bytes_sent,
            enc_size,
            None,
            None,
        );
    }

    api.post_json(
        &state,
        &format!("/files/finalize-upload/{file_id}"),
        &json!({}),
        false,
    )
    .await?;

    let custom_slug = options.custom_link.as_deref().filter(|s| !s.is_empty());
    let key_for_url = if password_enabled {
        None
    } else {
        Some(raw_key.as_str())
    };
    let share_url = build_share_url(&file_id, custom_slug, key_for_url);

    {
        let mut kr = state.keyring.write();
        kr.insert(
            file_id.clone(),
            KeyringEntry {
                file_id: file_id.clone(),
                raw_key: raw_key.clone(),
                original_name: file_name.clone(),
                share_url: Some(share_url.clone()),
            },
        );
    }
    let _ = persist_keyring(&app, &state).await;

    update_transfer(
        &state,
        &app,
        &transfer_id,
        "completed",
        100.0,
        enc_size,
        enc_size,
        Some(share_url.clone()),
        None,
    );

    add_activity(&state, "upload", &file_name, Some(file_id));
    let _ = std::fs::remove_file(&enc_path);

    Ok(share_url)
}

fn normalize_tier(raw: Option<&String>) -> String {
    let t = raw
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "free".into());
    if t == "premium" || t == "professional" {
        "creator".into()
    } else {
        t
    }
}

fn is_premium_tier(tier: &str) -> bool {
    tier == "pro" || tier == "creator"
}

fn is_creator_tier(tier: &str) -> bool {
    tier == "creator"
}

fn clamp_upload_options(state: &SharedState, options: &mut UploadOptions) -> Result<(), String> {
    let tier = normalize_tier(state.session.read().tier.as_ref());
    if options.password.as_ref().is_some_and(|p| !p.is_empty()) && !is_premium_tier(&tier) {
        return Err("Password-protected uploads require Pro.".into());
    }
    if options.use_master_key == Some(true) && !is_premium_tier(&tier) {
        return Err("Master key requires Pro.".into());
    }
    if options
        .custom_link
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty())
        && !is_creator_tier(&tier)
    {
        return Err("Custom link slugs require Creator.".into());
    }
    let max_exp = match tier.as_str() {
        "free" | "lite" => Some(90u32),
        "basic" => Some(365u32),
        _ => None,
    };
    if let Some(max) = max_exp {
        let days = options.expiration_days.unwrap_or(90);
        options.expiration_days = Some(days.min(max));
    }
    Ok(())
}

fn resolve_passphrase(state: &SharedState, options: &UploadOptions) -> Option<String> {
    if options.use_master_key == Some(true) {
        let settings = state.settings.read();
        if settings.master_key_enabled {
            return settings
                .master_key
                .clone()
                .filter(|p| p.len() >= 4);
        }
    }
    options
        .password
        .clone()
        .filter(|p| !p.is_empty() && p.len() >= 4)
}

fn push_transfer_emit(state: &SharedState, app: &AppHandle) {
    let snapshot = state.transfers.read().clone();
    emit_transfer_update(app, &snapshot);
}

fn update_transfer(
    state: &SharedState,
    app: &AppHandle,
    id: &str,
    status: &str,
    progress: f64,
    bytes_done: u64,
    bytes_total: u64,
    share_url: Option<String>,
    error: Option<String>,
) {
    {
        let mut transfers = state.transfers.write();
        if let Some(t) = transfers.iter_mut().find(|t| t.id == id) {
            t.status = status.into();
            t.progress = progress;
            t.bytes_done = bytes_done;
            t.bytes_total = bytes_total;
            if share_url.is_some() {
                t.share_url = share_url;
            }
            if error.is_some() {
                t.error = error;
            }
        }
    }
    push_transfer_emit(state, app);
}

pub fn notify_embed_download(app: &AppHandle, state: &SharedState, name: String) {
    let transfer_id = uuid::Uuid::new_v4().to_string();
    let label = if name.trim().is_empty() {
        "Download".to_string()
    } else {
        name.trim().to_string()
    };
    add_activity(state, "download", &label, None);
    {
        let mut transfers = state.transfers.write();
        transfers.push(TransferItem {
            id: transfer_id,
            name: label,
            path: String::new(),
            status: "completed".into(),
            progress: 100.0,
            bytes_done: 0,
            bytes_total: 0,
            share_url: None,
            error: None,
            kind: "download".into(),
        });
    }
    push_transfer_emit(state, app);
}

pub async fn download_file(
    app: AppHandle,
    state: SharedState,
    api: ApiClient,
    file_id: String,
    save_path: String,
) -> Result<(), String> {
    let file_name = {
        let keyring = state.keyring.read();
        keyring
            .get(&file_id)
            .map(|e| e.original_name.clone())
            .unwrap_or_else(|| file_id.clone())
    };
    let transfer_id = uuid::Uuid::new_v4().to_string();
    {
        let mut transfers = state.transfers.write();
        transfers.push(TransferItem {
            id: transfer_id.clone(),
            name: file_name.clone(),
            path: save_path.clone(),
            status: "downloading".into(),
            progress: 0.0,
            bytes_done: 0,
            bytes_total: 0,
            share_url: None,
            error: None,
            kind: "download".into(),
        });
    }
    push_transfer_emit(&state, &app);

    let url = format!("{}/files/download/{}", state.api_base, file_id);
    let mut req = api.client.get(&url);
    if let Some(h) = ApiClient::auth_header(&state) {
        req = req.header("Authorization", h);
    }
    let res = req.send().await.map_err(|e| {
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "failed",
            0.0,
            0,
            0,
            None,
            Some(e.to_string()),
        );
        e.to_string()
    })?;
    if !res.status().is_success() {
        let msg = "Download failed".to_string();
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "failed",
            0.0,
            0,
            0,
            None,
            Some(msg.clone()),
        );
        return Err(msg);
    }
    let total = res.content_length().unwrap_or(0);
    if total > 0 {
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "downloading",
            5.0,
            0,
            total,
            None,
            None,
        );
    }
    let bytes = res.bytes().await.map_err(|e| {
        let msg = e.to_string();
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "failed",
            0.0,
            0,
            total,
            None,
            Some(msg.clone()),
        );
        msg
    })?;

    let tmp = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{file_id}.enc"));
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;

    let keyring = state.keyring.read();
    if let Some(entry) = keyring.get(&file_id) {
        let out = Path::new(&save_path);
        zke::decrypt_zke_container(&tmp, out, Some(&entry.raw_key), None)
            .map_err(|e| {
                let msg = e.to_string();
                update_transfer(
                    &state,
                    &app,
                    &transfer_id,
                    "failed",
                    0.0,
                    0,
                    bytes.len() as u64,
                    None,
                    Some(msg.clone()),
                );
                msg
            })?;
        add_activity(&state, "download", &entry.original_name, Some(file_id.clone()));
        let _ = std::fs::remove_file(&tmp);
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "completed",
            100.0,
            bytes.len() as u64,
            bytes.len() as u64,
            None,
            None,
        );
        return Ok(());
    }
    std::fs::write(&save_path, &bytes).map_err(|e| {
        let msg = e.to_string();
        update_transfer(
            &state,
            &app,
            &transfer_id,
            "failed",
            0.0,
            0,
            bytes.len() as u64,
            None,
            Some(msg.clone()),
        );
        msg
    })?;
    update_transfer(
        &state,
        &app,
        &transfer_id,
        "completed",
        100.0,
        bytes.len() as u64,
        bytes.len() as u64,
        None,
        None,
    );
    Ok(())
}
