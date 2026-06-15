//! FileShot ZKE streaming container (FSZK v1) — matches desktop-app-v2/utils/zke-stream.js

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use thiserror::Error;

pub const STREAM_MAGIC: &[u8; 4] = b"FSZK";
pub const STREAM_VERSION: u8 = 1;
pub const IV_LENGTH: usize = 12;
pub const SALT_LENGTH: usize = 16;
pub const PBKDF2_ITERATIONS: u32 = 100_000;
pub const ARGON2_MEMORY_KIB: u32 = 65536;
pub const ARGON2_ITERATIONS: u32 = 2;
pub const ARGON2_PARALLELISM: u32 = 1;
pub const TAG_SIZE: usize = 16;
pub const DEFAULT_CHUNK_SIZE: usize = 512 * 1024;

#[derive(Debug, Error)]
pub enum ZkeError {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkeHeader {
    pub v: u8,
    pub magic: String,
    #[serde(rename = "chunkSize")]
    pub chunk_size: usize,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub name: String,
    pub mime: String,
    pub iv: String,
    #[serde(rename = "keyMode")]
    pub key_mode: String,
    pub kdf: Option<serde_json::Value>,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

pub struct EncryptResult {
    pub header: ZkeHeader,
    pub raw_key: Option<String>,
    pub output_path: String,
}

pub fn base64_url_encode(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

pub fn base64_url_decode(s: &str) -> Result<Vec<u8>, ZkeError> {
    URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|e| ZkeError::Msg(format!("base64 decode: {e}")))
}

fn derive_chunk_iv(base_iv: &[u8], chunk_index: u32) -> [u8; 12] {
    let mut iv = [0u8; 12];
    iv.copy_from_slice(&base_iv[..12]);
    let counter = u32::from_be_bytes([iv[8], iv[9], iv[10], iv[11]]).wrapping_add(chunk_index);
    iv[8] = (counter >> 24) as u8;
    iv[9] = (counter >> 16) as u8;
    iv[10] = (counter >> 8) as u8;
    iv[11] = counter as u8;
    iv
}

fn derive_key_pbkdf2(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(
        passphrase.as_bytes(),
        salt,
        iterations,
        &mut key,
    );
    key
}

fn derive_key_argon2id(passphrase: &str, salt: &[u8], kdf: &serde_json::Value) -> Result<[u8; 32], ZkeError> {
    let memory = kdf.get("memory").and_then(|v| v.as_u64()).unwrap_or(ARGON2_MEMORY_KIB as u64) as u32;
    let iterations = kdf
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(ARGON2_ITERATIONS as u64) as u32;
    let parallelism = kdf
        .get("parallelism")
        .and_then(|v| v.as_u64())
        .unwrap_or(ARGON2_PARALLELISM as u64) as u32;
    let params = Params::new(memory, iterations, parallelism, Some(32))
        .map_err(|e| ZkeError::Msg(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| ZkeError::Msg(e.to_string()))?;
    Ok(key)
}

fn kdf_is_argon2id(kdf: &serde_json::Value) -> bool {
    kdf.get("alg")
        .or_else(|| kdf.get("algorithm"))
        .and_then(|v| v.as_str())
        == Some("argon2id")
}

fn serialize_header(header: &ZkeHeader) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(header).unwrap();
    let mut out = Vec::with_capacity(9 + json_bytes.len());
    out.extend_from_slice(STREAM_MAGIC);
    out.push(STREAM_VERSION);
    out.extend_from_slice(&(json_bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(&json_bytes);
    out
}

pub fn parse_header(path: &Path) -> Result<(ZkeHeader, usize), ZkeError> {
    let mut f = File::open(path)?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic)?;
    if &magic != STREAM_MAGIC {
        return Err(ZkeError::Msg("Invalid FSZK file: bad magic".into()));
    }
    let mut version = [0u8; 1];
    f.read_exact(&mut version)?;
    if version[0] != STREAM_VERSION {
        return Err(ZkeError::Msg(format!("Unsupported FSZK version: {}", version[0])));
    }
    let mut len_buf = [0u8; 4];
    f.read_exact(&mut len_buf)?;
    let json_len = u32::from_be_bytes(len_buf) as usize;
    let mut json_buf = vec![0u8; json_len];
    f.read_exact(&mut json_buf)?;
    let header: ZkeHeader = serde_json::from_slice(&json_buf)?;
    Ok((header, 9 + json_len))
}

pub fn encrypt_file_to_zke_container(
    input_path: &Path,
    output_path: &Path,
    original_name: Option<&str>,
    original_mime: &str,
    raw_key_b64: Option<&str>,
    passphrase: Option<&str>,
    chunk_size: usize,
) -> Result<EncryptResult, ZkeError> {
    let meta = fs::metadata(input_path)?;
    if !meta.is_file() {
        return Err(ZkeError::Msg("input must be a file".into()));
    }
    let file_size = meta.len();
    let name = original_name
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            input_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string()
        });

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let (key_bytes, key_mode, raw_key, kdf_json, salt_opt) = if let Some(pw) = passphrase {
        if pw.trim().len() < 4 {
            return Err(ZkeError::Msg("Passphrase required (min 4 chars)".into()));
        }
        let mut salt = [0u8; SALT_LENGTH];
        rand::thread_rng().fill_bytes(&mut salt);
        let (k, kdf_json) = match derive_key_argon2id(pw, &salt, &serde_json::json!({})) {
            Ok(k) => (
                k,
                serde_json::json!({
                    "alg": "argon2id",
                    "salt": base64_url_encode(&salt),
                    "memory": ARGON2_MEMORY_KIB,
                    "iterations": ARGON2_ITERATIONS,
                    "parallelism": ARGON2_PARALLELISM,
                    "hashLen": 32
                }),
            ),
            Err(_) => {
                let k = derive_key_pbkdf2(pw, &salt, PBKDF2_ITERATIONS);
                (
                    k,
                    serde_json::json!({
                        "salt": base64_url_encode(&salt),
                        "iterations": PBKDF2_ITERATIONS,
                        "hash": "SHA-256"
                    }),
                )
            }
        };
        (k, "passphrase".to_string(), None, Some(kdf_json), Some(salt))
    } else {
        let key_vec = if let Some(rk) = raw_key_b64 {
            let bytes = base64_url_decode(rk)?;
            if bytes.len() != 32 {
                return Err(ZkeError::Msg("rawKey must be 32 bytes".into()));
            }
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            (k, rk.to_string())
        } else {
            let mut k = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut k);
            (k, base64_url_encode(&k))
        };
        (key_vec.0, "raw".to_string(), Some(key_vec.1), None, None)
    };

