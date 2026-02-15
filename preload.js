/**
 * FileShot Desktop V2 — Preload Script
 * Exposes safe IPC APIs to the renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileshot', {
  // ── Window Controls ──
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizedChange: (cb) => {
      ipcRenderer.on('win:maximized', (_e, val) => cb(val));
    }
  },

  // ── Auth ──
  auth: {
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    register: (email, password) => ipcRenderer.invoke('auth:register', { email, password }),
    logout: () => ipcRenderer.invoke('auth:logout'),
    me: () => ipcRenderer.invoke('auth:me'),
    check: () => ipcRenderer.invoke('auth:check'),
    oauth: (provider) => ipcRenderer.invoke('auth:oauth', { provider })
  },

  // ── Storage ──
  storage: {
    usage: () => ipcRenderer.invoke('storage:usage')
  },

  // ── Files ──
  files: {
    list: () => ipcRenderer.invoke('files:list'),
    delete: (fileId) => ipcRenderer.invoke('files:delete', { fileId }),
    info: (fileId) => ipcRenderer.invoke('files:info', { fileId }),
    update: (fileId, settings) => ipcRenderer.invoke('files:update', { fileId, settings }),
    download: (fileId, fileName) => ipcRenderer.invoke('files:download', { fileId, fileName }),
    qr: (fileId) => ipcRenderer.invoke('files:qr', { fileId }),
    move: (fileIds, folderId) => ipcRenderer.invoke('files:move', { fileIds, folderId }),
    getKey: (fileId) => ipcRenderer.invoke('files:get-key', { fileId }),
    preview: (fileId) => ipcRenderer.invoke('files:preview', { fileId })
  },

  // ── Folders ──
  folders: {
    list: () => ipcRenderer.invoke('folders:list'),
    create: (name) => ipcRenderer.invoke('folders:create', { name }),
    delete: (folderId) => ipcRenderer.invoke('folders:delete', { folderId })
  },

  // ── Upload ──
  upload: {
    files: (filePaths, options) => ipcRenderer.invoke('upload:files', { filePaths, options: options || {} }),
    onProgress: (cb) => {
      ipcRenderer.on('upload:progress', (_e, data) => cb(data));
    },
    onTrigger: (cb) => {
      ipcRenderer.on('trigger-upload', (_e, paths) => cb(paths));
    }
  },

  // ── Local Vault ──
  vault: {
    list: () => ipcRenderer.invoke('vault:list'),
    add: (filePaths, passphrase) => ipcRenderer.invoke('vault:add', { filePaths, passphrase }),
    remove: (id) => ipcRenderer.invoke('vault:remove', { id }),
    open: (id, passphrase) => ipcRenderer.invoke('vault:open', { id, passphrase }),
    export: (id, passphrase) => ipcRenderer.invoke('vault:export', { id, passphrase }),
    upload: (id, passphrase) => ipcRenderer.invoke('vault:upload', { id, passphrase }),
    onUpdated: (cb) => {
      ipcRenderer.on('vault:updated', () => cb());
    }
  },

  // ── Shredder ──
  shred: {
    start: (paths, method, targets) => ipcRenderer.invoke('shred:start', { paths, method, targets }),
    onProgress: (cb) => {
      ipcRenderer.on('shred:progress', (_e, data) => cb(data));
    }
  },

  // ── Virtual Drive ──
  drive: {
    status: () => ipcRenderer.invoke('drive:status'),
    setLetter: (letter) => ipcRenderer.invoke('drive:set-letter', { letter }),
    mount: () => ipcRenderer.invoke('drive:mount'),
    unmount: () => ipcRenderer.invoke('drive:unmount'),
    installWinFsp: () => ipcRenderer.invoke('drive:install-winfsp'),
    onStatusChanged: (cb) => {
      ipcRenderer.on('drive:status-changed', () => cb());
    },
    onFileUploaded: (cb) => {
      ipcRenderer.on('drive:file-uploaded', (_e, data) => cb(data));
    },
    onUploadStarted: (cb) => {
      ipcRenderer.on('drive:upload-started', (_e, data) => cb(data));
    },
    onUploadError: (cb) => {
      ipcRenderer.on('drive:upload-error', (_e, data) => cb(data));
    },
    onPopulated: (cb) => {
      ipcRenderer.on('drive:populated', (_e, data) => cb(data));
    }
  },

  // ── Dialogs ──
  dialog: {
    openFiles: () => ipcRenderer.invoke('dialog:open-files'),
    openFolder: () => ipcRenderer.invoke('dialog:open-folder')
  },

  // ── Utilities ──
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text)
  },
  shell: {
    open: (url) => ipcRenderer.invoke('shell:open', url)
  },

  // ── Settings ──
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings) => ipcRenderer.invoke('settings:set', settings)
  },

  // ── Local Filesystem (Explorer) ──
  fs: {
    listDrives: () => ipcRenderer.invoke('fs:list-drives'),
    listDir: (dirPath) => ipcRenderer.invoke('fs:list-dir', dirPath)
  },

  // ── App Info ──
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    platform: process.platform
  },

  // ── Updates ──
  updates: {
    onAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
    onDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info))
  }
});
