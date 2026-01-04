/**
 * FileShot Desktop App - Hybrid UI
 * Local sidebar + file explorer connected to live API
 */

// ============================================================================
// API CONFIGURATION
// ============================================================================

let API_URL = 'https://api.fileshot.io/api'; // Default to live API

// Receive API config from main process
if (window.electronAPI) {
  window.electronAPI.onApiConfig?.((config) => {
    API_URL = config.apiUrl;
    console.log('[FileShot Desktop] API configured:', API_URL);
  });
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  currentTool: 'vault',
  sidebarCollapsed: false,
  vaultFiles: [],
  storageUsage: { used: 0, total: 0 },
  shredProgress: { current: 0, total: 0, isRunning: false },
  shredCustomPaths: [],
  explorer: {
    currentPath: null,
    mode: 'drives' // 'drives' | 'dir'
  },
  settings: {
    autoLock: false,
    requirePin: false
  },
  authToken: localStorage.getItem('fileshot_token') || null,
  userId: localStorage.getItem('fileshot_userId') || null
};

// ============================================================================
// DOM QUERIES & CACHE
// ============================================================================

const DOM = {
  // Sidebar
  sidebar: () => document.getElementById('sidebar'),
  btnCollapse: () => document.getElementById('btnCollapse'),
  navItems: () => document.querySelectorAll('.nav-item'),
  goOnlineBtn: () => document.getElementById('btnGoOnline'),
  
  // Main content
  topbarLeft: () => document.querySelector('.topbar-left'),
  toolsContainer: () => document.querySelector('.tools-container'),
  dropZone: () => document.getElementById('dropZone'),
  dropZoneText: () => document.querySelector('.drop-zone-text'),
  storageStatus: () => document.getElementById('storageStatus'),
  
  // Tool panels
  toolPanel: (toolName) => document.getElementById(`tool-${toolName}`),
  
  // Specific tools
  vaultAddBtn: () => document.getElementById('btnAddFiles'),
  vaultAddFolderBtn: () => document.getElementById('btnAddFolder'),
  vaultList: () => document.getElementById('vaultList'),
  vaultStatus: () => document.getElementById('vaultStatus'),
  // Legacy upload UI (not currently present in local index.html)
  vaultUploadBtn: () => null,
  vaultUploadPassword: () => null,
  vaultUploadProtect: () => null,
  
  storageUsedValue: () => document.getElementById('storageUsed'),
  storageFreeValue: () => document.getElementById('storageFree'),
  clearVaultBtn: () => document.getElementById('btnClearVault'),
  exportVaultBtn: () => document.getElementById('btnExportVault'),
  fileListContainer: () => document.getElementById('storageFileList'),
  
  shredMethod: () => document.querySelector('input[name="shredMethod"]:checked'),
  shredStartBtn: () => document.getElementById('btnStartShred'),
  shredAddFilesBtn: () => document.getElementById('btnShredAddFiles'),
  shredAddFolderBtn: () => document.getElementById('btnShredAddFolder'),
  shredPathList: () => document.getElementById('shredPathList'),
  shredDownloads: () => document.getElementById('shredDownloads'),
  shredTemp: () => document.getElementById('shredTemp'),
  shredRecycleBin: () => document.getElementById('shredRecycleBin'),
  shredBrowserCache: () => document.getElementById('shredBrowserCache'),
  shredProgressSection: () => document.getElementById('shredProgress'),
  shredProgressFill: () => document.getElementById('shredProgressFill'),
  shredStatus: () => document.getElementById('shredProgressText'),

  // Sidebar explorer
  explorerPath: () => document.getElementById('explorerPath'),
  explorerList: () => document.getElementById('explorerList'),
  explorerUpBtn: () => document.getElementById('btnExplorerUp'),
  explorerRefreshBtn: () => document.getElementById('btnExplorerRefresh'),
  
  settingsAutoLock: () => document.getElementById('autoLock'),
  settingsPin: () => document.getElementById('requirePin'),
  settingsPinValue: () => null
};

