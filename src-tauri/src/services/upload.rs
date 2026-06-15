use crate::services::{add_activity, emit_transfer_update, persist_keyring, share::build_share_url, ApiClient};
use crate::state::{KeyringEntry, SharedState, TransferItem};
use crate::zke::{self, DEFAULT_CHUNK_SIZE};
use mime_guess::from_path;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const CHUNK_UPLOAD_BYTES: usize = 8 * 1024 * 1024;

pub async fn upload_files(
    app: AppHandle,
    state: SharedState,
    api: ApiClient,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut results = Vec::new();
    for path_str in paths {
        match upload_single_file(app.clone(), state.clone(), api.clone(), &path_str).await {
            Ok(url) => results.push(url),
            Err(e) => {
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
        });
    }
    push_transfer_emit(&state, &app);

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

    let enc = zke::encrypt_file_to_zke_container(
        &path,
        &enc_path,
        Some(&file_name),
        &mime,
        None,
        None,
        DEFAULT_CHUNK_SIZE,
    )
    .map_err(|e| e.to_string())?;

    let raw_key = enc.raw_key.clone().ok_or("Missing raw key")?;
    let enc_meta = std::fs::metadata(&enc_path).map_err(|e| e.to_string())?;
    let enc_size = enc_meta.len();

    update_transfer(&state, &app, &transfer_id, "uploading", 5.0, 0, enc_size, None, None);

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
                "isPasswordProtected": "false",
                "expirationDays": 180
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

    let share_url = build_share_url(&file_id, None, Some(&raw_key));

    {
        let mut kr = state.keyring.write();
        kr.insert(
            file_id.clone(),
            KeyringEntry {
                file_id: file_id.clone(),
                raw_key: raw_key.clone(),
                original_name: file_name.clone(),
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

pub async fn download_file(
    app: AppHandle,
    state: SharedState,
    api: ApiClient,
    file_id: String,
    save_path: String,
) -> Result<(), String> {
    let url = format!("{}/files/download/{}", state.api_base, file_id);
    let mut req = api.client.get(&url);
    if let Some(h) = ApiClient::auth_header(&state) {
        req = req.header("Authorization", h);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err("Download failed".into());
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

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
            .map_err(|e| e.to_string())?;
        add_activity(&state, "download", &entry.original_name, Some(file_id.clone()));
        let _ = std::fs::remove_file(&tmp);
        return Ok(());
    }
    std::fs::write(&save_path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}
