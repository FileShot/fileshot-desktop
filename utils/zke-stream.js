const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STREAM_MAGIC = 'FSZK';
const STREAM_VERSION = 1;

const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

function base64UrlEncode(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s + '='.repeat(padLen);
  return Buffer.from(padded, 'base64');
}

function deriveChunkIv(baseIv, chunkIndex) {
  const iv = Buffer.from(baseIv);
  let counter = ((iv[8] << 24) | (iv[9] << 16) | (iv[10] << 8) | iv[11]) >>> 0;
  counter = (counter + (chunkIndex >>> 0)) >>> 0;
  iv[8] = (counter >>> 24) & 0xff;
  iv[9] = (counter >>> 16) & 0xff;
  iv[10] = (counter >>> 8) & 0xff;
  iv[11] = counter & 0xff;
  return iv;
}

function serializeHeader(headerObj) {
  const jsonBytes = Buffer.from(JSON.stringify(headerObj), 'utf8');
  const magicBytes = Buffer.from(STREAM_MAGIC, 'utf8');
  const versionByte = Buffer.from([STREAM_VERSION]);
  const lenBytes = Buffer.alloc(4);
  lenBytes.writeUInt32BE(jsonBytes.byteLength, 0);
  return Buffer.concat([magicBytes, versionByte, lenBytes, jsonBytes]);
}

function deriveKeyFromPassphrase(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const pw = Buffer.from(String(passphrase), 'utf8');
  return crypto.pbkdf2Sync(pw, salt, iterations, 32, 'sha256');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Encrypt a file into the FileShot ZKE streaming container format (FSZK v1).
 *
 * This matches CURRENT/zero-knowledge.js (encryptFileZeroKnowledgeStream).
 */
async function encryptFileToZkeContainer({
  inputPath,
  outputPath,
  originalName = null,
  originalMimeType = 'application/octet-stream',
  mode = 'raw', // 'raw' | 'passphrase'
  rawKeyBase64Url = null,
  passphrase = null,
  chunkSize = 512 * 1024,
  kdfIterations = PBKDF2_ITERATIONS
}) {
  if (!inputPath) throw new Error('inputPath required');
  if (!outputPath) throw new Error('outputPath required');

  const stat = fs.statSync(inputPath);
  if (!stat.isFile()) throw new Error('inputPath must be a file');

  ensureDir(path.dirname(outputPath));

  const fileSize = stat.size;
  const name = originalName || path.basename(inputPath);

  let keyMode = mode === 'passphrase' ? 'passphrase' : 'raw';
  let keyBytes = null;
  let exportedRawKey = null;
  let salt = null;

  if (keyMode === 'passphrase') {
    if (!passphrase || String(passphrase).trim().length < 4) {
      throw new Error('Passphrase required (min 4 chars)');
    }
    salt = crypto.randomBytes(SALT_LENGTH);
    keyBytes = deriveKeyFromPassphrase(passphrase, salt, kdfIterations);
  } else {
    if (rawKeyBase64Url) {
      const bytes = base64UrlDecode(rawKeyBase64Url);
      if (bytes.length !== 32) throw new Error('rawKey must be 32 bytes (base64url)');
      keyBytes = bytes;
      exportedRawKey = rawKeyBase64Url;
    } else {
      const bytes = crypto.randomBytes(32);
      keyBytes = bytes;
      exportedRawKey = base64UrlEncode(bytes);
    }
  }

  const baseIv = crypto.randomBytes(IV_LENGTH);

  const headerObj = {
    v: STREAM_VERSION,
    magic: STREAM_MAGIC,
    chunkSize,
    fileSize,
    name,
    mime: originalMimeType || 'application/octet-stream',
    iv: base64UrlEncode(baseIv),
    keyMode,
    kdf: keyMode === 'passphrase'
      ? { salt: base64UrlEncode(salt), iterations: kdfIterations, hash: 'SHA-256' }
      : null,
    createdAt: Date.now()
  };

  const headerBytes = serializeHeader(headerObj);

  const inFd = fs.openSync(inputPath, 'r');
  const outFd = fs.openSync(outputPath, 'w');

  try {
    fs.writeSync(outFd, headerBytes);

    const buf = Buffer.allocUnsafe(chunkSize);
    let offset = 0;
    let chunkIndex = 0;

    while (offset < fileSize) {
      const toRead = Math.min(chunkSize, fileSize - offset);
      const read = fs.readSync(inFd, buf, 0, toRead, offset);
      if (read <= 0) break;

      const plain = buf.subarray(0, read);
      const iv = deriveChunkIv(baseIv, chunkIndex);

      const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
      const c1 = cipher.update(plain);
      const c2 = cipher.final();
      const tag = cipher.getAuthTag(); // 16 bytes

      // WebCrypto returns ciphertext||tag. Match that.
      fs.writeSync(outFd, c1);
      if (c2 && c2.length) fs.writeSync(outFd, c2);
      fs.writeSync(outFd, tag);

      offset += read;
      chunkIndex++;
    }
  } finally {
    try { fs.closeSync(inFd); } catch (_) {}
    try { fs.closeSync(outFd); } catch (_) {}
  }

  return {
    header: headerObj,
    rawKey: keyMode === 'raw' ? exportedRawKey : null,
    keyMode,
    outputPath
  };
}

module.exports = {
  base64UrlEncode,
  base64UrlDecode,
  encryptFileToZkeContainer
};
