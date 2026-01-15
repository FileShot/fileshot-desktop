const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const chokidar = require('chokidar');

const { encryptFileToZkeContainer, decryptZkeContainer, parseHeader } = require('./utils/zke-stream');

// Initialize electron-store for settings
const store = new Store();

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let uploadQueue = [];
let isQuitting = false;

// FileShot Drive (Windows): map a drive letter to a local inbox folder
let driveWatcher = null;
let driveQueue = [];
let driveQueueRunning = false;

// App configuration
const isDev = process.argv.includes('--dev');
const API_URL = isDev ? 'http://localhost:3000/api' : 'https://api.fileshot.io/api';
const FRONTEND_URL = isDev ? 'http://localhost:8080' : 'https://fileshot.io';

// Local fallback (bundled) frontend
const LOCAL_FRONTEND_INDEX = path.join(__dirname, 'renderer', 'site', 'index.html');
const LOCAL_OFFLINE_PAGE = path.join(__dirname, 'renderer', 'offline.html');

// Local-first UI (always available in v1.2+)
const LOCAL_UI_INDEX = path.join(__dirname, 'renderer', 'local', 'index.html');

// Local vault paths
function getVaultRoot() {
  // userData is per-user/per-install and writable.
  return path.join(app.getPath('userData'), 'vault');
}

function getVaultFilesDir() {
  return path.join(getVaultRoot(), 'files');
}

function getVaultTmpDir() {
  return path.join(getVaultRoot(), 'tmp');
}

function getDriveInboxDir() {
  return path.join(getVaultRoot(), 'drive-inbox');
}

function getDriveUploadingDir() {
  return path.join(getDriveInboxDir(), '_uploading');
}

function getDriveUploadedDir() {
  return path.join(getDriveInboxDir(), '_uploaded');
}

function getConfiguredDriveLetter() {
  const raw = String(store.get('drive.letter', 'F') || 'F').trim();
  const letter = raw.replace(':', '').toUpperCase().slice(0, 1);
  return /^[A-Z]$/.test(letter) ? letter : 'F';
}

function isDriveLetterAvailable(letter) {
  const L = String(letter || '').replace(':', '').toUpperCase().slice(0, 1);
  if (!/^[A-Z]$/.test(L)) return false;
  // Avoid A/B (floppy legacy) and C (system drive).
  if (L === 'A' || L === 'B' || L === 'C') return false;
  try {
    return !fs.existsSync(`${L}:\\`);
  } catch (_) {
    return false;
  }
}

function pickAvailableDriveLetter(preferred) {
  const pref = String(preferred || '').replace(':', '').toUpperCase().slice(0, 1);
  const order = [];
  if (/^[A-Z]$/.test(pref)) order.push(pref);

  // Common “nice” letters first.
  for (let c = 'F'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    order.push(String.fromCharCode(c));
  }
  // Fall back to D/E if available.
  order.push('E');
  order.push('D');

  for (const L of order) {
    if (isDriveLetterAvailable(L)) return L;
  }
  return null;
}

