/**
 * FileShot Desktop V2 — Main Process
 * Handles window management, system tray, IPC, vault, drive, shredder.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const { autoUpdater } = require('electron-updater');

const { encryptFileToZkeContainer, decryptZkeContainer, parseHeader } = require('./utils/zke-stream');
const archiver = require('archiver');

// ─── Simple JSON Store (no external dep) ─────────────────────────────────────
class JsonStore {
  constructor(name = 'config') {
    this.filePath = path.join(app.getPath('userData'), `${name}.json`);
    this.data = {};
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (_) {}
  }
  get(key, defaultValue) {
    const keys = String(key).split('.');
    let v = this.data;
    for (const k of keys) {
      if (v == null || typeof v !== 'object') return defaultValue;
      v = v[k];
    }
    return v !== undefined ? v : defaultValue;
  }
  set(key, value) {
    const keys = String(key).split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._save();
  }
  delete(key) {
    const keys = String(key).split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null) return;
      obj = obj[keys[i]];
    }
    delete obj[keys[keys.length - 1]];
    this._save();
  }
  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (_) {}
  }
}

const store = new JsonStore('fileshot-v2');

// ─── Configuration ───────────────────────────────────────────────────────────
const isDev = process.argv.includes('--dev');
const API_BASE = isDev ? 'http://localhost:3000/api' : 'https://api.fileshot.io/api';
const FRONTEND_URL = isDev ? 'http://localhost:8080' : 'https://fileshot.io';

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ─── Vault Paths ─────────────────────────────────────────────────────────────
function vaultRoot() { return path.join(app.getPath('userData'), 'vault-v2'); }
function vaultFilesDir() { return path.join(vaultRoot(), 'files'); }
function vaultTmpDir() { return path.join(vaultRoot(), 'tmp'); }

function ensureVaultDirs() {
  fs.mkdirSync(vaultFilesDir(), { recursive: true });
  fs.mkdirSync(vaultTmpDir(), { recursive: true });
}

// ─── Blocked File Extensions (mirror of backend/utils/fileUtils.js) ──────────
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.msi',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1',
  '.sh', '.bash', '.zsh', '.run', '.app', '.deb', '.rpm', '.dmg', '.pkg',
  '.jar', '.apk',
  '.php', '.php3', '.php4', '.php5', '.phtml', '.asp', '.aspx', '.jsp', '.cgi',
  '.dll', '.sys', '.drv', '.ocx', '.so', '.dylib'
];

function hasBlockedExtension(filename) {
  const parts = String(filename).toLowerCase().split('.');
  return parts.slice(1).some(ext => BLOCKED_EXTENSIONS.includes('.' + ext));
}

// ─── Drive Keyring (fileId → { rawKey, originalName, wasZipped }) ────────────
function getKeyring() { return store.get('driveKeyring', {}); }
function saveKeyToKeyring(fileId, rawKey, originalName, wasZipped = false) {
  const kr = getKeyring();
  kr[fileId] = { rawKey, originalName, wasZipped, savedAt: Date.now() };
  store.set('driveKeyring', kr);
}
function getKeyFromKeyring(fileId) { return getKeyring()[fileId] || null; }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function safeStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : i === 1 ? 1 : 2)} ${units[i]}`;
}

function sanitizeFileName(name) {
  return String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 180) || 'file';
}

function execPromise(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, ...opts }, (error, stdout, stderr) => {
      if (error) return reject({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ─── API Helper ──────────────────────────────────────────────────────────────
function getAuthHeaders() {
  const token = store.get('authToken');
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function getCsrfToken() {
  try {
    const res = await axios.get(`${API_BASE}/csrf-token`, {
      headers: getAuthHeaders(),
      timeout: 10000
    });
    return res.data?.csrfToken || res.data?.token || '';
  } catch (_) {
    return '';
  }
}

async function apiGet(endpoint, opts = {}) {
  const res = await axios.get(`${API_BASE}${endpoint}`, {
    headers: { ...getAuthHeaders(), ...(opts.headers || {}) },
    timeout: opts.timeout || 30000,
    ...(opts.responseType ? { responseType: opts.responseType } : {})
  });
  return res.data;
}

async function apiPost(endpoint, body = {}, opts = {}) {
  const csrf = opts.csrf !== false ? await getCsrfToken() : '';
  const headers = {
    ...getAuthHeaders(),
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    ...(opts.headers || {})
  };
  if (!(body instanceof FormData) && !opts.headers?.['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await axios.post(`${API_BASE}${endpoint}`, body, {
    headers,
    timeout: opts.timeout || 60000,
    ...(opts.maxContentLength ? { maxContentLength: opts.maxContentLength } : {}),
    ...(opts.maxBodyLength ? { maxBodyLength: opts.maxBodyLength } : {})
  });
  return res.data;
}

async function apiPut(endpoint, body = {}, opts = {}) {
  const csrf = await getCsrfToken();
  const res = await axios.put(`${API_BASE}${endpoint}`, body, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(opts.headers || {})
    },
    timeout: opts.timeout || 30000
  });
  return res.data;
}

async function apiDelete(endpoint, opts = {}) {
  const csrf = await getCsrfToken();
  const res = await axios.delete(`${API_BASE}${endpoint}`, {
    headers: {
      ...getAuthHeaders(),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(opts.headers || {})
    },
    timeout: opts.timeout || 30000
  });
  return res.data;
}

// ─── Window State Persistence ────────────────────────────────────────────────
function getWindowState() {
  const def = { width: 1280, height: 860, x: undefined, y: undefined, maximized: false };
  const saved = store.get('windowState', def);
  // Validate that the saved position is on a visible display
  if (saved.x !== undefined && saved.y !== undefined) {
    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const b = d.bounds;
      return saved.x >= b.x && saved.x < b.x + b.width && saved.y >= b.y && saved.y < b.y + b.height;
    });
    if (!visible) { saved.x = undefined; saved.y = undefined; }
  }
  return saved;
}

function saveWindowState() {
  if (!mainWindow) return;
  const maximized = mainWindow.isMaximized();
  if (!maximized) {
    const bounds = mainWindow.getBounds();
    store.set('windowState', { ...bounds, maximized: false });
  } else {
    store.set('windowState.maximized', true);
  }
}

// ─── Create Window ───────────────────────────────────────────────────────────
function createWindow() {
  const ws = getWindowState();

  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    x: ws.x,
    y: ws.y,
    minWidth: 900,
    minHeight: 620,
    frame: false,             // Frameless for custom titlebar
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0a0e17',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false
    }
  });

  if (ws.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.on('close', (e) => {
    if (!isQuitting && store.get('settings.minimizeToTray', false)) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      saveWindowState();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Prevent new windows; open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip('FileShot — Encrypted File Sharing');
  rebuildTrayMenu();

  tray.on('double-click', () => showMainWindow());
}

function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;

  const loggedIn = !!store.get('authToken');
  const usage = store.get('storageCache');
  const usageLine = usage
    ? `Storage: ${formatBytes(usage.usage)} / ${formatBytes(usage.limit)}`
    : 'Storage: Not loaded';

  const template = [
    { label: 'Open FileShot', click: showMainWindow },
    { type: 'separator' },
    { label: usageLine, enabled: false },
    { type: 'separator' },
    {
      label: 'Quick Upload',
      enabled: loggedIn,
      click: async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          title: 'Select files to upload'
        });
        if (result.canceled || !result.filePaths.length) return;
        showMainWindow();
        mainWindow.webContents.send('trigger-upload', result.filePaths);
      }
    },
    { type: 'separator' },
    {
      label: 'Recent Uploads',
      submenu: getRecentUploadsMenu()
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      }
    },
    { type: 'separator' },
    {
      label: 'Quit FileShot',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function getRecentUploadsMenu() {
  const recent = store.get('recentUploads', []);
  if (!recent.length) return [{ label: 'No recent uploads', enabled: false }];
  return recent.slice(0, 8).map(u => ({
    label: u.name || 'Unknown',
    click: () => { if (u.url) shell.openExternal(u.url); }
  }));
}

function pushRecentUpload(name, url) {
  const list = store.get('recentUploads', []);
  list.unshift({ name, url, at: Date.now() });
  if (list.length > 20) list.length = 20;
  store.set('recentUploads', list);
  rebuildTrayMenu();
}

// ─── IPC: Window Controls ────────────────────────────────────────────────────
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.close());
ipcMain.handle('win:is-maximized', () => mainWindow?.isMaximized() ?? false);

// Forward maximize/unmaximize events to renderer
function setupWindowEvents() {
  if (!mainWindow) return;
  mainWindow.on('maximize', () => mainWindow.webContents.send('win:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:maximized', false));
}

// ─── IPC: Auth ───────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', async (_e, { email, password }) => {
  try {
    const res = await axios.post(`${API_BASE}/auth/login`, { email, password }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
    const token = res.data?.token;
    if (!token) throw new Error('No token returned');
    store.set('authToken', token);
    store.set('userEmail', email);
    rebuildTrayMenu();
    return { ok: true, token, user: res.data?.user || {} };
  } catch (e) {
    const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Login failed';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('auth:register', async (_e, { email, password }) => {
  try {
    const res = await axios.post(`${API_BASE}/auth/register`, { email, password }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
    const token = res.data?.token;
    if (token) {
      store.set('authToken', token);
      store.set('userEmail', email);
    }
    rebuildTrayMenu();
    return { ok: true, token, user: res.data?.user || {} };
  } catch (e) {
    const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Registration failed';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('auth:logout', async () => {
  try { await apiPost('/auth/logout'); } catch (_) {}
  store.delete('authToken');
  store.delete('userEmail');
  store.delete('storageCache');
  rebuildTrayMenu();
  return { ok: true };
});

ipcMain.handle('auth:me', async () => {
  try {
    const data = await apiGet('/auth/me');
    return { ok: true, user: data?.user || data };
  } catch (e) {
    if (e?.response?.status === 401) {
      store.delete('authToken');
      return { ok: false, error: 'Session expired' };
    }
    return { ok: false, error: e?.message || 'Failed to get user info' };
  }
});

ipcMain.handle('auth:check', () => {
  return { loggedIn: !!store.get('authToken'), email: store.get('userEmail', '') };
});

// ─── IPC: OAuth (Google / GitHub) ────────────────────────────────────────────
ipcMain.handle('auth:oauth', async (_e, { provider }) => {
  // provider = 'google' or 'github'
  const oauthUrl = `${API_BASE}/auth/${provider}?redirect=/`;

  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 520,
      height: 700,
      parent: mainWindow,
      modal: true,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    authWin.setMenuBarVisibility(false);

    // Watch for redirect back to frontend with auth_code
    const interceptNav = async (url) => {
      try {
        const parsed = new URL(url);
        const authCode = parsed.searchParams.get('auth_code');
        if (authCode) {
          // Exchange the one-time code for a session token
          try {
            const res = await axios.post(`${API_BASE}/auth/exchange-code`, { code: authCode }, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 15000
            });
            if (res.data?.token) {
              store.set('authToken', res.data.token);
              const email = res.data?.user?.email || '';
              if (email) store.set('userEmail', email);
              rebuildTrayMenu();
              authWin.close();
              resolve({ ok: true, token: res.data.token, user: res.data.user || {} });
              return true;
            }
          } catch (ex) {
            authWin.close();
            resolve({ ok: false, error: ex?.response?.data?.error || ex?.message || 'OAuth code exchange failed' });
            return true;
          }
        }

        // Check for error param
        const error = parsed.searchParams.get('error');
        if (error) {
          authWin.close();
          resolve({ ok: false, error: error.replace(/_/g, ' ') });
          return true;
        }
      } catch (_) { /* not a valid URL yet */ }
      return false;
    };

    authWin.webContents.on('will-navigate', async (_event, url) => {
      await interceptNav(url);
    });

    authWin.webContents.on('will-redirect', async (_event, url) => {
      await interceptNav(url);
    });

    authWin.webContents.on('did-navigate', async (_event, url) => {
      await interceptNav(url);
    });

    authWin.on('closed', () => {
      resolve({ ok: false, error: 'OAuth window closed' });
    });

    authWin.loadURL(oauthUrl);
  });
});