    let _ = salt_opt;

    let mut base_iv = [0u8; IV_LENGTH];
    rand::thread_rng().fill_bytes(&mut base_iv);

    let header = ZkeHeader {
        v: STREAM_VERSION,
        magic: "FSZK".into(),
        chunk_size,
        file_size,
        name: name.clone(),
        mime: original_mime.to_string(),
        iv: base64_url_encode(&base_iv),
        key_mode: key_mode.clone(),
        kdf: kdf_json,
        created_at: chrono::Utc::now().timestamp_millis() as u64,
    };

    let header_bytes = serialize_header(&header);
    let mut in_f = File::open(input_path)?;
    let mut out_f = File::create(output_path)?;
    out_f.write_all(&header_bytes)?;

    let mut buf = vec![0u8; chunk_size];
    let mut offset: u64 = 0;
    let mut chunk_index: u32 = 0;

    while offset < file_size {
        let to_read = std::cmp::min(chunk_size as u64, file_size - offset) as usize;
        let read = in_f.read(&mut buf[..to_read])?;
        if read == 0 {
            break;
        }
        let plain = &buf[..read];
        let iv = derive_chunk_iv(&base_iv, chunk_index);
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| ZkeError::Msg(e.to_string()))?;
        let nonce = Nonce::from_slice(&iv);
        let ciphertext = cipher
            .encrypt(nonce, plain)
            .map_err(|e| ZkeError::Msg(e.to_string()))?;
        out_f.write_all(&ciphertext)?;
        offset += read as u64;
        chunk_index += 1;
    }

    Ok(EncryptResult {
        header,
        raw_key: if key_mode == "raw" { raw_key } else { None },
        output_path: output_path.to_string_lossy().into_owned(),
    })
}

pub fn decrypt_zke_container(
    input_path: &Path,
    output_path: &Path,
    raw_key_b64: Option<&str>,
    passphrase: Option<&str>,
) -> Result<(String, String), ZkeError> {
    let (header, header_size) = parse_header(input_path)?;
    let key_bytes: [u8; 32] = if header.key_mode == "passphrase" {
        let pw = passphrase.ok_or_else(|| ZkeError::Msg("Passphrase required".into()))?;
        let kdf = header.kdf.as_ref().ok_or_else(|| ZkeError::Msg("Missing kdf".into()))?;
        let salt = base64_url_decode(kdf.get("salt").and_then(|v| v.as_str()).unwrap_or(""))?;
        if kdf_is_argon2id(kdf) {
            derive_key_argon2id(pw, &salt, kdf)?
        } else {
            let iterations = kdf
                .get("iterations")
                .and_then(|v| v.as_u64())
                .unwrap_or(PBKDF2_ITERATIONS as u64) as u32;
            derive_key_pbkdf2(pw, &salt, iterations)
        }
    } else {
        let rk = raw_key_b64.ok_or_else(|| ZkeError::Msg("Raw key required".into()))?;
        let bytes = base64_url_decode(rk)?;
        if bytes.len() != 32 {
            return Err(ZkeError::Msg("Invalid key length".into()));
        }
        let mut k = [0u8; 32];
        k.copy_from_slice(&bytes);
        k
    };

    let base_iv = base64_url_decode(&header.iv)?;
    let chunk_size = header.chunk_size;
    let file_size = header.file_size;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut in_f = File::open(input_path)?;
    in_f.seek(std::io::SeekFrom::Start(header_size as u64))?;
    let mut out_f = File::create(output_path)?;

    let mut input_offset = header_size;
    let mut output_offset: u64 = 0;
    let mut chunk_index: u32 = 0;

    while output_offset < file_size {
        let plain_chunk_size = std::cmp::min(chunk_size as u64, file_size - output_offset) as usize;
        let cipher_chunk_size = plain_chunk_size + TAG_SIZE;
        let mut cipher_buf = vec![0u8; cipher_chunk_size];
        in_f.read_exact(&mut cipher_buf)?;

        let iv = derive_chunk_iv(&base_iv, chunk_index);
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| ZkeError::Msg(e.to_string()))?;
        let nonce = Nonce::from_slice(&iv);
        let plain = cipher
            .decrypt(nonce, cipher_buf.as_ref())
            .map_err(|e| ZkeError::Msg(format!("decrypt failed: {e}")))?;
        out_f.write_all(&plain)?;

        input_offset += cipher_chunk_size;
        output_offset += plain_chunk_size as u64;
        chunk_index += 1;
    }

    let _ = input_offset;
    Ok((header.name, header.mime))
}

use std::io::Seek;
