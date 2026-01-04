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
  vaultAdd: (paths) => ipcRenderer.invoke('vault-add', paths),
  vaultAddFolder: (folderPath) => ipcRenderer.invoke('vault-add-folder', folderPath),
  vaultRemove: (localId) => ipcRenderer.invoke('vault-remove', localId),
  vaultRevealKey: (localId) => ipcRenderer.invoke('vault-reveal-key', localId),

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
    ipcRenderer.on('navigate-to', (event, route) => callback(route));
  },
  
  // Upload events
  onStartUpload: (callback) => {
    ipcRenderer.on('start-upload', (event, filePaths) => callback(filePaths));
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