async function isRunningAsAdmin() {
  if (process.platform !== 'win32') return false;
  // net session succeeds only when elevated.
  try {
    await execPromise('net session', { timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function relaunchAsStandardUser() {
  if (process.platform !== 'win32') return false;
  // Best-effort: launching via explorer.exe usually uses the non-elevated shell token.
  try {
    const exePath = process.execPath;
    await execPromise(`explorer.exe "${exePath}"`);
    return true;
  } catch (_) {
    return false;
  }
}

function isDriveFeatureAvailable() {
  return process.platform === 'win32';
}

function execPromise(command, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(command, { windowsHide: true, ...opts }, (error, stdout, stderr) => {
      if (error) return reject({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function ensureDriveDirs() {
  ensureVaultDirs();
  fs.mkdirSync(getDriveInboxDir(), { recursive: true });
  fs.mkdirSync(getDriveUploadingDir(), { recursive: true });
  fs.mkdirSync(getDriveUploadedDir(), { recursive: true });
}

function sanitizeFileName(name) {
  const s = String(name || '').trim();
  // Windows invalid characters: \ / : * ? " < > |
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 180) || 'file';
}

async function waitForStableFile(filePath, stableMs = 1500, maxWaitMs = 10 * 60 * 1000) {
  const p = String(filePath || '');
  const start = Date.now();

  let lastSize = -1;
  let lastMtime = 0;
  let stableFor = 0;
  let lastTick = Date.now();

  while (Date.now() - start < maxWaitMs) {
    let st;
    try {
      st = await fs.promises.stat(p);
    } catch (_) {
      // File might still be being moved/created; retry.
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    const size = Number(st.size || 0);
    const mtime = Number(st.mtimeMs || 0);

    const now = Date.now();
    const dt = now - lastTick;
    lastTick = now;

    const unchanged = size === lastSize && mtime === lastMtime;
    if (unchanged) {
      stableFor += dt;
      if (stableFor >= stableMs) return true;
    } else {
      stableFor = 0;
      lastSize = size;
      lastMtime = mtime;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  throw new Error('Timed out waiting for file to become stable');
}

async function mapDriveLetter(letter, targetDir) {
  if (!isDriveFeatureAvailable()) throw new Error('Drive mapping is only supported on Windows');
  const L = String(letter || '').replace(':', '').toUpperCase();
  if (!/^[A-Z]$/.test(L)) throw new Error('Invalid drive letter');
  const dir = String(targetDir || '');
  if (!dir) throw new Error('Missing target directory');

  // Ensure directory exists.
  fs.mkdirSync(dir, { recursive: true });

  // SUBST will fail if the letter is already in use.
  await execPromise(`subst ${L}: "${dir}"`);
}

async function unmapDriveLetter(letter) {
  if (!isDriveFeatureAvailable()) return;
  const L = String(letter || '').replace(':', '').toUpperCase();
  if (!/^[A-Z]$/.test(L)) return;
  // Best-effort.
  try {
    await execPromise(`subst ${L}: /D`);
  } catch (_) {}
}

function getDriveRootPath(letter) {
  const L = String(letter || '').replace(':', '').toUpperCase();
  return `${L}:\\`;
}

function pushRecentUpload(fileName, url) {
  const recentUploads = store.get('recentUploads', []);
  recentUploads.unshift({ fileName, url, uploadedAt: Date.now() });
  if (recentUploads.length > 10) recentUploads.length = 10;
  store.set('recentUploads', recentUploads);
  rebuildTrayMenu();
}

async function uploadPlainFileAsZke({ inputPath, originalName, onProgress }) {
  const p = String(inputPath || '');
  if (!p || !fs.existsSync(p)) throw new Error('Missing input file');
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('Input must be a file');

  const token = store.get('authToken', null);
  if (!token) throw new Error('Not logged in');

  const headers = { Authorization: `Bearer ${token}` };
  const safeName = String(originalName || path.basename(p) || 'file');

  const tmpId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  ensureVaultDirs();
  const tmpOut = path.join(getVaultTmpDir(), `${tmpId}.fszk`);

  if (typeof onProgress === 'function') onProgress({ percent: 5, stage: 'Encrypting locally (ZKE)...' });

  const enc = await encryptFileToZkeContainer({
    inputPath: p,
    outputPath: tmpOut,
    originalName: safeName,
    originalMimeType: 'application/octet-stream',
    mode: 'raw',
    chunkSize: 512 * 1024
  });

  const encryptedSize = fs.statSync(tmpOut).size;

  if (typeof onProgress === 'function') onProgress({ percent: 20, stage: 'Requesting upload slot...' });

  const preUploadBody = {
    fileName: safeName,
    fileSize: st.size,
    isZeroKnowledge: 'true',
    originalFileName: safeName,
    originalFileSize: st.size,
    originalMimeType: 'application/octet-stream'
  };

  const pre = await axios.post(`${API_URL}/files/pre-upload`, preUploadBody, {
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    timeout: 60000
  });

  const fileId = pre?.data?.fileId;
  if (!fileId) throw new Error('Pre-upload failed (missing fileId)');

  const NET_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
  const totalChunks = Math.max(1, Math.ceil(encryptedSize / NET_CHUNK_SIZE));
  let uploaded = 0;

  if (typeof onProgress === 'function') onProgress({ percent: 25, stage: `Uploading (${totalChunks} chunks)...` });

  const fd = fs.openSync(tmpOut, 'r');
  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * NET_CHUNK_SIZE;
      const end = Math.min(start + NET_CHUNK_SIZE, encryptedSize);
      const len = end - start;

      const buf = Buffer.allocUnsafe(len);
      const read = fs.readSync(fd, buf, 0, len, start);
      if (read !== len) throw new Error('Failed to read encrypted chunk');

      const form = new FormData();
      form.append('chunk', buf, { filename: `chunk-${chunkIndex}` });
      form.append('totalChunks', String(totalChunks));
      form.append('isLastChunk', String(chunkIndex === totalChunks - 1));

      await axios.post(`${API_URL}/files/upload-chunk/${fileId}/${chunkIndex}`, form, {
        headers: {
          ...form.getHeaders(),
          ...headers
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000
      });

      uploaded += len;
      const pct = 25 + Math.floor((uploaded / encryptedSize) * 70);
      if (typeof onProgress === 'function') onProgress({ percent: Math.min(95, pct), stage: `Uploading... ${chunkIndex + 1}/${totalChunks}` });
    }
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }

  if (typeof onProgress === 'function') onProgress({ percent: 96, stage: 'Finalizing...' });

  await axios.post(`${API_URL}/files/finalize-upload/${fileId}`, {}, {
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    timeout: 600000
  });

  const shareUrl = `${FRONTEND_URL}/downloads.html?f=${encodeURIComponent(fileId)}${enc.rawKey ? `#k=${encodeURIComponent(enc.rawKey)}` : ''}`;

  try { fs.unlinkSync(tmpOut); } catch (_) {}

  if (typeof onProgress === 'function') onProgress({ percent: 100, stage: 'Done' });
  return { fileId, shareUrl };
}

async function startDriveWatcher() {
  if (!isDriveFeatureAvailable()) return;
  if (driveWatcher) return;

  await ensureDriveDirs();

  driveWatcher = chokidar.watch(getDriveInboxDir(), {
    persistent: true,
    ignoreInitial: true,
    depth: 99,
    awaitWriteFinish: false,
    ignored: [
      /\\_uploading\\/i,
      /\\_uploaded\\/i,
      /\\\.tmp\\/i,
      /\.url$/i,
      /\.lnk$/i
    ]
  });

  async function processDriveQueue() {
    if (driveQueueRunning) return;
    driveQueueRunning = true;
    try {
      while (driveQueue.length) {
        if (!isDriveFeatureAvailable()) return;

        const next = driveQueue.shift();
        const originalPath = String(next || '');
        if (!originalPath) continue;

        const notifier = require('node-notifier');

        try {
          // Only handle real files.
          const st = safeStat(originalPath);
          if (!st || !st.isFile()) continue;

          // Wait for Explorer copy to finish.
          await waitForStableFile(originalPath, 1500, 10 * 60 * 1000);

          const baseName = path.basename(originalPath);
          const safeBase = sanitizeFileName(baseName);

          // Move into _uploading to prevent re-trigger and to visually separate state.
          const uploadingPath = path.join(getDriveUploadingDir(), safeBase);
          let workPath = originalPath;
          try {
            fs.mkdirSync(getDriveUploadingDir(), { recursive: true });
            // If destination exists, add a suffix.
            let dest = uploadingPath;
            if (fs.existsSync(dest)) {
              const ext = path.extname(safeBase);
              const stem = safeBase.slice(0, safeBase.length - ext.length);
              dest = path.join(getDriveUploadingDir(), `${stem}-${Date.now()}${ext}`);
            }
            fs.renameSync(originalPath, dest);
            workPath = dest;
          } catch (_) {
            // If rename fails (locked), upload in-place.
            workPath = originalPath;
          }

          notifier.notify({
            title: 'FileShot Drive',
            message: `Uploading: ${safeBase}`,
            icon: path.join(__dirname, 'assets', 'icon.png'),
            sound: false
          });

          const { shareUrl } = await uploadPlainFileAsZke({
            inputPath: workPath,
            originalName: safeBase,
            onProgress: (_) => {}
          });

          pushRecentUpload(safeBase, shareUrl);

          // Move to _uploaded and drop a .url shortcut for the share link.
          try {
            fs.mkdirSync(getDriveUploadedDir(), { recursive: true });
            const uploadedFilePath = path.join(getDriveUploadedDir(), path.basename(workPath));
            if (workPath !== uploadedFilePath) {
              let dest = uploadedFilePath;
              if (fs.existsSync(dest)) {
                const ext = path.extname(dest);
                const stem = dest.slice(0, dest.length - ext.length);
                dest = `${stem}-${Date.now()}${ext}`;
              }
              fs.renameSync(workPath, dest);
            }

            const urlName = `${sanitizeFileName(safeBase)}.url`;
            const urlPath = path.join(getDriveUploadedDir(), urlName);
            const shortcut = `[InternetShortcut]\r\nURL=${shareUrl}\r\n`;
            fs.writeFileSync(urlPath, shortcut, 'utf8');
          } catch (_) {}

          notifier.notify({
            title: 'FileShot Drive',
            message: `Uploaded: ${safeBase}`,
            icon: path.join(__dirname, 'assets', 'icon.png'),
            sound: false
          });
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          console.warn('[Drive] Upload failed:', msg);
          try {
            notifier.notify({
              title: 'FileShot Drive',
              message: `Upload failed: ${msg}`,
              icon: path.join(__dirname, 'assets', 'icon.png'),
              sound: false
            });
          } catch (_) {}
        }
      }
    } finally {
      driveQueueRunning = false;
    }
  }

  driveWatcher.on('add', (filePath) => {
    if (!isDriveFeatureAvailable()) return;
    const p = String(filePath || '');
    if (!p) return;

    // Small guard against pathological spikes.
    if (driveQueue.length < 5000) {
      driveQueue.push(p);
    }

    processDriveQueue().catch(() => {});
  });
}

async function stopDriveWatcher() {
  if (driveWatcher) {
    try {
      await driveWatcher.close();
    } catch (_) {}
    driveWatcher = null;
  }

  // Clear any queued work; we'll rescan/continue fresh on next enable.
  driveQueue = [];
  driveQueueRunning = false;
}

async function cleanupFileShotDriveRuntime() {
  if (!isDriveFeatureAvailable()) return;
  const letter = getConfiguredDriveLetter();
  await stopDriveWatcher();
  await unmapDriveLetter(letter);
}

async function enableFileShotDrive() {
  if (!isDriveFeatureAvailable()) {
    dialog.showMessageBox({ type: 'info', message: 'FileShot Drive is currently Windows-only.' });
    return;
  }

  await ensureDriveDirs();
  let letter = getConfiguredDriveLetter();

  // If the chosen letter is already in use, pick a free one automatically.
  if (!isDriveLetterAvailable(letter)) {
    const picked = pickAvailableDriveLetter(letter);
    if (picked) {
      letter = picked;
      store.set('drive.letter', letter);
    }
  }

  // If we're running elevated, this is a common reason the drive doesn't appear
  // in normal Explorer. Warn and offer to relaunch normally.
  const elevated = await isRunningAsAdmin();
  if (elevated) {
    const res = await dialog.showMessageBox({
      type: 'warning',
      title: 'FileShot Drive',
      message: 'FileShot is running as Administrator. Mapped drives created from an elevated app may not show up in normal File Explorer.',
      detail: 'Recommended: restart FileShot normally (not as administrator) so the drive appears under “This PC”.',
      buttons: ['Restart normally', 'Continue anyway', 'Disable Drive'],
      defaultId: 0,
      cancelId: 1
    });

    if (res.response === 0) {
      const relaunched = await relaunchAsStandardUser();
      if (relaunched) {
        app.quit();
        return;
      }
    }

    if (res.response === 2) {
      await disableFileShotDrive();
      return;
    }
  }

  try {
    await mapDriveLetter(letter, getDriveInboxDir());
  } catch (e) {
    // If it failed because the letter is in use, try a different letter automatically.
    const picked = pickAvailableDriveLetter(letter);
    if (picked && picked !== letter) {
      try {
        await mapDriveLetter(picked, getDriveInboxDir());
        letter = picked;
        store.set('drive.letter', letter);
      } catch (e2) {
        const details2 = (e2 && e2.stderr) ? String(e2.stderr).trim() : '';
        dialog.showMessageBox({
          type: 'error',
          title: 'FileShot Drive',
          message: `Could not map a drive letter automatically.`,
          detail: details2
        });
        return;
      }
    } else {
      const details = (e && e.stderr) ? String(e.stderr).trim() : '';
      dialog.showMessageBox({
        type: 'error',
        title: 'FileShot Drive',
        message: `Could not map drive ${letter}:\\. It may already be in use.`,
        detail: details
      });
      return;
    }
  }

  store.set('drive.enabled', true);
  await startDriveWatcher();
  rebuildTrayMenu();

  try {
    shell.openPath(getDriveRootPath(letter));
  } catch (_) {}
}

async function disableFileShotDrive() {
  if (!isDriveFeatureAvailable()) return;
  const letter = getConfiguredDriveLetter();
  await stopDriveWatcher();
  await unmapDriveLetter(letter);
  store.set('drive.enabled', false);
  rebuildTrayMenu();
}

function ensureVaultDirs() {
  fs.mkdirSync(getVaultFilesDir(), { recursive: true });
  fs.mkdirSync(getVaultTmpDir(), { recursive: true });
}

function getVaultItems() {
  return store.get('vault.items', []);
}

function setVaultItems(items) {
  store.set('vault.items', items);
}

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function safeStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

/**
 * Add a file to the vault with AES-256-GCM encryption.
 * Uses password-based encryption with PBKDF2 key derivation.
 */
async function addFileToVault(sourcePath, passphrase) {
  ensureVaultDirs();
  const st = safeStat(sourcePath);
  if (!st || !st.isFile()) return null;

  const id = genId();
  const name = path.basename(sourcePath);
  const storedName = `${id}.fszk`; // Always use .fszk extension for encrypted files
  const destPath = path.join(getVaultFilesDir(), storedName);

  // Encrypt the file using ZKE format with PASSWORD-BASED encryption
  const result = await encryptFileToZkeContainer({
    inputPath: sourcePath,
    outputPath: destPath,
    originalName: name,
    mode: 'passphrase', // Use password-based encryption
    passphrase: passphrase
  });

  const encryptedStat = safeStat(destPath);

  return {
    id,
    name,
    originalSize: st.size,
    size: encryptedStat ? encryptedStat.size : st.size,
    addedAt: Date.now(),
    localPath: destPath,
    sourcePath,
    encrypted: true,
    encryptionMode: 'passphrase' // Indicate password-based encryption
    // Note: No key stored - user must remember password
  };
}

function vaultTotalBytes(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.size || 0), 0);
}

// ============================================================================
// SECURE SHRED (BEST-EFFORT)
// ============================================================================

function shredPassesForMethod(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'gutmann') return 35;
  if (m === 'dod') return 7;
  if (m === 'simple' || m === 'single') return 1;
  return 1;
}

function isProbablyDir(p) {
  try {
    const st = fs.statSync(p);
    return st.isDirectory();
  } catch (_) {
    return false;
  }
}

async function listFilesRecursive(rootPath, fileList = []) {
  const p = String(rootPath || '');
  if (!p) return fileList;
  let ents;
  try {
    ents = await fs.promises.readdir(p, { withFileTypes: true });
  } catch (_) {
    return fileList;
  }

  for (const ent of ents) {
    const full = path.join(p, ent.name);
    try {
      if (ent.isDirectory()) {
        await listFilesRecursive(full, fileList);
      } else if (ent.isFile()) {
        fileList.push(full);
      }
      // Skip symlinks and others
    } catch (_) {}
  }
  return fileList;
}

async function tryRemoveEmptyDirs(rootPath) {
  const p = String(rootPath || '');
  if (!p) return;
  let ents;
  try {
    ents = await fs.promises.readdir(p, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    const full = path.join(p, ent.name);
    await tryRemoveEmptyDirs(full);
  }

  // Now try removing this dir if empty
  try {
    const left = await fs.promises.readdir(p);
    if (left.length === 0) {
      await fs.promises.rmdir(p);
    }
  } catch (_) {}
}

async function overwriteAndDeleteFile(filePath, passes, onProgress) {
  const p = String(filePath || '');
  if (!p) return;

  let st;
  try {
    st = await fs.promises.stat(p);
  } catch (e) {
    throw new Error(`Missing file: ${p}`);
  }
  if (!st.isFile()) return;

  // Rename before wipe (best-effort)
  let workPath = p;
  try {
    const dir = path.dirname(p);
    const rnd = crypto.randomBytes(12).toString('hex');
    const renamed = path.join(dir, rnd);
    await fs.promises.rename(p, renamed);
    workPath = renamed;
  } catch (_) {}

  if (passes <= 0) {
    await fs.promises.unlink(workPath);
    return;
  }

  const size = Number(st.size || 0);
  const chunkSize = 1024 * 1024; // 1MB
  const buf = Buffer.allocUnsafe(chunkSize);

  const fh = await fs.promises.open(workPath, 'r+');
  try {
    for (let pass = 1; pass <= passes; pass++) {
      let offset = 0;
      while (offset < size) {
        const len = Math.min(chunkSize, size - offset);
        crypto.randomFillSync(buf, 0, len);
        await fh.write(buf, 0, len, offset);
        offset += len;
      }
      try { await fh.sync(); } catch (_) {}
      if (typeof onProgress === 'function') {
        onProgress({ pass, passes });
      }
    }
  } finally {
    try { await fh.close(); } catch (_) {}
  }

  try { await fs.promises.truncate(workPath, 0); } catch (_) {}
  await fs.promises.unlink(workPath);
}

function resolveSpecialTargetPaths(targets) {
  const t = Array.isArray(targets) ? targets.map(String) : [];
  const out = [];
  const platform = process.platform;

  if (t.includes('downloads')) {
    try { out.push(app.getPath('downloads')); } catch (_) {}
  }
  if (t.includes('temp')) {
    try { out.push(app.getPath('temp')); } catch (_) { out.push(os.tmpdir()); }
  }
  if (t.includes('recycle')) {
    if (platform === 'win32') {
      // Best-effort: common recycle bin folder (permissions may block)
      out.push('C:\\$Recycle.Bin');
    } else if (platform === 'darwin') {
      out.push(path.join(os.homedir(), '.Trash'));
    } else {
      out.push(path.join(os.homedir(), '.local', 'share', 'Trash', 'files'));
    }
  }
  if (t.includes('browser')) {
    // Best-effort cache locations. Often locked; failures are reported.
    if (platform === 'win32') {
      const local = process.env.LOCALAPPDATA || '';
      if (local) {
        out.push(path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'));
        out.push(path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'));
      }
    } else if (platform === 'darwin') {
      out.push(path.join(os.homedir(), 'Library', 'Caches', 'Google', 'Chrome'));
      out.push(path.join(os.homedir(), 'Library', 'Caches', 'Microsoft Edge'));
    } else {
      out.push(path.join(os.homedir(), '.cache', 'google-chrome'));
      out.push(path.join(os.homedir(), '.cache', 'chromium'));
    }
  }

  // Deduplicate + keep existing
  const seen = new Set();
  const cleaned = [];
  for (const p of out) {
    const s = String(p || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    cleaned.push(s);
  }
  return cleaned;
}

function hasBundledFrontend() {
  try {
    return fs.existsSync(LOCAL_FRONTEND_INDEX);
  } catch (_) {
    return false;
  }
}

async function loadFrontend({ preferredPath = '/', reason = '' } = {}) {
  if (!mainWindow) return;

  const safePath = String(preferredPath || '/').startsWith('/') ? String(preferredPath || '/') : '/';

  // Load the local desktop UI with sidebar + file explorer connected to live API
  const localUIUrl = `file://${LOCAL_UI_INDEX}`;
  console.log('[FileShot] Loading desktop UI:', localUIUrl, reason ? `(${reason})` : '');
  await mainWindow.loadFile(LOCAL_UI_INDEX);
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('api-config', { apiUrl: API_URL });
  });
  return;
}

async function loadFrontendFallback({ preferredPath = '/', reason = '' } = {}) {
  if (!mainWindow) return;

  const safePath = String(preferredPath || '/').startsWith('/') ? String(preferredPath || '/') : '/';

  // Dev: always use local dev server.
  if (isDev) {
    const url = `http://localhost:8080${safePath}`;
    console.log('[FileShot] Dev load:', url, reason ? `(${reason})` : '');
    await mainWindow.loadURL(url);
    return;
  }

  // Prod: try cloud first, fall back to bundled, then to offline page.
  try {
    const url = `${FRONTEND_URL}${safePath}`;
    console.log('[FileShot] Prod load:', url, reason ? `(${reason})` : '');
    await mainWindow.loadURL(url);
    return;
  } catch (err) {
    console.warn('[FileShot] Cloud load failed, falling back...', err && err.message ? err.message : err);
  }

  if (hasBundledFrontend()) {
    console.log('[FileShot] Loading bundled frontend:', LOCAL_FRONTEND_INDEX);
    await mainWindow.loadFile(LOCAL_FRONTEND_INDEX);
    return;
  }

  if (fs.existsSync(LOCAL_OFFLINE_PAGE)) {
    console.log('[FileShot] Loading offline page:', LOCAL_OFFLINE_PAGE);
    await mainWindow.loadFile(LOCAL_OFFLINE_PAGE);
    return;
  }

  // Absolute last resort
  await mainWindow.loadURL(FRONTEND_URL);
}

// Auto-updater configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

/**
 * Create the main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: true
    },
    show: false, // Don't show until ready
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default',
    autoHideMenuBar: true
  });

  // Primary behavior: load the live cloud app first.
  // If offline/unreachable, load bundled/offline fallbacks inside loadFrontend.
  loadFrontend({ preferredPath: '/', reason: 'startup' }).catch((e) => {
    console.error('[FileShot] Failed initial load, will rely on fallback handler', e);
  });

  if (isDev) {
    console.log('[FileShot] Development mode enabled');
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close - fully quit the app
  mainWindow.on('close', (event) => {
    // Quit the entire application when window is closed
    app.quit();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // For safety, never allow new windows inside Electron.
    // If it's a FileShot page, open it in the same window instead of the system browser.
    try {
      const u = new URL(url);
      const isFileShot = u.hostname === 'fileshot.io' || u.hostname === 'www.fileshot.io';
      if (isFileShot && mainWindow) {
        loadFrontendFallback({ preferredPath: u.pathname + u.search + u.hash, reason: 'same-window navigation' }).catch(() => {});
        return { action: 'deny' };
      }
    } catch (_) {}

    shell.openExternal(url);
    return { action: 'deny' };
  });

  // If cloud URL fails (offline / DNS / tunnel), fall back automatically.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn('[FileShot] did-fail-load', { errorCode, errorDescription, validatedURL });
    // Avoid loops when we're already on a file:// fallback.
    if (String(validatedURL || '').startsWith('file:')) return;
    loadFrontend({ preferredPath: '/', reason: `did-fail-load:${errorCode}` }).catch(() => {});
  });
}

// ============================================================================
// DRAG-OUT FROM LOCAL EXPLORER (OS DRAG)
// ============================================================================

ipcMain.on('start-drag', async (event, paths) => {
  const list = Array.isArray(paths) ? paths.map(String).filter(Boolean) : [];
  if (!list.length) return;

  const wc = event.sender;
  if (!wc || typeof wc.startDrag !== 'function') return;

  // If folders are included, expand them into file paths so web uploads can accept the drop.
  // NOTE: Many sites don't accept directory drops, but do accept multiple files.
  let dragFiles = [];
  for (const p of list) {
    const st = safeStat(p);
    if (!st) continue;
    if (st.isFile()) {
      dragFiles.push(p);
    } else if (st.isDirectory()) {
      try {
        const files = getAllFilesInFolder(p);
        dragFiles.push(...files);
      } catch (_) {}
    }
  }

  // Prevent pathological huge drags from freezing the app.
  if (dragFiles.length > 2000) {
    dragFiles = dragFiles.slice(0, 2000);
  }

  if (!dragFiles.length) {
    // Fall back to dragging the first original path if expansion produced nothing.
    dragFiles = [list[0]];
  }

  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  try {
    // Electron supports `files` in newer versions; fall back to single file.
    try {
      if (dragFiles.length > 1) {
        wc.startDrag({ files: dragFiles, icon });
      } else {
        wc.startDrag({ file: dragFiles[0], icon });
      }
    } catch (_) {
      wc.startDrag({ file: dragFiles[0], icon });
    }
  } catch (err) {
    console.error('Drag operation failed:', err);
  }
});

/**
 * Create system tray icon
 */
function buildTrayMenuTemplate() {
  const driveEnabled = Boolean(store.get('drive.enabled', false));
  const driveLetter = getConfiguredDriveLetter();

  return [
    {
      label: 'Open FileShot',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Local Vault',
      click: async () => {
        if (!mainWindow) createWindow();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          try {
            await mainWindow.loadFile(LOCAL_UI_INDEX);
          } catch (_) {}
        }
      }
    },
    {
      label: 'My Files',
      click: () => {
        if (!mainWindow) createWindow();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          loadFrontend({ preferredPath: '/my-files.html', reason: 'tray:my-files' }).catch(() => {});
        }
      }
    },
    {
      label: 'Upload File',
      click: () => {
        selectAndUploadFile();
      }
    },
    {
      label: 'Upload Folder',
      click: () => {
        selectAndUploadFolder();
      }
    },
    {
      label: `FileShot Drive (${driveLetter}:)`,
      submenu: [
        {
          label: driveEnabled ? 'Disable Drive' : 'Enable Drive',
          click: () => {
            if (driveEnabled) {
              disableFileShotDrive().catch(() => {});
            } else {
              enableFileShotDrive().catch(() => {});
            }
          }
        },
        {
          label: 'Open Drive',
          enabled: driveEnabled,
          click: () => {
            shell.openPath(getDriveRootPath(driveLetter));
          }
        },
        {
          label: 'Open Drive Inbox Folder',
          click: () => {
            ensureDriveDirs().catch(() => {});
            shell.openPath(getDriveInboxDir());
          }
        },
        {
          label: 'Note: drop files to auto-upload',
          enabled: false
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Recent Uploads',
      submenu: getRecentUploadsMenu()
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          loadFrontend({ preferredPath: '/account-dashboard.html', reason: 'tray:settings' }).catch(() => {});
        }
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ];
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  tray.setToolTip('FileShot - Fast, Private File Sharing');
  rebuildTrayMenu();

  // Double-click to open window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  // Enable drag & drop on tray icon
  tray.on('drop-files', (event, files) => {
    event.preventDefault();
    uploadFiles(files);
  });
}

/**
 * Get recent uploads menu
 */
function getRecentUploadsMenu() {
  const recentUploads = store.get('recentUploads', []);
  
  if (recentUploads.length === 0) {
    return [{ label: 'No recent uploads', enabled: false }];
  }

  return recentUploads.slice(0, 5).map(upload => ({
    label: upload.fileName,
    click: () => {
      shell.openExternal(upload.url);
    }
  }));
}

/**
 * Select and upload file
 */
async function selectAndUploadFile() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select files to upload'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    uploadFiles(result.filePaths);
  }
}

/**
 * Select and upload folder
 */
async function selectAndUploadFolder() {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select folder to upload'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    const files = getAllFilesInFolder(folderPath);
    uploadFiles(files);
  }
}

/**
 * Get all files in folder recursively
 */
function getAllFilesInFolder(folderPath) {
  const files = [];
  const items = fs.readdirSync(folderPath);

  items.forEach(item => {
    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllFilesInFolder(fullPath));
    } else {
      files.push(fullPath);
    }
  });

  return files;
}

/**
 * Upload files
 */
async function uploadFiles(filePaths) {
  const list = Array.isArray(filePaths) ? filePaths : [];
  if (list.length === 0) return;

  // v1.2+: Local-first. Add files to vault.
  const items = getVaultItems();
  let added = 0;
  for (const p of list) {
    try {
      const entry = addFileToVault(p);
      if (entry) {
        items.unshift(entry);
        added++;
      }
    } catch (e) {
      console.warn('[Vault] Failed to add dropped/selected file:', p, e && e.message ? e.message : e);
    }
  }
  setVaultItems(items);

  // Show local UI
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    try {
      await mainWindow.loadFile(LOCAL_UI_INDEX);
    } catch (_) {}
    try {
      mainWindow.webContents.send('vault-updated', { added });
    } catch (_) {}
  }

  // Send notification
  const notifier = require('node-notifier');
  notifier.notify({
    title: 'FileShot',
    message: `Added ${added} file(s) to Local Vault.`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    sound: false
  });
}

/**
 * Check for updates
 */
function checkForUpdates() {
  autoUpdater.checkForUpdates();
}

/**
 * Auto-updater events
 */
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) is available. Would you like to download it now?`,
    buttons: ['Download', 'Later']
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available');
  dialog.showMessageBox({
    type: 'info',
    title: 'No Updates',
    message: 'You are running the latest version of FileShot.',
    buttons: ['OK']
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download progress: ${progressObj.percent}%`);
  if (mainWindow) {
    mainWindow.setProgressBar(progressObj.percent / 100);
  }
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded');
  
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'Update downloaded. The application will restart to install the update.',
    buttons: ['Restart Now', 'Later']
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

/**
 * IPC handlers
 */
ipcMain.handle('get-api-url', () => {
  return API_URL;
});

ipcMain.handle('get-auth-token', () => {
  return store.get('authToken', null);
});

ipcMain.handle('set-auth-token', (event, token) => {
  store.set('authToken', token);
});

ipcMain.handle('clear-auth-token', () => {
  store.delete('authToken');
});

ipcMain.handle('add-recent-upload', (event, upload) => {
  const recentUploads = store.get('recentUploads', []);
  recentUploads.unshift(upload);
  
  // Keep only last 10 uploads
  if (recentUploads.length > 10) {
    recentUploads.pop();
  }
  
  store.set('recentUploads', recentUploads);
  
  // Update tray menu
  rebuildTrayMenu();
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });
  
  return result.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  
  return result.filePaths;
});

