const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script - Exposes safe APIs to renderer process
 * This runs in an isolated context with access to Node.js APIs
 */

contextBridge.exposeInMainWorld('electronAPI', {
  // API configuration
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),
  onApiConfig: (callback) => {
    ipcRenderer.on('api-config', (_event, config) => {
      try { callback(config); } catch (_) {}
    });
  },
  
  // Authentication
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
  clearAuthToken: () => ipcRenderer.invoke('clear-auth-token'),
  
  // File operations
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),

  // Local file explorer (read-only listings)
  fsListDrives: () => ipcRenderer.invoke('fs-list-drives'),
  fsListDir: (dirPath) => ipcRenderer.invoke('fs-list-dir', dirPath),

  // Local vault
  vaultList: () => ipcRenderer.invoke('vault-list'),
  vaultAdd: (paths, passphrase) => ipcRenderer.invoke('vault-add', { paths, passphrase }),
  vaultAddFolder: (folderPath, passphrase) => ipcRenderer.invoke('vault-add-folder', { folderPath, passphrase }),
  vaultRemove: (localId) => ipcRenderer.invoke('vault-remove', localId),
  vaultOpen: (localId, passphrase) => ipcRenderer.invoke('vault-open', { localId, passphrase }),
  vaultExportFile: (localId, passphrase) => ipcRenderer.invoke('vault-export-file', { localId, passphrase }),
  vaultExportAll: () => ipcRenderer.invoke('vault-export-all'),
  vaultImport: () => ipcRenderer.invoke('vault-import'),

  // ZKE upload
  uploadZke: (localId, options, progressCb) => {
    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (typeof progressCb === 'function') {
      ipcRenderer.on(`upload-progress:${requestId}`, (_event, payload) => {
        try { progressCb(payload); } catch (_) {}
      });
    }
    return ipcRenderer.invoke('upload-zke', { localId, options, requestId });
  },

  // Vault update notifications
  onVaultUpdated: (callback) => {
    ipcRenderer.on('vault-updated', (_event, payload) => {
      try { callback(payload); } catch (_) {}
    });
  },

  // App controls
  goOnline: () => ipcRenderer.invoke('go-online'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', String(text || '')),
  openExternal: (url) => ipcRenderer.invoke('open-external', String(url || '')),

  // Initiate an OS drag operation for one or more file paths.
  // Useful for dragging from the sidebar Explorer into the embedded webview or other apps.
  startDrag: (paths) => ipcRenderer.send('start-drag', Array.isArray(paths) ? paths : [paths]),

  // Secure shred (local destructive operation)
  shredStart: (payload, progressCb) => {
    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (typeof progressCb === 'function') {
      ipcRenderer.on(`shred-progress:${requestId}`, (_event, msg) => {
        try { progressCb(msg); } catch (_) {}
      });
    }
    return ipcRenderer.invoke('shred-start', { ...(payload || {}), requestId });
  },
  
  // Recent uploads
  addRecentUpload: (upload) => ipcRenderer.invoke('add-recent-upload', upload),
  
  // Navigation
  onNavigateTo: (callback) => {
    ipcRenderer.on('navigate-to', (_event, route) => {
      try { callback(route); } catch (_) {}
    });
  },
  
  // Upload events
  onStartUpload: (callback) => {
    ipcRenderer.on('start-upload', (event, filePaths) => callback(filePaths));
  },
  
  // Upload files to online (triggers drop zone in webview)
  uploadFilesToOnline: (paths) => ipcRenderer.invoke('upload-files-to-online', paths),
  
  // Receive trigger to upload files in the online webview
  onTriggerOnlineUpload: (callback) => {
    ipcRenderer.on('trigger-online-upload', (_event, paths) => {
      try { callback(paths); } catch (_) {}
    });
  },
  
  // Platform info
  platform: process.platform,
  isDesktop: true
});

// Inject minimal desktop-specific UI (keep non-intrusive; do NOT break the site)
window.addEventListener('DOMContentLoaded', () => {
  // Add a subtle desktop indicator (no emoji; no pointer interception)
  const indicator = document.createElement('div');
  indicator.id = 'desktop-indicator';
  indicator.textContent = 'Desktop App';
  indicator.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    z-index: 10000;
    pointer-events: none;
    opacity: 0.55;
  `;
  document.body.appendChild(indicator);
});
