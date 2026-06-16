use crate::services::{persist_keyring, ApiClient};
use crate::state::{KeyringEntry, SharedState};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::Sha256;
use tauri::AppHandle;

const VAULT_KDF_ITERS: u32 = 310_000;
const VAULT_SENTINEL: &str = "FileShotVaultCheck:v1";

fn normalize_b64(input: &str) -> String {
    let mut s = input.trim().replace('-', "+").replace('_', "/");
    while s.len() % 4 != 0 {
        s.push('=');
    }
    s
}

fn b64_decode(input: &str) -> Result<Vec<u8>, String> {
    let normalized = normalize_b64(input);
    B64.decode(normalized).map_err(|e| e.to_string())
}

fn b64_encode(data: &[u8]) -> String {
    B64.encode(data)
}

fn derive_vault_key(passphrase: &str, salt_b64: &str, iters: u32) -> Result<[u8; 32], String> {
    let salt = b64_decode(salt_b64)?;
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, iters, &mut key);
    Ok(key)
}

fn vault_encrypt(key: &[u8; 32], plaintext: &str) -> Result<(String, String), String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok((b64_encode(&ciphertext), b64_encode(&iv)))
}

fn vault_decrypt(key: &[u8; 32], cipher_b64: &str, iv_b64: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ciphertext = b64_decode(cipher_b64)?;
    let iv = b64_decode(iv_b64)?;
    if iv.len() != 12 {
        return Err("Invalid IV length".into());
    }
    let nonce = Nonce::from_slice(&iv);
    let plain = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| e.to_string())?;
    String::from_utf8(plain).map_err(|e| e.to_string())
}

async fn fetch_vault_status(api: &ApiClient, state: &SharedState) -> Result<Value, String> {
    api.get_json(state, "/user/vault/status").await
}

async fn auto_setup_vault(api: &ApiClient, state: &SharedState) -> Result<Value, String> {
    api
        .post_json(state, "/user/vault/auto-setup", &json!({}), true)
        .await
}

async fn fetch_recovery(api: &ApiClient, state: &SharedState) -> Result<Option<Value>, String> {
    let url = format!("{}/user/vault/recovery", state.api_base);
    let mut req = api.client.get(&url);
    if let Some(h) = ApiClient::auth_header(state) {
        req = req.header("Authorization", h);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if res.status().as_u16() == 404 {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err("Failed to get vault recovery".into());
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string()).map(Some)
}

fn vault_params_from(status: &Value) -> Result<(String, u32), String> {
    let salt = status
        .get("saltB64")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("Vault salt missing")?
        .to_string();
    let iters = status
        .get("kdfIters")
        .and_then(|v| v.as_u64())
        .unwrap_or(VAULT_KDF_ITERS as u64) as u32;
    Ok((salt, iters))
}

pub async fn ensure_vault_passphrase(
    api: &ApiClient,
    state: &SharedState,
) -> Result<(String, String, u32), String> {
    let cached = state.vault_passphrase.read().clone();
    if let Some(pass) = cached {
        let status = fetch_vault_status(api, state).await?;
        let (salt, iters) = vault_params_from(&status)?;
        return Ok((pass, salt, iters));
    }

    let status = fetch_vault_status(api, state).await?;
    if status.get("vaultSyncEnabled").and_then(|v| v.as_bool()) == Some(false) {
        return Err("Vault sync disabled".into());
    }

    let mut salt_itrs = vault_params_from(&status).ok();
    let passphrase = if status.get("hasRecovery").and_then(|v| v.as_bool()) == Some(true) {
        if let Some(rec) = fetch_recovery(api, state).await? {
            if salt_itrs.is_none() {
                salt_itrs = Some(vault_params_from(&rec)?);
            }
            rec.get("passphrase")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or("Missing passphrase in recovery")?
        } else {
            return Err("Vault recovery unavailable".into());
        }
    } else {
        let setup = auto_setup_vault(api, state).await?;
        salt_itrs = Some(vault_params_from(&setup)?);
        setup
            .get("passphrase")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or("Missing passphrase in auto-setup")?
    };

    let (salt, iters) = salt_itrs.ok_or("Vault salt missing")?;
    *state.vault_passphrase.write() = Some(passphrase.clone());
    Ok((passphrase, salt, iters))
}

async fn ensure_vault_sentinel(
    api: &ApiClient,
    state: &SharedState,
    key: &[u8; 32],
) -> Result<(), String> {
    let meta = api.get_json(state, "/user/vault/meta").await?;
    if meta.get("hasPassword").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(());
    }
    let (cipher_b64, iv_b64) = vault_encrypt(key, VAULT_SENTINEL)?;
    api
        .post_json(
            state,
            "/user/vault/meta",
            &json!({ "checkCipherB64": cipher_b64, "checkIvB64": iv_b64 }),
            true,
        )
        .await?;
    Ok(())
}