// ─── IPC: Storage ────────────────────────────────────────────────────────────
ipcMain.handle('storage:usage', async () => {
  try {
    const data = await apiGet('/files/usage');
    const info = { usage: data?.usage || 0, limit: data?.limit || null, tier: data?.tier || 'free' };
    store.set('storageCache', info);
    rebuildTrayMenu();
    return { ok: true, ...info };
  } catch (e) {
    const cached = store.get('storageCache');
    return { ok: false, error: e?.message, ...(cached || {}) };
  }
});

// ─── IPC: Files ──────────────────────────────────────────────────────────────
ipcMain.handle('files:list', async () => {
  try {
    const data = await apiGet('/files/my-files');
    return { ok: true, files: data?.files || data || [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to list files', files: [] };
  }
});

ipcMain.handle('files:delete', async (_e, { fileId }) => {
  try {
    await apiDelete(`/files/delete/${fileId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.message || 'Delete failed' };
  }
});

ipcMain.handle('files:info', async (_e, { fileId }) => {
  try {
    const data = await apiGet(`/files/info/${fileId}`);
    return { ok: true, file: data };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
});

ipcMain.handle('files:update', async (_e, { fileId, settings }) => {
  try {
    const data = await apiPut(`/files/${fileId}`, settings);
    return { ok: true, file: data };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.message };
  }
});

ipcMain.handle('files:download', async (_e, { fileId, fileName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: fileName || `file-${fileId}`,
    title: 'Save file'
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    const response = await axios.get(`${API_BASE}/files/download/${fileId}`, {
      headers: getAuthHeaders(),
      responseType: 'stream',
      timeout: 600000
    });
    const writer = fs.createWriteStream(result.filePath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e?.message || 'Download failed' };
  }
});

ipcMain.handle('files:get-key', async (_e, { fileId }) => {
  try {
    const entry = getKeyFromKeyring(fileId);
    if (entry && entry.rawKey) {
      return { ok: true, rawKey: entry.rawKey };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
});

ipcMain.handle('files:preview', async (_e, { fileId }) => {
  try {
    const { tmpPath, headers } = await downloadToTemp(fileId);
    const isZke = headers['x-is-zero-knowledge'] === 'true' || headers['x-is-zero-knowledge'] === true;
    let contentBuf;
    let mimeType = headers['content-type'] || 'application/octet-stream';
    let realName = '';

    if (isZke) {
      const keyEntry = getKeyFromKeyring(fileId);
      if (!keyEntry || !keyEntry.rawKey) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        return { ok: false, error: 'No decryption key available' };
      }
      const decOut = path.join(vaultTmpDir(), `preview_${Date.now()}`);
      const dec = await decryptZkeContainer({ inputPath: tmpPath, outputPath: decOut, rawKeyBase64Url: keyEntry.rawKey });
      realName = dec.originalName || keyEntry.originalName || '';
      mimeType = dec.originalMimeType || mimeType;
      contentBuf = fs.readFileSync(decOut);
      try { fs.unlinkSync(decOut); } catch (_) {}
    } else {
      contentBuf = fs.readFileSync(tmpPath);
    }
    try { fs.unlinkSync(tmpPath); } catch (_) {}

    // Limit preview size to 10MB
    if (contentBuf.length > 10 * 1024 * 1024) {
      return { ok: false, error: 'File too large for preview' };
    }

    // Detect mime from file name
    const ext = path.extname(realName || '').toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.ico': 'image/x-icon',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
      '.aac': 'audio/aac', '.m4a': 'audio/mp4',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain', '.md': 'text/plain', '.json': 'text/plain',
      '.js': 'text/plain', '.ts': 'text/plain', '.css': 'text/plain',
      '.html': 'text/plain', '.xml': 'text/plain', '.csv': 'text/plain',
      '.py': 'text/plain', '.c': 'text/plain', '.h': 'text/plain',
      '.log': 'text/plain', '.cfg': 'text/plain', '.ini': 'text/plain',
      '.yaml': 'text/plain', '.yml': 'text/plain', '.toml': 'text/plain',
      '.sh': 'text/plain', '.bat': 'text/plain', '.ps1': 'text/plain'
    };
    if (mimeMap[ext]) mimeType = mimeMap[ext];

    const base64 = contentBuf.toString('base64');
    return { ok: true, dataUrl: `data:${mimeType};base64,${base64}`, mimeType, fileName: realName, size: contentBuf.length };
  } catch (e) {
    return { ok: false, error: e?.message || 'Preview failed' };
  }
});

ipcMain.handle('files:qr', async (_e, { fileId }) => {
  try {
    const response = await axios.get(`${API_BASE}/files/qr/${fileId}`, {
      headers: getAuthHeaders(),
      responseType: 'arraybuffer',
      timeout: 15000
    });
    const base64 = Buffer.from(response.data).toString('base64');
    const contentType = response.headers['content-type'] || 'image/png';
    return { ok: true, dataUrl: `data:${contentType};base64,${base64}` };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
});

// ─── IPC: Folders ────────────────────────────────────────────────────────────
ipcMain.handle('folders:list', async () => {
  try {
    const data = await apiGet('/folders/');
    return { ok: true, folders: data?.folders || data || [] };
  } catch (e) {
    return { ok: false, error: e?.message, folders: [] };
  }
});

ipcMain.handle('folders:create', async (_e, { name }) => {
  try {
    const data = await apiPost('/folders/', { name });
    return { ok: true, folder: data };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.message };
  }
});

ipcMain.handle('folders:delete', async (_e, { folderId }) => {
  try {
    await apiDelete(`/folders/${folderId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
});

ipcMain.handle('files:move', async (_e, { fileIds, folderId }) => {
  try {
    await apiPost('/files/move', { fileIds, folderId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
});

// ─── IPC: Upload ─────────────────────────────────────────────────────────────
ipcMain.handle('upload:files', async (event, { filePaths, options }) => {
  const token = store.get('authToken');
  if (!token) return { ok: false, error: 'Not logged in' };

  const results = [];
  const total = filePaths.length;

  for (let idx = 0; idx < total; idx++) {
    const filePath = filePaths[idx];
    const fileName = path.basename(filePath);

    try {
      const st = safeStat(filePath);
      if (!st || !st.isFile()) {
        results.push({ name: fileName, ok: false, error: 'Not a file' });
        continue;
      }

      // Send progress: starting
      event.sender.send('upload:progress', {
        index: idx, total, name: fileName, percent: 0, stage: 'Encrypting...'
      });

      // ZKE encrypt locally
      ensureVaultDirs();
      const tmpId = genId();
      const tmpOut = path.join(vaultTmpDir(), `${tmpId}.fszk`);

      const enc = await encryptFileToZkeContainer({
        inputPath: filePath,
        outputPath: tmpOut,
        originalName: fileName,
        originalMimeType: 'application/octet-stream',
        mode: 'raw',
        chunkSize: 512 * 1024
      });

      const encryptedSize = fs.statSync(tmpOut).size;

      event.sender.send('upload:progress', {
        index: idx, total, name: fileName, percent: 15, stage: 'Requesting upload slot...'
      });

      // Pre-upload
      const preData = await apiPost('/files/pre-upload', {
        fileName,
        fileSize: st.size,
        isZeroKnowledge: 'true',
        originalFileName: fileName,
        originalFileSize: st.size,
        originalMimeType: 'application/octet-stream'
      }, { csrf: false });

      const fileId = preData?.fileId;
      if (!fileId) throw new Error('Pre-upload failed');

      // Chunked upload
      const CHUNK_SIZE = 8 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(encryptedSize / CHUNK_SIZE));
      let uploaded = 0;

      const fd = fs.openSync(tmpOut, 'r');
      try {
        for (let ci = 0; ci < totalChunks; ci++) {
          const start = ci * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, encryptedSize);
          const len = end - start;
          const buf = Buffer.allocUnsafe(len);
          fs.readSync(fd, buf, 0, len, start);

          const form = new FormData();
          form.append('chunk', buf, { filename: `chunk-${ci}` });
          form.append('totalChunks', String(totalChunks));
          form.append('isLastChunk', String(ci === totalChunks - 1));

          await axios.post(`${API_BASE}/files/upload-chunk/${fileId}/${ci}`, form, {
            headers: { ...form.getHeaders(), ...getAuthHeaders() },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 600000
          });

          uploaded += len;
          const pct = 20 + Math.floor((uploaded / encryptedSize) * 70);
          event.sender.send('upload:progress', {
            index: idx, total, name: fileName, percent: Math.min(92, pct), stage: `Uploading chunk ${ci + 1}/${totalChunks}`
          });
        }
      } finally {
        try { fs.closeSync(fd); } catch (_) {}
      }

      event.sender.send('upload:progress', {
        index: idx, total, name: fileName, percent: 95, stage: 'Finalizing...'
      });

      // Finalize
      await apiPost(`/files/finalize-upload/${fileId}`, {}, { csrf: false });

      const shareUrl = `${FRONTEND_URL}/downloads.html?f=${encodeURIComponent(fileId)}${enc.rawKey ? `#k=${encodeURIComponent(enc.rawKey)}` : ''}`;

      // Cleanup temp
      try { fs.unlinkSync(tmpOut); } catch (_) {}

      event.sender.send('upload:progress', {
        index: idx, total, name: fileName, percent: 100, stage: 'Done'
      });

      // Store key in local keyring for drive access
      if (fileId && enc.rawKey) {
        saveKeyToKeyring(fileId, enc.rawKey, fileName, false);
      }

      pushRecentUpload(fileName, shareUrl);
      results.push({ name: fileName, ok: true, fileId, shareUrl, rawKey: enc.rawKey || null });

    } catch (e) {
      results.push({ name: fileName, ok: false, error: e?.response?.data?.error || e?.message || 'Upload failed' });
      event.sender.send('upload:progress', {
        index: idx, total, name: fileName, percent: -1, stage: `Error: ${e?.message || 'Failed'}`
      });
    }
  }

  return { ok: true, results };
});

// ─── IPC: Local Vault ────────────────────────────────────────────────────────
ipcMain.handle('vault:list', () => {
  const items = store.get('vault.items', []);
  const totalBytes = items.reduce((sum, it) => sum + Number(it.size || 0), 0);
  return { items, totalBytes };
});

ipcMain.handle('vault:add', async (_e, { filePaths, passphrase }) => {
  ensureVaultDirs();
  const added = [];

  for (const fp of filePaths) {
    const st = safeStat(fp);
    if (!st || !st.isFile()) continue;

    const id = genId();
    const name = path.basename(fp);
    const destPath = path.join(vaultFilesDir(), `${id}.fszk`);

    await encryptFileToZkeContainer({
      inputPath: fp,
      outputPath: destPath,
      originalName: name,
      mode: 'passphrase',
      passphrase
    });

    const encSt = safeStat(destPath);
    const item = {
      id, name,
      originalSize: st.size,
      size: encSt ? encSt.size : st.size,
      addedAt: Date.now(),
      localPath: destPath,
      encrypted: true
    };

    const items = store.get('vault.items', []);
    items.push(item);
    store.set('vault.items', items);
    added.push(item);
  }

  if (mainWindow) mainWindow.webContents.send('vault:updated');
  return { ok: true, added };
});

ipcMain.handle('vault:remove', (_e, { id }) => {
  const items = store.get('vault.items', []);
  const item = items.find(i => i.id === id);
  if (item && item.localPath) {
    try { fs.unlinkSync(item.localPath); } catch (_) {}
  }
  store.set('vault.items', items.filter(i => i.id !== id));
  if (mainWindow) mainWindow.webContents.send('vault:updated');
  return { ok: true };
});

ipcMain.handle('vault:open', async (_e, { id, passphrase }) => {
  const items = store.get('vault.items', []);
  const item = items.find(i => i.id === id);
  if (!item) return { ok: false, error: 'Item not found' };

  ensureVaultDirs();
  const tmpName = `${genId()}_${sanitizeFileName(item.name)}`;
  const tmpPath = path.join(vaultTmpDir(), tmpName);

  try {
    await decryptZkeContainer({
      inputPath: item.localPath,
      outputPath: tmpPath,
      passphrase
    });
    shell.openPath(tmpPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Decryption failed — wrong password?' };
  }
});

ipcMain.handle('vault:export', async (_e, { id, passphrase }) => {
  const items = store.get('vault.items', []);
  const item = items.find(i => i.id === id);
  if (!item) return { ok: false, error: 'Item not found' };

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: item.name,
    title: 'Export decrypted file'
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  try {
    await decryptZkeContainer({
      inputPath: item.localPath,
      outputPath: result.filePath,
      passphrase
    });
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e?.message || 'Decryption failed' };
  }
});

ipcMain.handle('vault:upload', async (event, { id, passphrase }) => {
  const token = store.get('authToken');
  if (!token) return { ok: false, error: 'Not logged in' };

  const items = store.get('vault.items', []);
  const item = items.find(i => i.id === id);
  if (!item) return { ok: false, error: 'Item not found' };

  ensureVaultDirs();
  const tmpDecrypt = path.join(vaultTmpDir(), `${genId()}_${sanitizeFileName(item.name)}`);

  try {
    await decryptZkeContainer({
      inputPath: item.localPath,
      outputPath: tmpDecrypt,
      passphrase
    });

    // Now upload the decrypted file (it will be re-encrypted with ZKE raw key)
    const result = await ipcMain.emit('upload:files', event, {
      filePaths: [tmpDecrypt],
      options: {}
    });

    try { fs.unlinkSync(tmpDecrypt); } catch (_) {}
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(tmpDecrypt); } catch (_) {}
    return { ok: false, error: e?.message || 'Upload failed' };
  }
});

// ─── IPC: File Shredder ──────────────────────────────────────────────────────
ipcMain.handle('shred:start', async (event, { paths, method, targets }) => {
  const passes = method === 'gutmann' ? 35 : method === 'dod' ? 7 : 1;
  const allPaths = [...(paths || [])];

  // Resolve special targets
  if (targets) {
    if (targets.includes('downloads')) {
      try { allPaths.push(app.getPath('downloads')); } catch (_) {}
    }
    if (targets.includes('temp')) {
      try { allPaths.push(app.getPath('temp')); } catch (_) { allPaths.push(os.tmpdir()); }
    }
    if (targets.includes('browser') && process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA || '';
      if (local) {
        allPaths.push(path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'));
        allPaths.push(path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'));
      }
    }
  }

  // Collect all files
  const files = [];
  for (const p of allPaths) {
    const st = safeStat(p);
    if (!st) continue;
    if (st.isFile()) {
      files.push(p);
    } else if (st.isDirectory()) {
      await collectFiles(p, files);
    }
  }

  const total = files.length;
  let done = 0;
  let errors = 0;

  for (const f of files) {
    try {
      await overwriteAndDelete(f, passes);
    } catch (_) {
      errors++;
    }
    done++;
    event.sender.send('shred:progress', { done, total, errors, current: path.basename(f) });
  }

  // Clean up empty dirs
  for (const p of allPaths) {
    const st = safeStat(p);
    if (st && st.isDirectory()) {
      await tryRemoveEmptyDirs(p);
    }
  }

  return { ok: true, shredded: done - errors, errors };
});

async function collectFiles(dir, list) {
  try {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await collectFiles(full, list);
      else if (e.isFile()) list.push(full);
    }
  } catch (_) {}
}

async function overwriteAndDelete(filePath, passes) {
  let st;
  try { st = await fs.promises.stat(filePath); } catch (_) { return; }
  if (!st.isFile()) return;

  // Rename before wipe
  let workPath = filePath;
  try {
    const dir = path.dirname(filePath);
    const rnd = crypto.randomBytes(12).toString('hex');
    workPath = path.join(dir, rnd);
    await fs.promises.rename(filePath, workPath);
  } catch (_) {}

  const size = Number(st.size || 0);
  if (passes > 0 && size > 0) {
    const chunkSize = 1024 * 1024;
    const buf = Buffer.allocUnsafe(chunkSize);
    const fh = await fs.promises.open(workPath, 'r+');
    try {
      for (let pass = 0; pass < passes; pass++) {
        let offset = 0;
        while (offset < size) {
          const len = Math.min(chunkSize, size - offset);
          crypto.randomFillSync(buf, 0, len);
          await fh.write(buf, 0, len, offset);
          offset += len;
        }
        try { await fh.sync(); } catch (_) {}
      }
    } finally {
      try { await fh.close(); } catch (_) {}
    }
  }

  try { await fs.promises.truncate(workPath, 0); } catch (_) {}
  await fs.promises.unlink(workPath);
}

async function tryRemoveEmptyDirs(dir) {
  try {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      if (e.isDirectory()) await tryRemoveEmptyDirs(path.join(dir, e.name));
    }
    const left = await fs.promises.readdir(dir);
    if (!left.length) await fs.promises.rmdir(dir);
  } catch (_) {}
}

// ─── IPC: Virtual Drive ─────────────────────────────────────────────────────
let trueDriveProc = null;

function isWinFspInstalled() {
  if (process.platform !== 'win32') return false;
  try {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const base = path.join(pf86, 'WinFsp');
    return fs.existsSync(path.join(base, 'bin')) || fs.existsSync(path.join(base, 'SxS'));
  } catch (_) {
    return false;
  }
}

function isDriveLetterAvailable(letter) {
  const L = String(letter || '').replace(':', '').toUpperCase().slice(0, 1);
  if (!/^[A-Z]$/.test(L) || 'ABC'.includes(L)) return false;
  try { return !fs.existsSync(`${L}:\\`); } catch (_) { return false; }
}

function pickAvailableDriveLetter(preferred) {
  const pref = String(preferred || '').replace(':', '').toUpperCase().slice(0, 1);
  const letters = [];
  if (/^[A-Z]$/.test(pref)) letters.push(pref);
  for (let c = 70; c <= 90; c++) letters.push(String.fromCharCode(c)); // F-Z
  letters.push('E', 'D');
  for (const L of letters) {
    if (isDriveLetterAvailable(L)) return L;
  }
  return null;
}

function getDriveBinaryPath() {
  return path.join(__dirname, 'drive', 'windows', 'winfsp', 'fileshot-drive', 'bin', 'fileshot-drive.exe');
}

ipcMain.handle('drive:status', () => {
  const mounted = !!trueDriveProc;
  const letter = store.get('drive.letter', 'F');
  const winfspInstalled = isWinFspInstalled();
  const binaryExists = fs.existsSync(getDriveBinaryPath());
  const enabled = store.get('drive.enabled', false);
  return { mounted, letter, winfspInstalled, binaryExists, enabled };
});

ipcMain.handle('drive:set-letter', (_e, { letter }) => {
  const L = String(letter || 'F').replace(':', '').toUpperCase().slice(0, 1);
  if (/^[A-Z]$/.test(L)) store.set('drive.letter', L);
  return { ok: true, letter: L };
});

ipcMain.handle('drive:mount', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  if (!isWinFspInstalled()) return { ok: false, error: 'WinFsp not installed' };

  const binPath = getDriveBinaryPath();
  if (!fs.existsSync(binPath)) return { ok: false, error: 'Drive binary not found' };

  if (trueDriveProc) return { ok: false, error: 'Already mounted' };

  let letter = store.get('drive.letter', 'F');
  if (!isDriveLetterAvailable(letter)) {
    letter = pickAvailableDriveLetter(letter);
    if (!letter) return { ok: false, error: 'No drive letter available' };
    store.set('drive.letter', letter);
  }

  // Get storage info for volume capacity
  const storageInfo = store.get('storageCache');
  const defaultTotal = 50n * 1024n * 1024n * 1024n;
  let totalBytes = defaultTotal;
  let freeBytes = defaultTotal;

  try {
    if (storageInfo && storageInfo.limit != null) {
      totalBytes = BigInt(Math.max(0, Number(storageInfo.limit)));
      const used = BigInt(Math.max(0, Number(storageInfo.usage || 0)));
      freeBytes = totalBytes > used ? totalBytes - used : 0n;
    }
  } catch (_) {}

  const args = [
    '-m', `${letter}:`,
    '--total-bytes', totalBytes.toString(),
    '--free-bytes', freeBytes.toString(),
    '--label', 'FileShot'
  ];

  // WinFsp DLL needs to be in PATH for the drive binary to load
  const winfspBin = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WinFsp', 'bin');
  const spawnEnv = { ...process.env };
  spawnEnv.PATH = `${winfspBin};${spawnEnv.PATH || ''}`;

  try {
    trueDriveProc = spawn(binPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv });
    trueDriveProc.stdout.on('data', d => console.log('[drive-bin stdout]', d.toString().trim()));
    trueDriveProc.stderr.on('data', d => console.error('[drive-bin stderr]', d.toString().trim()));
    trueDriveProc.on('exit', (code, signal) => {
      console.error(`[drive] fileshot-drive.exe exited: code=${code} signal=${signal}`);
      stopDriveSync();
      trueDriveProc = null;
      store.set('drive.enabled', false);
      rebuildTrayMenu();
      if (mainWindow) mainWindow.webContents.send('drive:status-changed');
    });

    store.set('drive.enabled', true);
    store.set('drive.letter', letter);
    rebuildTrayMenu();
    if (mainWindow) mainWindow.webContents.send('drive:status-changed');

    // After drive is ready: populate cloud files, then start watcher for auto-upload
    (async () => {
      const ready = await waitForDriveReady(letter);
      if (!ready || !trueDriveProc) return;
      driveSyncActive = true;  // enable before populate so it can check abort
      await populateDriveFromCloud(letter);
      if (!trueDriveProc) return;
      startDriveWatcher(letter);
    })();

    // Open the drive in Explorer after a short delay
    setTimeout(() => {
      try { shell.openPath(`${letter}:\\`); } catch (_) {}
    }, 2500);

    return { ok: true, letter };
  } catch (e) {
    trueDriveProc = null;
    return { ok: false, error: e?.message || 'Failed to start drive service' };
  }
});

ipcMain.handle('drive:unmount', async () => {
  stopDriveSync();
  if (trueDriveProc) {
    try { trueDriveProc.kill(); } catch (_) {}
    trueDriveProc = null;
  }
  store.set('drive.enabled', false);
  rebuildTrayMenu();
  if (mainWindow) mainWindow.webContents.send('drive:status-changed');
  return { ok: true };
});

ipcMain.handle('drive:install-winfsp', () => {
  shell.openExternal('https://github.com/winfsp/winfsp/releases/latest');
  return { ok: true };
});

// ─── Drive Sync: populate cloud files & auto-upload new ones ─────────────────
let driveWatcher = null;
const driveCloudFiles = new Set();        // lowercase paths we put there from cloud
const drivePendingUploads = new Map();    // path → debounce timer
let driveSyncActive = false;

async function waitForDriveReady(letter, maxMs = 8000) {
  const root = `${letter}:\\`;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return true; } catch (e) { /* waiting */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Zip a single file into a .zip archive (for auto-zipping blocked file types).
 * Returns the path to the temporary zip file.
 */
function zipFileSync(inputPath, originalName) {
  return new Promise((resolve, reject) => {
    ensureVaultDirs();
    const tmpZip = path.join(vaultTmpDir(), `${genId()}.zip`);
    const output = fs.createWriteStream(tmpZip);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve(tmpZip));
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(inputPath, { name: originalName });
    archive.finalize();
  });
}

/**
 * Download a file from FileShot API and save to a temp path.
 * Returns the temp file path, or null on failure.
 */
async function downloadToTemp(fileId) {
  ensureVaultDirs();
  const tmpPath = path.join(vaultTmpDir(), `${genId()}.download`);
  try {
    const response = await axios.get(`${API_BASE}/files/download/${fileId}`, {
      headers: getAuthHeaders(),
      responseType: 'stream',
      timeout: 600000
    });
    const writer = fs.createWriteStream(tmpPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    return { tmpPath, headers: response.headers };
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_x) {}
    throw e;
  }
}

/**
 * Populate the virtual drive with the user's REAL FileShot files + folders.
 * Downloads encrypted files, decrypts them with stored ZKE keys, and writes
 * the actual content to the drive. Files without a stored key are skipped
 * (they were uploaded from another device and the key isn't available locally).
 */
async function populateDriveFromCloud(letter) {
  const root = `${letter}:\\`;
  const token = store.get('authToken');
  if (!token) return;

  let populated = 0;
  let skipped = 0;
  let errored = 0;

  try {
    const [foldersRes, filesRes] = await Promise.all([
      apiGet('/folders/'),
      apiGet('/files/my-files')
    ]);

    const folders = foldersRes?.folders || [];
    const files   = filesRes?.files || filesRes || [];

    // Create folder structure on the drive
    const folderMap = {};
    for (const f of folders) {
      folderMap[f.folderId] = f.name;
      const dirPath = path.join(root, f.name);
      try { fs.mkdirSync(dirPath, { recursive: true }); } catch (e) {
        console.error(`[drive] Failed to create dir ${dirPath}:`, e.message);
      }
      driveCloudFiles.add(dirPath.toLowerCase());
    }

    // Download, decrypt, and write each file
    for (const f of files) {
      if (!driveSyncActive || !trueDriveProc) break; // drive was unmounted

      const folderName = f.folderId ? (folderMap[f.folderId] || '') : '';
      const fileId = f.fileId || f.file_id;
      const displayName = f.fileName || f.originalName || `file_${fileId}`;
      const isZKE = f.isZeroKnowledge || f.is_zero_knowledge;
      const keyEntry = getKeyFromKeyring(fileId);

      // Determine the actual filename to show on the drive
      let driveName = displayName;
      if (keyEntry && keyEntry.wasZipped && driveName.endsWith('.zip')) {
        // Strip the .zip we added during auto-zip
        driveName = driveName.slice(0, -4);
      }
      if (keyEntry && keyEntry.originalName) {
        driveName = keyEntry.originalName;
      }

      const driveFilePath = path.join(root, folderName, driveName);

      // If it's ZKE and we don't have the key, we can't decrypt — skip it
      if (isZKE && !keyEntry) {
        skipped++;
        continue;
      }

      try {
        // Download the file from the server
        const { tmpPath, headers } = await downloadToTemp(fileId);
        const tmpFiles = [tmpPath]; // track temp files for cleanup

        try {
          let contentPath = tmpPath;

          // If ZKE-encrypted, decrypt it
          if (isZKE && keyEntry) {
            const decryptedPath = path.join(vaultTmpDir(), `${genId()}.dec`);
            tmpFiles.push(decryptedPath);
            await decryptZkeContainer({
              inputPath: tmpPath,
              outputPath: decryptedPath,
              rawKeyBase64Url: keyEntry.rawKey
            });
            contentPath = decryptedPath;
          }

          // If the file was auto-zipped on upload, extract the original
          if (keyEntry && keyEntry.wasZipped) {
            const extractDir = path.join(vaultTmpDir(), genId());
            tmpFiles.push(extractDir);
            const extractZip = require('extract-zip');
            await extractZip(contentPath, { dir: extractDir });
            // Find the extracted file (there should be exactly one)
            const extracted = fs.readdirSync(extractDir);
            if (extracted.length > 0) {
              contentPath = path.join(extractDir, extracted[0]);
            }
          }

          // Write the real content to the virtual drive
          const content = fs.readFileSync(contentPath);
          fs.writeFileSync(driveFilePath, content);
          driveCloudFiles.add(driveFilePath.toLowerCase());
          populated++;
        } finally {
          // Clean up all temp files
          for (const tmp of tmpFiles) {
            try {
              const s = fs.statSync(tmp);
              if (s.isDirectory()) fs.rmSync(tmp, { recursive: true, force: true });
              else fs.unlinkSync(tmp);
            } catch (_x) {}
          }
        }
      } catch (e) {
        console.error(`[drive] Failed to populate ${driveName}:`, e.message);
        errored++;
      }
    }

    // Notify renderer with real counts
    if (mainWindow) {
      mainWindow.webContents.send('drive:populated', {
        folders: folders.length,
        files: populated,
        skipped,
        errored
      });
    }
  } catch (e) {
    console.error('[drive] populateDriveFromCloud failed:', e.message);
    if (mainWindow) {
      mainWindow.webContents.send('drive:upload-error', {
        fileName: '(populate)',
        error: `Failed to load cloud files: ${e.message}`
      });
    }
  }
}

/**
 * Watch the virtual drive for new files and auto-upload them to FileShot.
 */
function startDriveWatcher(letter) {
  const root = `${letter}:\\`;
  driveSyncActive = true;

  try {
    console.log(`[drive] Starting watcher on ${root}`);
    driveWatcher = fs.watch(root, { recursive: true }, (evType, filename) => {
      console.log(`[drive] fs.watch event: ${evType} ${filename}`);
      if (!filename || !driveSyncActive) return;
      const fullPath = path.join(root, filename);

      // Ignore directories and our own cloud-populated files
      try {
        const st = fs.statSync(fullPath);
        if (!st.isFile()) return;
        if (st.size === 0) return;  // Ignore empty files
      } catch (e) { return; }

      if (driveCloudFiles.has(fullPath.toLowerCase())) return;

      // Debounce: wait 2s after the last write event before uploading
      if (drivePendingUploads.has(fullPath)) {
        clearTimeout(drivePendingUploads.get(fullPath));
      }
      drivePendingUploads.set(fullPath, setTimeout(() => {
        drivePendingUploads.delete(fullPath);
        driveAutoUpload(fullPath, letter).catch(e => {
          console.error('[drive] Auto-upload failed:', e.message);
        });
      }, 2000));
    });
    driveWatcher.on('error', (err) => {
      console.error('[drive] Watcher error:', err.message);
    });
    console.log('[drive] Watcher started successfully');
  } catch (e) {
    console.error('[drive] Failed to start watcher:', e.message);
  }
}

/**
 * Auto-upload a file from the virtual drive to FileShot cloud.
 * Uses ZKE encryption (same as normal uploads).
 * Auto-zips files with blocked extensions so the server accepts them.
 */
async function driveAutoUpload(filePath, driveLetter) {
  const token = store.get('authToken');
  if (!token) {
    if (mainWindow) mainWindow.webContents.send('drive:upload-error', {
      fileName: path.basename(filePath), error: 'Not logged in'
    });
    return;
  }

  const fileName = path.basename(filePath);
  const st = safeStat(filePath);
  if (!st || !st.isFile() || st.size === 0) return;

  const tmpFiles = []; // track all temp files for cleanup

  try {
    // Notify UI that upload is starting
    if (mainWindow) {
      mainWindow.webContents.send('drive:upload-started', { fileName });
    }

    // ── Resolve folder ──────────────────────────────────────────────────────
    const root = `${driveLetter}:\\`;
    const rel = path.relative(root, filePath);
    const dirPart = path.dirname(rel);
    let folderId = null;

    if (dirPart && dirPart !== '.') {
      const topFolderName = dirPart.split(path.sep)[0];
      const fData = await apiGet('/folders/');
      const folders = fData?.folders || [];
      const match = folders.find(f => f.name.toLowerCase() === topFolderName.toLowerCase());
      if (match) {
        folderId = match.folderId;
      } else {
        const created = await apiPost('/folders/', { name: topFolderName });
        folderId = created?.folderId || created?.folder?.folderId;
      }
    }

    // ── Auto-zip blocked file types ─────────────────────────────────────────
    let uploadSourcePath = filePath;
    let uploadFileName = fileName;
    let wasZipped = false;
    const originalFileSize = st.size;

    if (hasBlockedExtension(fileName)) {
      // Zip the file so the server accepts it
      const zipPath = await zipFileSync(filePath, fileName);
      tmpFiles.push(zipPath);
      uploadSourcePath = zipPath;
      uploadFileName = fileName + '.zip';
      wasZipped = true;
      console.log(`[drive] Auto-zipped blocked file: ${fileName} → ${uploadFileName}`);
    }

    // ── ZKE encrypt locally (same as normal upload path) ────────────────────
    ensureVaultDirs();
    const tmpId = genId();
    const tmpOut = path.join(vaultTmpDir(), `${tmpId}.fszk`);
    tmpFiles.push(tmpOut);

    const enc = await encryptFileToZkeContainer({
      inputPath: uploadSourcePath,
      outputPath: tmpOut,
      originalName: uploadFileName,
      originalMimeType: 'application/octet-stream',
      mode: 'raw',
      chunkSize: 512 * 1024
    });

    const encryptedSize = fs.statSync(tmpOut).size;

    // ── Pre-upload (ZKE mode) ───────────────────────────────────────────────
    const preData = await apiPost('/files/pre-upload', {
      fileName: uploadFileName,
      fileSize: originalFileSize,
      isZeroKnowledge: 'true',
      originalFileName: uploadFileName,
      originalFileSize: originalFileSize,
      originalMimeType: 'application/octet-stream'
    }, { csrf: false });

    const fileId = preData?.fileId;
    if (!fileId) throw new Error('Pre-upload failed — no fileId returned');

    // ── Chunked upload of encrypted blob ────────────────────────────────────
    const CHUNK = 8 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(encryptedSize / CHUNK));
    const fd = fs.openSync(tmpOut, 'r');
    try {
      for (let ci = 0; ci < totalChunks; ci++) {
        const start = ci * CHUNK;
        const end = Math.min(start + CHUNK, encryptedSize);
        const len = end - start;
        const buf = Buffer.allocUnsafe(len);
        fs.readSync(fd, buf, 0, len, start);

        const form = new FormData();
        form.append('chunk', buf, { filename: `chunk-${ci}` });
        form.append('totalChunks', String(totalChunks));
        form.append('isLastChunk', String(ci === totalChunks - 1));

        await axios.post(`${API_BASE}/files/upload-chunk/${fileId}/${ci}`, form, {
          headers: { ...form.getHeaders(), ...getAuthHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 600000
        });
      }
    } finally {
      try { fs.closeSync(fd); } catch (_x) {}
    }

    // ── Finalize ────────────────────────────────────────────────────────────
    await apiPost(`/files/finalize-upload/${fileId}`, {}, { csrf: false });

    // Move into folder if needed
    if (folderId) {
      await apiPost('/files/move', { fileIds: [fileId], folderId });
    }

    // ── Store key in local keyring for future drive access ──────────────────
    if (enc.rawKey) {
      saveKeyToKeyring(fileId, enc.rawKey, fileName, wasZipped);
    }

    // Remember so we don't re-upload
    driveCloudFiles.add(filePath.toLowerCase());

    const shareUrl = `${FRONTEND_URL}/downloads.html?f=${encodeURIComponent(fileId)}${enc.rawKey ? `#k=${encodeURIComponent(enc.rawKey)}` : ''}`;
    pushRecentUpload(fileName, shareUrl);

    if (mainWindow) {
      mainWindow.webContents.send('drive:file-uploaded', { fileName, fileId, shareUrl });
    }
  } catch (e) {
    console.error(`[drive] Upload failed for ${fileName}:`, e.message);
    if (mainWindow) {
      mainWindow.webContents.send('drive:upload-error', {
        fileName,
        error: e?.response?.data?.error || e?.message || 'Upload failed'
      });
    }
  } finally {
    // Clean up ALL temp files
    for (const tmp of tmpFiles) {
      try { fs.unlinkSync(tmp); } catch (_x) {}
    }
  }
}

function stopDriveSync() {
  driveSyncActive = false;
  if (driveWatcher) {
    try { driveWatcher.close(); } catch (_x) {}
    driveWatcher = null;
  }
  for (const t of drivePendingUploads.values()) clearTimeout(t);
  drivePendingUploads.clear();
  driveCloudFiles.clear();
}

// ─── IPC: Dialogs ────────────────────────────────────────────────────────────
ipcMain.handle('dialog:open-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files'
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Folder'
  });
  return result.canceled ? null : (result.filePaths[0] || null);
});