function fmtBytes(n) {
  const num = Number(n || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  let v = num;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initGoOnline();
  initDropZone();
  initToolPanels();
  initVaultTool();
  initStorageTool();
  initShredTool();
  initSettingsTool();
  initExplorer();
  initVaultSync();
  loadSettings();
  refreshVault();
  switchToTool('vault');
});

// ============================================================================
// MAIN-PROCESS VAULT SYNC
// ============================================================================

function initVaultSync() {
  if (!window.electronAPI) return;

  window.electronAPI.onVaultUpdated?.(() => {
    refreshVault();
  });
}

async function refreshVault() {
  if (!window.electronAPI || typeof window.electronAPI.vaultList !== 'function') {
    // Fallback: just render current in-memory list
    renderVaultList();
    calculateStorageUsage();
    return;
  }

  try {
    const res = await window.electronAPI.vaultList();
    state.vaultFiles = Array.isArray(res?.items) ? res.items : [];
    state.storageUsage.used = Number(res?.totalBytes || 0);
    renderVaultList();
    calculateStorageUsage();
  } catch (e) {
    console.warn('[Vault] Failed to refresh:', e);
    renderVaultList();
    calculateStorageUsage();
  }
}

// ============================================================================
// SIDEBAR NAVIGATION
// ============================================================================

function initSidebar() {
  const collapseBtn = DOM.btnCollapse();
  if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebar);

  // Hide unfinished tools to avoid placeholders
  ['pdf', 'image', 'text'].forEach(tool => {
    const nav = document.querySelector(`.nav-item[data-tool="${tool}"]`);
    const panel = DOM.toolPanel(tool);
    if (nav) nav.style.display = 'none';
    if (panel) panel.hidden = true;
  });
  
  DOM.navItems().forEach(item => {
    item.addEventListener('click', (e) => {
      const tool = e.currentTarget.dataset.tool;
      switchToTool(tool);
    });
  });
}

function initGoOnline() {
  const btn = DOM.goOnlineBtn();
  if (!btn || !window.electronAPI || typeof window.electronAPI.goOnline !== 'function') return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await window.electronAPI.goOnline();
    } finally {
      btn.disabled = false;
    }
  });
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  const sidebar = DOM.sidebar();
  if (sidebar) sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
}

function switchToTool(toolName) {
  // Update state
  state.currentTool = toolName;
  
  // Update nav items
  DOM.navItems().forEach(item => {
    item.classList.toggle('active', item.dataset.tool === toolName);
  });
  
  // Hide all panels
  document.querySelectorAll('.tool-panel').forEach(panel => {
    panel.hidden = true;
  });
  
  // Show selected panel - ID is tool-{name}
  const panel = document.getElementById(`tool-${toolName}`);
  if (panel) {
    panel.hidden = false;
  }
  
  // Update topbar title with icons
  const titles = {
    vault: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Local Vault',
    pdf: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> PDF Tools',
    image: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Image Tools',
    text: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> Text Tools',
    storage: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/></svg> Storage Management',
    shred: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Secure File Shredding',
    settings: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M4.2 4.2l4.2 4.2m5.6 5.6l4.2 4.2M1 12h6m6 0h6M4.2 19.8l4.2-4.2m5.6-5.6l4.2-4.2"/></svg> Settings'
  };
  
  const topbar = DOM.topbarLeft();
  if (topbar) topbar.innerHTML = `<h1>${titles[toolName]}</h1>`;
}

// ============================================================================
// DRAG & DROP
// ============================================================================

let dragCounter = 0;

function initDropZone() {
  const dropZone = DOM.dropZone();

  if (!dropZone) return;
  
  // Ensure drop zone is hidden on init
  dropZone.hidden = true;
  dragCounter = 0;
  
  // Listen on document level for drag events
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      dropZone.hidden = false;
    }
  });
  
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dropZone.hidden = true;
    }
  });
  
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  
  // Handle file drop
  document.addEventListener('drop', handleFileDrop);
}

function handleFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  // Reset drag counter and hide drop zone
  dragCounter = 0;
  const dz = DOM.dropZone();
  if (dz) dz.hidden = true;
  
  // 1) OS-level drop (File objects)
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const paths = Array.from(files)
      .map(f => f && (f.path || f.name))
      .filter(Boolean);
    if (paths.length) {
      switchToTool('vault');
      addPathsToVault(paths);
    }
    return;
  }

  // 2) In-app drag from sidebar explorer
  const kind = e.dataTransfer?.getData('application/x-fileshot-kind');
  const p = e.dataTransfer?.getData('application/x-fileshot-path') || e.dataTransfer?.getData('text/plain');
  if (!p) return;

  switchToTool('vault');
  if (kind === 'dir') {
    addFolderToVault(p);
  } else {
    addPathsToVault([p]);
  }
}

// ============================================================================
// VAULT TOOL
// ============================================================================

function initVaultTool() {
  const addBtn = DOM.vaultAddBtn();
  const addFolderBtn = DOM.vaultAddFolderBtn();
  if (addBtn) addBtn.addEventListener('click', pickFiles);
  if (addFolderBtn) addFolderBtn.addEventListener('click', pickFolder);
}

function pickFiles() {
  // In Electron, trigger file picker through main process
  if (!window.electronAPI || typeof window.electronAPI.selectFile !== 'function') return;
  window.electronAPI.selectFile().then(filePaths => {
    const paths = Array.isArray(filePaths) ? filePaths : [];
    if (paths.length) addPathsToVault(paths);
  });
}

function pickFolder() {
  if (!window.electronAPI || typeof window.electronAPI.selectFolder !== 'function') return;
  window.electronAPI.selectFolder().then(folderPaths => {
    const folderPath = Array.isArray(folderPaths) ? folderPaths[0] : null;
    if (folderPath) addFolderToVault(folderPath);
  });
}

async function addPathsToVault(paths) {
  if (!window.electronAPI || typeof window.electronAPI.vaultAdd !== 'function') {
    // Fallback: keep renderer-only list (best-effort)
    (paths || []).forEach((p) => {
      state.vaultFiles.push({
        id: Math.random().toString(36).slice(2),
        name: String(p).split(/[/\\]/).pop(),
        size: 0,
        addedAt: Date.now(),
        localPath: String(p),
        sourcePath: String(p)
      });
    });
    renderVaultList();
    calculateStorageUsage();
    return;
  }

  try {
    await window.electronAPI.vaultAdd(paths);
  } finally {
    refreshVault();
  }
}

async function addFolderToVault(folderPath) {
  if (!window.electronAPI || typeof window.electronAPI.vaultAddFolder !== 'function') return;
  try {
    await window.electronAPI.vaultAddFolder(folderPath);
  } finally {
    refreshVault();
  }
}