pub async fn save_zke_key(
    api: &ApiClient,
    state: &SharedState,
    file_id: &str,
    secret: &str,
) -> Result<(), String> {
    if file_id.is_empty() || secret.is_empty() {
        return Ok(());
    }
    if !state.settings.read().vault_sync_enabled {
        return Ok(());
    }
    let status = fetch_vault_status(api, state).await?;
    if status.get("vaultSyncEnabled").and_then(|v| v.as_bool()) == Some(false) {
        return Ok(());
    }

    let (passphrase, salt_b64, iters) = ensure_vault_passphrase(api, state).await?;
    let key = derive_vault_key(&passphrase, &salt_b64, iters)?;
    ensure_vault_sentinel(api, state, &key).await?;
    let (cipher_b64, iv_b64) = vault_encrypt(&key, secret)?;
    api
        .post_json(
            state,
            "/user/vault/item",
            &json!({
                "fileId": file_id,
                "itemType": "zke_password",
                "cipherB64": cipher_b64,
                "ivB64": iv_b64
            }),
            true,
        )
        .await?;
    Ok(())
}

pub async fn hydrate_keyring(
    api: &ApiClient,
    state: &SharedState,
    app: &AppHandle,
) -> Result<u32, String> {
    if !state.settings.read().vault_sync_enabled {
        return Ok(0);
    }
    let status = fetch_vault_status(api, state).await?;
    if status.get("vaultSyncEnabled").and_then(|v| v.as_bool()) == Some(false) {
        return Ok(0);
    }

    let (passphrase, salt_b64, iters) = ensure_vault_passphrase(api, state).await?;
    let key = derive_vault_key(&passphrase, &salt_b64, iters)?;

    let mut offset = 0u64;
    let limit = 100u64;
    let mut total = 0u64;
    let mut hydrated = 0u32;

    loop {
        let path = format!("/user/vault/items?limit={limit}&offset={offset}");
        let page = api.get_json(state, &path).await?;
        let items = page
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        total = page.get("total").and_then(|v| v.as_u64()).unwrap_or(0);

        for it in &items {
            let file_id = it.get("fileId").and_then(|v| v.as_str()).unwrap_or("");
            if file_id.is_empty() || state.keyring.read().contains_key(file_id) {
                continue;
            }
            let item_type = it
                .get("itemType")
                .and_then(|v| v.as_str())
                .unwrap_or("zke_password");
            let item_path = format!("/user/vault/item?fileId={file_id}&itemType={item_type}");
            let item = match api.get_json(state, &item_path).await {
                Ok(v) => v,
                Err(_) => continue,
            };
            let cipher = item
                .get("item")
                .and_then(|i| i.get("cipherB64"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let iv = item
                .get("item")
                .and_then(|i| i.get("ivB64"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if cipher.is_empty() || iv.is_empty() {
                continue;
            }
            if let Ok(plain) = vault_decrypt(&key, cipher, iv) {
                let name = it
                    .get("fileName")
                    .and_then(|v| v.as_str())
                    .unwrap_or(file_id)
                    .to_string();
                let share_url =
                    crate::services::share::build_share_url(file_id, None, Some(&plain));
                state.keyring.write().insert(
                    file_id.to_string(),
                    KeyringEntry {
                        file_id: file_id.to_string(),
                        raw_key: plain,
                        original_name: name,
                        share_url: Some(share_url),
                    },
                );
                hydrated += 1;
            }
        }

        offset += items.len() as u64;
        if offset >= total || items.is_empty() {
            break;
        }
    }

    if hydrated > 0 {
        let _ = persist_keyring(app, state).await;
    }
    Ok(hydrated)
}

pub fn clear_vault_session(state: &SharedState) {
    *state.vault_passphrase.write() = None;
}