ipcMain.handle('save-file', async (_event, options) => {
  const opts = options && typeof options === 'object' ? options : {};
  const result = await dialog.showSaveDialog({
    title: opts.title || 'Save File',
    defaultPath: opts.defaultPath,
    filters: Array.isArray(opts.filters) ? opts.filters : undefined
  });
  return { canceled: result.canceled, filePath: result.filePath };
});

ipcMain.handle('fs-list-drives', async () => {
  // Cross-platform “roots” list.
  // Windows: return common drive letters when possible.
  // macOS/Linux: return '/'
  const platform = process.platform;

  if (platform !== 'win32') {
    return [{ name: '/', path: '/' }];
  }

  // Windows: probe common drive letters quickly without shelling out
  const drives = [];
  for (let c = 67; c <= 90; c++) { // C..Z
    const letter = String.fromCharCode(c);
    const p = `${letter}:\\`;
    try {
      if (fs.existsSync(p)) drives.push({ name: p, path: p });
    } catch (_) {}
  }
  return drives.length ? drives : [{ name: 'C:\\', path: 'C:\\' }];
});

ipcMain.handle('fs-list-dir', async (_event, dirPath) => {
  const p = String(dirPath || '');
  if (!p) return { path: p, entries: [] };

  try {
    const entries = await fs.promises.readdir(p, { withFileTypes: true });
    const mapped = [];
    for (const ent of entries) {
      const full = path.join(p, ent.name);
      mapped.push({
        name: ent.name,
        path: full,
        isDir: ent.isDirectory(),
        isFile: ent.isFile()
      });
    }

    // Sort directories first, then files, then alpha
    mapped.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { path: p, entries: mapped };
  } catch (e) {
    return { path: p, entries: [], error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('copy-to-clipboard', async (_event, text) => {
  clipboard.writeText(String(text || ''));
  return { success: true };
});

function sendShredProgress(event, requestId, msg) {
  if (!requestId) return;
  try {
    event.sender.send(`shred-progress:${requestId}`, msg);
  } catch (_) {}
}

ipcMain.handle('shred-start', async (event, payload) => {
  const req = payload && typeof payload === 'object' ? payload : {};
  const requestId = String(req.requestId || '');
  const method = String(req.method || 'simple');
  const passes = shredPassesForMethod(method);

  const targets = Array.isArray(req.targets) ? req.targets.map(String) : [];
  const customPaths = Array.isArray(req.paths) ? req.paths.map(String) : [];

  const targetPaths = resolveSpecialTargetPaths(targets);
  const allRoots = [...customPaths, ...targetPaths]
    .map((p) => String(p || '').trim())
    .filter(Boolean);

  if (!allRoots.length) {
    return { success: false, error: 'No targets specified' };
  }

  // Expand directories to files, keep file targets as-is.
  const files = [];
  const dirs = [];
  for (const p of allRoots) {
    try {
      const st = await fs.promises.stat(p);
      if (st.isDirectory()) dirs.push(p);
      else if (st.isFile()) files.push(p);
    } catch (_) {
      // Missing targets are ignored but reported
    }
  }

  for (const d of dirs) {
    await listFilesRecursive(d, files);
  }

  // Deduplicate files
  const uniq = [];
  const seen = new Set();
  for (const f of files) {
    if (!f) continue;
    const key = String(f);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(key);
  }

  const total = uniq.length;
  const errors = [];

  sendShredProgress(event, requestId, { percent: 0, message: `Preparing… (${total} file(s))` });

  let done = 0;
  for (const f of uniq) {
    try {
      sendShredProgress(event, requestId, {
        percent: total ? Math.round((done / total) * 100) : 0,
        message: `Shredding: ${f}`
      });

      await overwriteAndDeleteFile(f, passes, ({ pass, passes: pcount }) => {
        sendShredProgress(event, requestId, {
          percent: total ? Math.round((done / total) * 100) : 0,
          message: `Wipe pass ${pass}/${pcount}: ${path.basename(f)}`
        });
      });
    } catch (e) {
      errors.push({ path: f, error: e && e.message ? e.message : String(e) });
    }
    done++;
    sendShredProgress(event, requestId, {
      percent: total ? Math.round((done / total) * 100) : 100,
      message: `Progress: ${done}/${total}`
    });
  }

  // Best-effort cleanup of emptied directories
  for (const d of dirs) {
    try { await tryRemoveEmptyDirs(d); } catch (_) {}
  }

  const success = errors.length === 0;
  sendShredProgress(event, requestId, { percent: 100, message: success ? 'Complete' : `Complete with ${errors.length} error(s)` });

  return { success, totalFiles: total, errors };
});

ipcMain.handle('go-online', async () => {
  if (!mainWindow) return { success: false };

  // Always keep the local UI shell so the sidebar remains available.
  // The renderer will embed the live site in a <webview> panel.
  const url = String(mainWindow.webContents.getURL() || '');
  const inLocalShell = url.startsWith('file:') && url.includes('renderer/local/index.html');
  if (!inLocalShell) {
    try {
      await mainWindow.loadFile(LOCAL_UI_INDEX);
    } catch (_) {}
  }

  try {
    mainWindow.webContents.send('navigate-to', { tool: 'online', url: FRONTEND_URL });
  } catch (_) {}

  mainWindow.show();
  mainWindow.focus();
  return { success: true };
});

ipcMain.handle('open-external', async (_event, url) => {
  const u = String(url || '').trim();
  if (!u) return { success: false };
  try {
    await shell.openExternal(u);
    return { success: true };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
});

// Handle files dragged onto the Online webview - trigger upload in the webview
ipcMain.handle('upload-files-to-online', async (_event, paths) => {
  if (!mainWindow || !paths || !paths.length) return { success: false };
  try {
    // Send file paths to the renderer which will handle the webview interaction
    mainWindow.webContents.send('trigger-online-upload', paths);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('vault-list', async () => {
  const items = getVaultItems();
  return { items, totalBytes: vaultTotalBytes(items) };
});

ipcMain.handle('vault-add', async (_event, { paths, passphrase }) => {
  const list = Array.isArray(paths) ? paths : [];
  if (!passphrase || passphrase.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters' };
  }
  const items = getVaultItems();
  let added = 0;

  for (const p of list) {
    try {
      const entry = await addFileToVault(p, passphrase);
      if (entry) {
        items.unshift(entry);
        added++;
      }
    } catch (e) {
      console.warn('[Vault] Failed to add file:', p, e && e.message ? e.message : e);
    }
  }

  setVaultItems(items);
  return { success: true, added };
});

ipcMain.handle('vault-add-folder', async (_event, { folderPath, passphrase }) => {
  const folder = String(folderPath || '');
  if (!passphrase || passphrase.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters' };
  }
  const st = safeStat(folder);
  if (!st || !st.isDirectory()) return { success: false, error: 'Folder not found' };

  const files = getAllFilesInFolder(folder);
  const items = getVaultItems();
  let added = 0;

  for (const p of files) {
    try {
      const entry = await addFileToVault(p, passphrase);
      if (entry) {
        items.unshift(entry);
        added++;
      }
    } catch (e) {
      console.warn('[Vault] Failed to add file from folder:', p, e && e.message ? e.message : e);
    }
  }

  setVaultItems(items);
  return { success: true, added };
});

ipcMain.handle('vault-remove', async (_event, localId) => {
  const id = String(localId || '');
  const items = getVaultItems();
  const idx = items.findIndex((it) => String(it.id) === id);
  if (idx === -1) return { success: false, error: 'Not found' };

  const [removed] = items.splice(idx, 1);
  setVaultItems(items);

  // NOTE: This is normal deletion. Secure deletion (shred) is a separate feature.
  try {
    if (removed && removed.localPath && fs.existsSync(removed.localPath)) {
      fs.unlinkSync(removed.localPath);
    }
  } catch (e) {
    console.warn('[Vault] Failed to delete local file:', e && e.message ? e.message : e);
  }

  return { success: true };
});

// Open/preview a vault file by decrypting to temp and opening
ipcMain.handle('vault-open', async (_event, { localId, passphrase }) => {
  const id = String(localId || '');
  const items = getVaultItems();
  const it = items.find((x) => String(x.id) === id);
  if (!it) return { success: false, error: 'Not found' };
  if (!it.localPath || !fs.existsSync(it.localPath)) return { success: false, error: 'File missing' };

  // Encrypted files require password to decrypt
  if (it.encrypted) {
    if (!passphrase) {
      return { success: false, error: 'Password required', needPassword: true };
    }
    try {
      ensureVaultDirs();
      const tmpPath = path.join(getVaultTmpDir(), it.name);
      await decryptZkeContainer({
        inputPath: it.localPath,
        outputPath: tmpPath,
        passphrase: passphrase
      });
      await shell.openPath(tmpPath);
      return { success: true, tmpPath };
    } catch (e) {
      // Check if it's a decryption error (wrong password)
      if (e.message && (e.message.includes('decrypt') || e.message.includes('auth') || e.message.includes('tag'))) {
        return { success: false, error: 'Incorrect password', wrongPassword: true };
      }
      return { success: false, error: e.message || String(e) };
    }
  }

  // For legacy non-encrypted files, open directly
  try {
    await shell.openPath(it.localPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// Export a single vault file (decrypt and save to user-chosen location)
ipcMain.handle('vault-export-file', async (_event, { localId, passphrase }) => {
  const id = String(localId || '');
  const items = getVaultItems();
  const it = items.find((x) => String(x.id) === id);
  if (!it) return { success: false, error: 'Not found' };
  if (!it.localPath || !fs.existsSync(it.localPath)) return { success: false, error: 'File missing' };

  // Check password requirement first
  if (it.encrypted && !passphrase) {
    return { success: false, error: 'Password required', needPassword: true };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: it.name,
    title: 'Export Decrypted File'
  });

  if (result.canceled || !result.filePath) return { success: false, canceled: true };

  if (it.encrypted) {
    try {
      await decryptZkeContainer({
        inputPath: it.localPath,
        outputPath: result.filePath,
        passphrase: passphrase
      });
      return { success: true, path: result.filePath };
    } catch (e) {
      if (e.message && (e.message.includes('decrypt') || e.message.includes('auth') || e.message.includes('tag'))) {
        return { success: false, error: 'Incorrect password', wrongPassword: true };
      }
      return { success: false, error: e.message || String(e) };
    }
  }

  // Legacy non-encrypted: just copy
  try {
    fs.copyFileSync(it.localPath, result.filePath);
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// Export entire vault as encrypted backup archive
ipcMain.handle('vault-export-all', async () => {
  const items = getVaultItems();
  if (!items.length) return { success: false, error: 'Vault is empty' };

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `fileshot-vault-backup-${Date.now()}.json`,
    title: 'Export Vault Backup',
    filters: [{ name: 'FileShot Vault Backup', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) return { success: false, canceled: true };

  try {
    // Create backup object with metadata and base64-encoded encrypted files
    const backup = {
      version: 1,
      exportedAt: Date.now(),
      files: []
    };

    for (const it of items) {
      if (!it.localPath || !fs.existsSync(it.localPath)) continue;
      const fileData = fs.readFileSync(it.localPath);
      backup.files.push({
        id: it.id,
        name: it.name,
        originalSize: it.originalSize || it.size,
        addedAt: it.addedAt,
        encrypted: it.encrypted || false,
        encryptionKey: it.encryptionKey || null,
        data: fileData.toString('base64')
      });
    }

    fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2));
    return { success: true, path: result.filePath, count: backup.files.length };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// Import vault from backup
ipcMain.handle('vault-import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Vault Backup',
    filters: [{ name: 'FileShot Vault Backup', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };

  try {
    const content = fs.readFileSync(result.filePaths[0], 'utf8');
    const backup = JSON.parse(content);
    
    if (!backup.files || !Array.isArray(backup.files)) {
      return { success: false, error: 'Invalid backup format' };
    }

    ensureVaultDirs();
    const items = getVaultItems();
    let imported = 0;

    for (const file of backup.files) {
      const id = genId();
      const storedName = `${id}.fszk`;
      const destPath = path.join(getVaultFilesDir(), storedName);
      
      const fileData = Buffer.from(file.data, 'base64');
      fs.writeFileSync(destPath, fileData);

      items.unshift({
        id,
        name: file.name,
        originalSize: file.originalSize,
        size: fileData.length,
        addedAt: file.addedAt || Date.now(),
        localPath: destPath,
        encrypted: file.encrypted || false,
        encryptionKey: file.encryptionKey || null,
        importedFrom: result.filePaths[0]
      });
      imported++;
    }

    setVaultItems(items);
    return { success: true, imported };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

function sendUploadProgress(event, requestId, payload) {
  if (!requestId) return;
  try {
    event.sender.send(`upload-progress:${requestId}`, payload);
  } catch (_) {}
}

ipcMain.handle('upload-zke', async (event, { localId, options, requestId }) => {
  const id = String(localId || '');
  const items = getVaultItems();
  const it = items.find((x) => String(x.id) === id);
  if (!it) throw new Error('Local file not found');
  if (!it.localPath || !fs.existsSync(it.localPath)) throw new Error('Local file missing on disk');

  const mode = options && options.mode === 'passphrase' ? 'passphrase' : 'raw';
  const passphrase = mode === 'passphrase' ? String(options.passphrase || '') : null;

  sendUploadProgress(event, requestId, { percent: 5, stage: 'Encrypting locally (ZKE)...' });

  ensureVaultDirs();
  const tmpOut = path.join(getVaultTmpDir(), `${id}.fszk`);

  // Encrypt plaintext -> FSZK container (ciphertext + header)
  const enc = await encryptFileToZkeContainer({
    inputPath: it.localPath,
    outputPath: tmpOut,
    originalName: it.name,
    originalMimeType: 'application/octet-stream',
    mode,
    passphrase,
    chunkSize: 512 * 1024
  });

  const encryptedStat = fs.statSync(tmpOut);
  const encryptedSize = encryptedStat.size;

  sendUploadProgress(event, requestId, { percent: 20, stage: 'Requesting upload slot...' });

  const token = store.get('authToken', null);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Pre-upload reserves fileId and returns base download URL.
  const preUploadBody = {
    fileName: it.name,
    fileSize: it.size,
    isZeroKnowledge: 'true',
    originalFileName: it.name,
    originalFileSize: it.size,
    originalMimeType: 'application/octet-stream'
  };

  const pre = await axios.post(`${API_URL}/files/pre-upload`, preUploadBody, {
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    timeout: 60000
  });

  const fileId = pre?.data?.fileId;
  if (!fileId) throw new Error('Pre-upload failed (missing fileId)');

  // Upload encrypted file in chunks.
  const NET_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
  const totalChunks = Math.max(1, Math.ceil(encryptedSize / NET_CHUNK_SIZE));
  let uploaded = 0;

  sendUploadProgress(event, requestId, { percent: 25, stage: `Uploading (${totalChunks} chunks)...` });

  const fd = fs.openSync(tmpOut, 'r');
  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * NET_CHUNK_SIZE;
      const end = Math.min(start + NET_CHUNK_SIZE, encryptedSize);
      const len = end - start;

      const buf = Buffer.allocUnsafe(len);
      const read = fs.readSync(fd, buf, 0, len, start);
      if (read !== len) {
        throw new Error('Failed to read encrypted chunk');
      }

      const form = new FormData();
      form.append('chunk', buf, { filename: `chunk-${chunkIndex}` });
      form.append('totalChunks', String(totalChunks));
      form.append('isLastChunk', String(chunkIndex === totalChunks - 1));

      await axios.post(`${API_URL}/files/upload-chunk/${fileId}/${chunkIndex}`, form, {
        headers: {
          ...form.getHeaders(),
          ...headers
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000
      });

      uploaded += len;
      const pct = 25 + Math.floor((uploaded / encryptedSize) * 70);
      sendUploadProgress(event, requestId, { percent: Math.min(95, pct), stage: `Uploading... ${chunkIndex + 1}/${totalChunks}` });
    }
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }

  sendUploadProgress(event, requestId, { percent: 96, stage: 'Finalizing...' });

  await axios.post(`${API_URL}/files/finalize-upload/${fileId}`, {}, {
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    timeout: 600000
  });

  // Build share URL. For raw-key mode, attach #k=... fragment (never hits the server).
  const shareUrl = `${FRONTEND_URL}/downloads.html?f=${encodeURIComponent(fileId)}${enc.rawKey ? `#k=${encodeURIComponent(enc.rawKey)}` : ''}`;

  // Persist key locally for convenience (local-only).
  it.lastUpload = {
    fileId,
    shareUrl,
    shareKey: enc.rawKey || null,
    keyMode: enc.keyMode,
    uploadedAt: Date.now()
  };
  setVaultItems(items);

  sendUploadProgress(event, requestId, { percent: 100, stage: 'Done' });

  // Cleanup temp ciphertext.
  try { fs.unlinkSync(tmpOut); } catch (_) {}

  return { success: true, fileId, shareUrl, keyMode: enc.keyMode };
});

/**
 * App lifecycle
 */
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Windows: enable FileShot Drive by default on first run.
  // (This was the core point of the v1.4.8 update; requiring a manual tray toggle is too easy to miss.)
  if (isDriveFeatureAvailable()) {
    const existing = store.get('drive.enabled');
    if (typeof existing === 'undefined') {
      store.set('drive.enabled', true);
    }

    if (Boolean(store.get('drive.enabled', false))) {
      enableFileShotDrive().catch(() => {});
    }
  }
  
  // Check for updates on startup (after 5 seconds)
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  // Don't quit on macOS when all windows are closed
  if (process.platform !== 'darwin') {
    // Keep running in tray
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  // Best-effort cleanup of mapped drive.
  if (isDriveFeatureAvailable() && Boolean(store.get('drive.enabled', false))) {
    cleanupFileShotDriveRuntime().catch(() => {});
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', `An error occurred: ${error.message}`);
});