// ─── IPC: Utilities ──────────────────────────────────────────────────────────
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

ipcMain.handle('shell:open', (_e, url) => {
  shell.openExternal(String(url || ''));
  return { ok: true };
});

ipcMain.handle('app:version', () => app.getVersion());

// ─── IPC: Settings ───────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => {
  return store.get('settings', {
    minimizeToTray: false,
    startOnLogin: false,
    downloadPath: app.getPath('downloads'),
    defaultEncryption: 'zke',
    notifications: true,
    theme: 'dark'
  });
});

ipcMain.handle('settings:set', (_e, settings) => {
  store.set('settings', settings);

  // Apply start-on-login
  if (typeof settings.startOnLogin === 'boolean') {
    app.setLoginItemSettings({
      openAtLogin: settings.startOnLogin,
      path: process.execPath
    });
  }

  return { ok: true };
});

// ─── IPC: Explorer (local filesystem) ────────────────────────────────────────
ipcMain.handle('fs:list-drives', async () => {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execPromise('wmic logicaldisk get caption,size,freespace,drivetype /format:csv', { timeout: 10000 });
    const drives = [];
    const lines = stdout.split('\n').filter(l => l.trim());
    for (const line of lines.slice(1)) {
      const parts = line.split(',');
      if (parts.length < 5) continue;
      const caption = (parts[1] || '').trim();
      const driveType = parseInt(parts[2], 10);
      const freeSpace = parseInt(parts[3], 10) || 0;
      const size = parseInt(parts[4], 10) || 0;
      if (!caption) continue;
      drives.push({ letter: caption, type: driveType, freeSpace, size });
    }
    return drives;
  } catch (_) {
    // Fallback: check common letters
    const drives = [];
    for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (fs.existsSync(`${L}:\\`)) {
        drives.push({ letter: `${L}:`, type: 3, freeSpace: 0, size: 0 });
      }
    }
    return drives;
  }
});

ipcMain.handle('fs:list-dir', async (_e, dirPath) => {
  try {
    const ents = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const e of ents) {
      try {
        const full = path.join(dirPath, e.name);
        const st = await fs.promises.stat(full).catch(() => null);
        items.push({
          name: e.name,
          path: full,
          isDir: e.isDirectory(),
          size: st ? st.size : 0,
          modified: st ? st.mtimeMs : 0
        });
      } catch (_) {}
    }
    return items;
  } catch (e) {
    return [];
  }
});

// ─── Auto-Updater ────────────────────────────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update:available', info);
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) mainWindow.webContents.send('update:downloaded', info);
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    createWindow();
    setupWindowEvents();
    createTray();

    // Check for updates after 5s
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 5000);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (!store.get('settings.minimizeToTray', false)) {
        app.quit();
      }
    }
  });

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    // Unmount drive on quit
    stopDriveSync();
    if (trueDriveProc) {
      try { trueDriveProc.kill(); } catch (_) {}
      trueDriveProc = null;
    }
  });
}
