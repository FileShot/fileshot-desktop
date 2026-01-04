const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');

const { encryptFileToZkeContainer } = require('./utils/zke-stream');

// Initialize electron-store for settings
const store = new Store();

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let uploadQueue = [];

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

function addFileToVault(sourcePath) {
  ensureVaultDirs();
  const st = safeStat(sourcePath);
  if (!st || !st.isFile()) return null;

  const id = genId();
  const name = path.basename(sourcePath);
  const ext = path.extname(name);
  const storedName = `${id}${ext || ''}`;
  const destPath = path.join(getVaultFilesDir(), storedName);

  fs.copyFileSync(sourcePath, destPath);

  return {
    id,
    name,
    size: st.size,
    addedAt: Date.now(),
    localPath: destPath,
    sourcePath
  };
}

function vaultTotalBytes(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.size || 0), 0);
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
      webSecurity: true
    },
    show: false, // Don't show until ready
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default',
    autoHideMenuBar: true
  });

  // v1.2+: Local-first UI is the default.
  // "Go Online" explicitly loads the hosted web app.
  try {
    mainWindow.loadFile(LOCAL_UI_INDEX);
  } catch (e) {
    console.error('[FileShot] Failed to load local UI, falling back:', e);
    loadFrontend({ preferredPath: '/', reason: 'startup-fallback' }).catch(() => {});
  }

  if (isDev) {
    console.log('[FileShot] Development mode enabled');
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show notification
      // NOTE: tray.displayBalloon is Windows-only.
      if (tray && process.platform === 'win32' && typeof tray.displayBalloon === 'function') {
        tray.displayBalloon({
          title: 'FileShot',
          content: 'FileShot is still running in the background. Click the tray icon to open.',
          icon: path.join(__dirname, 'assets', 'icon.png')
        });
      }
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // For safety, never allow new windows inside Electron.
    // If it's a FileShot page, open it in the same window instead of the system browser.
    try {
      const u = new URL(url);
      const isFileShot = u.hostname === 'fileshot.io' || u.hostname === 'www.fileshot.io';
      if (isFileShot && mainWindow) {
        loadFrontend({ preferredPath: u.pathname + u.search + u.hash, reason: 'same-window navigation' }).catch(() => {});
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

/**
 * Create system tray icon
 */
function buildTrayMenuTemplate() {
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

ipcMain.handle('copy-to-clipboard', async (_event, text) => {
  clipboard.writeText(String(text || ''));
  return { success: true };
});

ipcMain.handle('go-online', async () => {
  if (!mainWindow) return { success: false };
  await loadFrontend({ preferredPath: '/', reason: 'renderer:go-online' });
  mainWindow.show();
  mainWindow.focus();
  return { success: true };
});

ipcMain.handle('vault-list', async () => {
  const items = getVaultItems();
  return { items, totalBytes: vaultTotalBytes(items) };
});

ipcMain.handle('vault-add', async (_event, paths) => {
  const list = Array.isArray(paths) ? paths : [];
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
      console.warn('[Vault] Failed to add file:', p, e && e.message ? e.message : e);
    }
  }

  setVaultItems(items);
  return { success: true, added };
});

ipcMain.handle('vault-add-folder', async (_event, folderPath) => {
  const folder = String(folderPath || '');
  const st = safeStat(folder);
  if (!st || !st.isDirectory()) return { success: false, error: 'Folder not found' };

  const files = getAllFilesInFolder(folder);
  const items = getVaultItems();
  let added = 0;

  for (const p of files) {
    try {
      const entry = addFileToVault(p);
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

ipcMain.handle('vault-reveal-key', async (_event, localId) => {
  const id = String(localId || '');
  const items = getVaultItems();
  const it = items.find((x) => String(x.id) === id);
  if (!it) return { success: false };
  // Only reveal a stored share key (raw-key mode). Passphrase mode has no share key.
  return { success: true, shareKey: it?.lastUpload?.shareKey || null, shareUrl: it?.lastUpload?.shareUrl || null };
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
  app.isQuitting = true;
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', `An error occurred: ${error.message}`);
});