function renderVaultList() {
  const vaultList = DOM.vaultList();

  if (!vaultList) return;
  
  if (state.vaultFiles.length === 0) {
    vaultList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M24 4v20M4 24h20m0 0h20M24 44v-20m0 0v-20" />
        </svg>
        <div class="empty-title">No files yet</div>
        <div class="empty-description">Drop files here, or use the buttons above to add files and folders to your encrypted vault.</div>
      </div>
    `;
    return;
  }

  vaultList.innerHTML = state.vaultFiles.map(file => {
    const addedAt = file.addedAt ? new Date(file.addedAt).toLocaleString() : '';
    const metaBits = [];
    if (typeof file.size === 'number') metaBits.push(fmtBytes(file.size));
    if (addedAt) metaBits.push(`Added: ${addedAt}`);
    return `
    <div class="vault-item">
      <div class="vault-item-info">
        <div class="name">📄 ${escapeHtml(file.name || '')}</div>
        <div class="meta">${escapeHtml(metaBits.join(' • '))}</div>
      </div>
      <div class="vault-item-buttons">
        <button class="btn" onclick="window.removeVaultItem('${String(file.id)}')">Remove</button>
      </div>
    </div>
  `;
  }).join('');
}

window.removeVaultItem = async (fileId) => {
  const id = String(fileId || '');
  if (!id) return;
  if (!window.electronAPI || typeof window.electronAPI.vaultRemove !== 'function') return;
  try {
    await window.electronAPI.vaultRemove(id);
  } finally {
    refreshVault();
  }
};

function togglePasswordField() {
  const pw = DOM.vaultUploadPassword();
  const protect = DOM.vaultUploadProtect();
  if (!pw || !protect) return;
  pw.hidden = !protect.checked;
}

async function uploadVault() {
  if (state.vaultFiles.length === 0) {
    alert('Add files to vault first');
    return;
  }
  
  const protectEl = DOM.vaultUploadProtect();
  const pwEl = DOM.vaultUploadPassword();
  const protect = Boolean(protectEl?.checked);
  const password = protect ? (pwEl?.value || null) : null;
  
  if (protect && !password) {
    alert('Enter a password');
    return;
  }
  
  // Call Electron API to upload
  if (window.electronAPI && window.electronAPI.uploadVault) {
    try {
      const result = await window.electronAPI.uploadVault({
        files: state.vaultFiles,
        protect,
        password
      });
      
      alert(`Vault uploaded! Share link: ${result.shareLink}`);
      state.vaultFiles = [];
      renderVaultList();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  }
}

// ============================================================================
// STORAGE TOOL
// ============================================================================

function initStorageTool() {
  const clearBtn = DOM.clearVaultBtn();
  const exportBtn = DOM.exportVaultBtn();
  if (clearBtn) clearBtn.addEventListener('click', clearVault);
  if (exportBtn) exportBtn.addEventListener('click', exportVault);
}

function calculateStorageUsage() {
  // Used is driven by main-process vaultList() when available.
  if (DOM.storageUsedValue()) DOM.storageUsedValue().textContent = fmtBytes(state.storageUsage.used);
  if (DOM.storageFreeValue()) DOM.storageFreeValue().textContent = '—';

  const badge = DOM.storageStatus();
  if (badge) badge.textContent = `${state.vaultFiles.length} item(s) • ${fmtBytes(state.storageUsage.used)}`;

  renderFileList();
}

function renderFileList() {
  const container = DOM.fileListContainer();

  if (!container) return;
  
  if (state.vaultFiles.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 24px;">No files in vault</div>';
    return;
  }
  
  container.innerHTML = '<div class="file-list">' + 
    state.vaultFiles.map(file => `
      <div class="file-list-item">
        <span>${escapeHtml(file.name)}</span>
        <span class="muted">${fmtBytes(file.size || 0)}</span>
      </div>
    `).join('') +
    '</div>';
}

function clearVault() {
  if (!confirm('Delete all files from vault? This cannot be undone.')) return;
  if (!window.electronAPI || typeof window.electronAPI.vaultRemove !== 'function') return;

  // Remove items one-by-one (small vaults are expected). If you want bulk delete later,
  // add a dedicated IPC handler in main.
  const ids = state.vaultFiles.map(it => String(it.id)).filter(Boolean);
  Promise.allSettled(ids.map(id => window.electronAPI.vaultRemove(id)))
    .finally(() => refreshVault());
}

function exportVault() {
  alert('Export Vault is not wired up yet. (Next step: add a main-process vault-export handler that creates an encrypted backup.)');
}

// ============================================================================
// SECURE SHRED TOOL
// ============================================================================

function initShredTool() {
  const btn = DOM.shredStartBtn();
  if (btn) btn.addEventListener('click', startShredding);

  const addFilesBtn = DOM.shredAddFilesBtn();
  const addFolderBtn = DOM.shredAddFolderBtn();
  if (addFilesBtn) addFilesBtn.addEventListener('click', addShredFiles);
  if (addFolderBtn) addFolderBtn.addEventListener('click', addShredFolder);

  renderShredPaths();
}

function addUniqueShredPaths(newPaths) {
  const existing = new Set(state.shredCustomPaths.map(p => String(p)));
  for (const p of (newPaths || [])) {
    const s = String(p || '').trim();
    if (!s) continue;
    if (!existing.has(s)) {
      existing.add(s);
      state.shredCustomPaths.push(s);
    }
  }
  renderShredPaths();
}

function renderShredPaths() {
  const box = DOM.shredPathList();
  if (!box) return;

  if (!state.shredCustomPaths.length) {
    box.innerHTML = '<div class="hint" style="margin:0;">No custom targets selected.</div>';
    return;
  }

  box.innerHTML = state.shredCustomPaths.map((p, idx) => `
    <div class="shred-path-item">
      <div class="path" title="${escapeHtml(p)}">${escapeHtml(p)}</div>
      <button class="remove" type="button" onclick="window.removeShredPath(${idx})">Remove</button>
    </div>
  `).join('');
}

window.removeShredPath = (idx) => {
  const i = Number(idx);
  if (!Number.isFinite(i)) return;
  state.shredCustomPaths.splice(i, 1);
  renderShredPaths();
};

function addShredFiles() {
  if (!window.electronAPI || typeof window.electronAPI.selectFile !== 'function') return;
  window.electronAPI.selectFile().then((paths) => {
    addUniqueShredPaths(Array.isArray(paths) ? paths : []);
  });
}

function addShredFolder() {
  if (!window.electronAPI || typeof window.electronAPI.selectFolder !== 'function') return;
  window.electronAPI.selectFolder().then((paths) => {
    const p = Array.isArray(paths) ? paths[0] : null;
    if (p) addUniqueShredPaths([p]);
  });
}

function startShredding() {
  const methodEl = DOM.shredMethod();
  const method = methodEl ? methodEl.value : 'dod';
  const targets = [];
  if (DOM.shredDownloads()?.checked) targets.push('downloads');
  if (DOM.shredTemp()?.checked) targets.push('temp');
  if (DOM.shredRecycleBin()?.checked) targets.push('recycle');
  if (DOM.shredBrowserCache()?.checked) targets.push('browser');
  
  const customPaths = state.shredCustomPaths.slice();
  if (targets.length === 0 && customPaths.length === 0) {
    alert('Select at least one target location or add a custom target.');
    return;
  }

  const ok = confirm('This will permanently delete selected data. Continue?');
  if (!ok) return;
  
  // Show progress section
  const prog = DOM.shredProgressSection();
  if (prog) prog.hidden = false;
  state.shredProgress.isRunning = true;
  state.shredProgress.current = 0;
  state.shredProgress.total = 100;
  
  // Prefer main-process shred engine when available
  if (window.electronAPI && typeof window.electronAPI.shredStart === 'function') {
    const statusEl = DOM.shredStatus();
    if (statusEl) statusEl.textContent = 'Initializing…';

    window.electronAPI.shredStart({ method, targets, paths: customPaths }, (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (typeof msg.percent === 'number') {
        state.shredProgress.current = Math.max(0, Math.min(100, msg.percent));
        state.shredProgress.total = 100;
        updateShredProgress();
      }
      if (statusEl && msg.message) statusEl.textContent = String(msg.message);
    }).then((result) => {
      state.shredProgress.current = 100;
      state.shredProgress.total = 100;
      updateShredProgress();
      state.shredProgress.isRunning = false;

      const ok = result && result.success;
      if (statusEl) {
        if (ok) {
          statusEl.innerHTML = `<div style="color: var(--ok);">✓ Shredding complete!</div>`;
        } else {
          statusEl.innerHTML = `<div style="color: #ef4444;">Shredding finished with errors.</div>`;
        }
      }
    }).catch((err) => {
      state.shredProgress.isRunning = false;
      const statusEl = DOM.shredStatus();
      if (statusEl) statusEl.textContent = `Error: ${err && err.message ? err.message : String(err)}`;
    }).finally(() => {
      setTimeout(() => {
        if (prog) prog.hidden = true;
        const statusEl2 = DOM.shredStatus();
        if (statusEl2) statusEl2.textContent = '';
      }, 3000);
    });

    return;
  }

  // Fallback simulation (non-destructive)
  const interval = setInterval(() => {
    state.shredProgress.current += Math.random() * 25;
    if (state.shredProgress.current >= state.shredProgress.total) {
      state.shredProgress.current = state.shredProgress.total;
      clearInterval(interval);
      state.shredProgress.isRunning = false;
      const statusEl = DOM.shredStatus();
      if (statusEl) statusEl.textContent = '✓ Shredding complete (simulated).';
      setTimeout(() => {
        if (prog) prog.hidden = true;
        if (statusEl) statusEl.textContent = '';
      }, 3000);
    }
    updateShredProgress();
  }, 300);
}

function updateShredProgress() {
  const percent = Math.round((state.shredProgress.current / state.shredProgress.total) * 100);
  const fill = DOM.shredProgressFill();
  if (fill) fill.style.width = `${percent}%`;
}

// ============================================================================
// SETTINGS TOOL
// ============================================================================

function initSettingsTool() {
  const autoLock = DOM.settingsAutoLock();
  const pin = DOM.settingsPin();
  if (autoLock) autoLock.addEventListener('change', (e) => {
    state.settings.autoLock = e.target.checked;
    saveSettings();
  });

  if (pin) pin.addEventListener('change', (e) => {
    state.settings.requirePin = e.target.checked;
    saveSettings();
  });
}

function initToolPanels() {
  // Initialize all tool panels visibility
  document.querySelectorAll('.tool-panel').forEach(panel => {
    panel.hidden = true;
  });
}

function saveSettings() {
  localStorage.setItem('fileshot-settings', JSON.stringify(state.settings));
}

function loadSettings() {
  const saved = localStorage.getItem('fileshot-settings');
  if (saved) {
    Object.assign(state.settings, JSON.parse(saved));
    if (DOM.settingsAutoLock()) DOM.settingsAutoLock().checked = state.settings.autoLock;
    if (DOM.settingsPin()) DOM.settingsPin().checked = state.settings.requirePin;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// SIDEBAR FILE EXPLORER
// ============================================================================

function initExplorer() {
  const list = DOM.explorerList();
  const upBtn = DOM.explorerUpBtn();
  const refreshBtn = DOM.explorerRefreshBtn();

  if (!list) return;

  if (upBtn) upBtn.addEventListener('click', () => explorerUp());
  if (refreshBtn) refreshBtn.addEventListener('click', () => explorerRefresh());

  explorerShowDrives();
}

function setExplorerPathLabel(text) {
  const el = DOM.explorerPath();
  if (el) el.textContent = String(text || '');
}

async function explorerShowDrives() {
  state.explorer.mode = 'drives';
  state.explorer.currentPath = null;
  setExplorerPathLabel('This PC');

  const list = DOM.explorerList();
  if (!list) return;

  if (!window.electronAPI || typeof window.electronAPI.fsListDrives !== 'function') {
    list.innerHTML = '<div class="explorer-item"><div></div><div class="name">Explorer unavailable</div><div></div></div>';
    return;
  }

  const drives = await window.electronAPI.fsListDrives();
  const items = Array.isArray(drives) ? drives : [];
  list.innerHTML = items.map((d) => {
    const p = String(d.path || d.name || '');
    return `
      <div class="explorer-item" draggable="false" data-kind="dir" data-path="${escapeHtml(p)}">
        <div class="meta">🖴</div>
        <div class="name" title="${escapeHtml(p)}">${escapeHtml(d.name || p)}</div>
        <button class="add" type="button" data-action="open">Open</button>
      </div>
    `;
  }).join('') || '<div class="explorer-item"><div></div><div class="name">No drives found</div><div></div></div>';

  list.querySelectorAll('.explorer-item').forEach((row) => {
    row.addEventListener('dblclick', () => explorerOpen(row.dataset.path));
  });
  list.querySelectorAll('button[data-action="open"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.currentTarget.closest('.explorer-item');
      explorerOpen(row?.dataset?.path);
    });
  });
}

function explorerParentPath(p) {
  const s = String(p || '').trim();
  if (!s) return null;

  // Windows root like C:\
  if (/^[A-Z]:\\?$/i.test(s.replace(/\\+$/, '') + '\\')) return null;

  // Normalize separators for parent calc
  const isWin = s.includes('\\');
  const sep = isWin ? '\\' : '/';
  let t = s;
  // Remove trailing separator
  while (t.length > 1 && t.endsWith(sep)) t = t.slice(0, -1);
  const idx = t.lastIndexOf(sep);
  if (idx <= 0) return isWin ? null : '/';
  return t.slice(0, idx + 1);
}

async function explorerOpen(dirPath) {
  const p = String(dirPath || '').trim();
  if (!p) return;

  if (!window.electronAPI || typeof window.electronAPI.fsListDir !== 'function') {
    const list = DOM.explorerList();
    if (list) list.innerHTML = '<div class="explorer-item"><div></div><div class="name">Explorer unavailable</div><div></div></div>';
    return;
  }

  state.explorer.mode = 'dir';
  state.explorer.currentPath = p;
  setExplorerPathLabel(p);

  const list = DOM.explorerList();
  if (!list) return;

  list.innerHTML = '<div class="explorer-item"><div></div><div class="name">Loading…</div><div></div></div>';

  const res = await window.electronAPI.fsListDir(p);
  const entries = Array.isArray(res?.entries) ? res.entries : [];
  if (res?.error) {
    list.innerHTML = `<div class="explorer-item"><div></div><div class="name">${escapeHtml(res.error)}</div><div></div></div>`;
    return;
  }

  list.innerHTML = entries.map((ent) => {
    const kind = ent.isDir ? 'dir' : 'file';
    const icon = ent.isDir ? '📁' : '📄';
    const name = ent.name || ent.path;
    const p2 = String(ent.path || '');
    const btn = ent.isDir ? '<button class="add" type="button" data-action="open">Open</button>' : '<button class="add" type="button" data-action="add">Add</button>';
    return `
      <div class="explorer-item" draggable="true" data-kind="${kind}" data-path="${escapeHtml(p2)}" title="${escapeHtml(p2)}">
        <div class="meta">${icon}</div>
        <div class="name">${escapeHtml(name)}</div>
        ${btn}
      </div>
    `;
  }).join('') || '<div class="explorer-item"><div></div><div class="name">(Empty)</div><div></div></div>';

  list.querySelectorAll('.explorer-item').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      const p2 = row.dataset.path;
      const kind = row.dataset.kind;
      if (!p2) return;
      e.dataTransfer?.setData('application/x-fileshot-path', p2);
      e.dataTransfer?.setData('application/x-fileshot-kind', kind || 'file');
      e.dataTransfer?.setData('text/plain', p2);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    row.addEventListener('dblclick', () => {
      if (row.dataset.kind === 'dir') explorerOpen(row.dataset.path);
      else addPathsToVault([row.dataset.path]);
    });
  });

  list.querySelectorAll('button[data-action="open"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.currentTarget.closest('.explorer-item');
      explorerOpen(row?.dataset?.path);
    });
  });
  list.querySelectorAll('button[data-action="add"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.currentTarget.closest('.explorer-item');
      const p2 = row?.dataset?.path;
      if (p2) addPathsToVault([p2]);
    });
  });
}

function explorerUp() {
  if (state.explorer.mode !== 'dir' || !state.explorer.currentPath) {
    explorerShowDrives();
    return;
  }
  const parent = explorerParentPath(state.explorer.currentPath);
  if (!parent) {
    explorerShowDrives();
    return;
  }
  explorerOpen(parent);
}

function explorerRefresh() {
  if (state.explorer.mode === 'dir' && state.explorer.currentPath) {
    explorerOpen(state.explorer.currentPath);
  } else {
    explorerShowDrives();
  }
}

// ============================================================================
// BACK BUTTON FOR "GO ONLINE" MODE
// ============================================================================

// This will be called from main.js when user tries to go online
window.returnFromOnlineMode = () => {
  switchToTool('vault');
  console.log('Returned to offline mode');
};
