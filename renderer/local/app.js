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
  vaultSelectedFiles: [], // Selected file IDs for batch operations
  vaultViewMode: 'list', // 'list' | 'grid'
  storageUsage: { used: 0, total: 0 },
  shredProgress: { current: 0, total: 0, isRunning: false },
  shredCustomPaths: [],
  explorer: {
    currentPath: null,
    mode: 'drives', // 'drives' | 'dir'
    view: 'list', // 'list' | 'grid'
    entries: [],
    selectedPaths: [],
    lastSelectedIndex: null
  },
  settings: {
    autoLock: false,
    requirePin: false
  },
  authToken: localStorage.getItem('fileshot_token') || null,
  userId: localStorage.getItem('fileshot_userId') || null,
  // Password modal state
  passwordModal: {
    isOpen: false,
    mode: 'encrypt', // 'encrypt' | 'decrypt'
    files: [],
    fileId: null,
    callback: null
  },
  // Session password (if user chooses to save)
  sessionPassword: null
};

// ============================================================================
// DOM QUERIES & CACHE
// ============================================================================

const DOM = {
  // Sidebar
  sidebar: () => document.getElementById('sidebar'),
  btnCollapse: () => document.getElementById('btnCollapse'),
  navItems: () => document.querySelectorAll('.nav-item[data-tool]'),
  goOnlineBtn: () => document.getElementById('btnGoOnline'),

  // Explorer sidebar (right side)
  explorerSidebar: () => document.getElementById('explorerSidebar'),
  resizeHandle: () => document.getElementById('resizeHandle'),
  btnToggleExplorer: () => document.getElementById('btnToggleExplorer'),

  // Tools menu
  toolsToggleBtn: () => document.getElementById('btnToolsToggle'),
  toolsSubmenu: () => document.getElementById('toolsSubmenu'),
  toolsSubitems: () => document.querySelectorAll('#toolsSubmenu .nav-subitem'),
  
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
  vaultUploadBtn: () => document.getElementById('btnUploadVault'),
  vaultSelectAllBtn: () => document.getElementById('btnSelectAll'),
  vaultSelectNoneBtn: () => document.getElementById('btnSelectNone'),
  vaultDeleteSelectedBtn: () => document.getElementById('btnDeleteSelected'),
  vaultSelectionCount: () => document.getElementById('selectionCount'),
  vaultGridViewBtn: () => document.getElementById('btnVaultGridView'),
  vaultListViewBtn: () => document.getElementById('btnVaultListView'),
  vaultList: () => document.getElementById('vaultList'),
  vaultEmpty: () => document.getElementById('vaultEmpty'),
  vaultStatus: () => document.getElementById('vaultStatus'),
  
  // Password modals
  passwordModal: () => document.getElementById('passwordModal'),
  passwordModalTitle: () => document.getElementById('passwordModalTitle'),
  passwordModalSubtitle: () => document.getElementById('passwordModalSubtitle'),
  encryptPassword: () => document.getElementById('encryptPassword'),
  confirmPassword: () => document.getElementById('confirmPassword'),
  confirmPasswordGroup: () => document.getElementById('confirmPasswordGroup'),
  btnGeneratePassword: () => document.getElementById('btnGeneratePassword'),
  btnCopyPassword: () => document.getElementById('btnCopyPassword'),
  btnTogglePassword: () => document.getElementById('btnTogglePassword'),
  chkSavePassword: () => document.getElementById('chkSavePassword'),
  strengthFill: () => document.getElementById('strengthFill'),
  strengthText: () => document.getElementById('strengthText'),
  filesToEncrypt: () => document.getElementById('filesToEncrypt'),
  btnCancelPassword: () => document.getElementById('btnCancelPassword'),
  btnConfirmPassword: () => document.getElementById('btnConfirmPassword'),
  
  decryptModal: () => document.getElementById('decryptModal'),
  decryptFileName: () => document.getElementById('decryptFileName'),
  decryptPassword: () => document.getElementById('decryptPassword'),
  btnToggleDecryptPassword: () => document.getElementById('btnToggleDecryptPassword'),
  decryptError: () => document.getElementById('decryptError'),
  btnCancelDecrypt: () => document.getElementById('btnCancelDecrypt'),
  btnConfirmDecrypt: () => document.getElementById('btnConfirmDecrypt'),
  
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
  explorerViewBtn: () => document.getElementById('btnExplorerView'),
  explorerUpBtn: () => document.getElementById('btnExplorerUp'),
  explorerRefreshBtn: () => document.getElementById('btnExplorerRefresh'),

  // Online tool
  onlineWebview: () => document.getElementById('onlineWebview'),
  onlineUrl: () => document.getElementById('onlineUrl'),
  onlineBackBtn: () => document.getElementById('btnOnlineBack'),
  onlineForwardBtn: () => document.getElementById('btnOnlineForward'),
  onlineReloadBtn: () => document.getElementById('btnOnlineReload'),
  onlineOpenExternalBtn: () => document.getElementById('btnOnlineOpenExternal'),
  
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
  initOnlineTool();
  initVaultTool();
  initStorageTool();
  initShredTool();
  initSettingsTool();
  initExplorer();
  initExplorerResize();
  initVaultSync();
  loadSettings();
  refreshVault();
  switchToTool('vault');
});

// ============================================================================
// EXPLORER RESIZE & TOGGLE
// ============================================================================

function initExplorerResize() {
  const handle = DOM.resizeHandle();
  const explorer = DOM.explorerSidebar();
  const toggleBtn = DOM.btnToggleExplorer();

  if (!handle || !explorer) return;

  // Toggle explorer visibility
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      explorer.classList.toggle('hidden');
      handle.style.display = explorer.classList.contains('hidden') ? 'none' : '';
    });
  }

  // Resize functionality
  let isResizing = false;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerRect = document.querySelector('.app-container').getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    const clampedWidth = Math.max(200, Math.min(450, newWidth));
    explorer.style.width = clampedWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

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

  // Tools dropdown
  const toolsToggle = DOM.toolsToggleBtn();
  const toolsSubmenu = DOM.toolsSubmenu();
  const setToolsOpen = (open) => {
    if (!toolsSubmenu || !toolsToggle) return;
    toolsSubmenu.hidden = !open;
    toolsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  if (toolsToggle && toolsSubmenu) {
    toolsToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const open = toolsSubmenu.hidden;
      setToolsOpen(open);
    });
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('toolsMenu');
      if (!menu) return;
      if (!menu.contains(e.target)) setToolsOpen(false);
    });
  }

  DOM.toolsSubitems().forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const url = e.currentTarget?.dataset?.onlineUrl;
      if (url) {
        setToolsOpen(false);
        openOnline(url);
      }
    });
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
  if (!btn) return;

  btn.addEventListener('click', () => {
    openOnline('https://fileshot.io');
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

  // Global drop handling should never block the embedded site.
  setGlobalDropHandlingEnabled(toolName !== 'online');
  
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
    online: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/></svg> Online',
    pdf: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> PDF Tools',
    image: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Image Tools',
    text: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> Text Tools',
    storage: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/></svg> Storage Management',
    shred: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Secure File Shredding',
    settings: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M4.2 4.2l4.2 4.2m5.6 5.6l4.2 4.2M1 12h6m6 0h6M4.2 19.8l4.2-4.2m5.6-5.6l4.2-4.2"/></svg> Settings'
  };
  
  const topbar = DOM.topbarLeft();
  if (topbar) topbar.innerHTML = `<h1>${titles[toolName]}</h1>`;

  if (toolName === 'online') {
    const wv = DOM.onlineWebview();
    try {
      const current = wv ? String(wv.getURL() || '') : '';
      if (!current || current === 'about:blank') {
        openOnline('https://fileshot.io');
      }
    } catch (_) {
      openOnline('https://fileshot.io');
    }
  }
}

// ============================================================================
// DRAG & DROP
// ============================================================================

let dragCounter = 0;

const dropHandlers = {
  enabled: true,
  onDragEnter: null,
  onDragLeave: null,
  onDragOver: null,
  onDrop: null
};

function setGlobalDropHandlingEnabled(enabled) {
  const want = Boolean(enabled);
  if (dropHandlers.enabled === want) return;

  dropHandlers.enabled = want;
  const dz = DOM.dropZone();
  if (dz) dz.hidden = true;
  dragCounter = 0;

  if (!dropHandlers.onDragEnter) return; // not initialized yet

  if (want) {
    document.addEventListener('dragenter', dropHandlers.onDragEnter);
    document.addEventListener('dragleave', dropHandlers.onDragLeave);
    document.addEventListener('dragover', dropHandlers.onDragOver);
    document.addEventListener('drop', dropHandlers.onDrop);
  } else {
    document.removeEventListener('dragenter', dropHandlers.onDragEnter);
    document.removeEventListener('dragleave', dropHandlers.onDragLeave);
    document.removeEventListener('dragover', dropHandlers.onDragOver);
    document.removeEventListener('drop', dropHandlers.onDrop);
  }
}

function initDropZone() {
  const dropZone = DOM.dropZone();

  if (!dropZone) return;
  
  // Ensure drop zone is hidden on init
  dropZone.hidden = true;
  dragCounter = 0;
  
  // Listen on document level for drag events
  dropHandlers.onDragEnter = (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      dropZone.hidden = false;
    }
  };
  
  dropHandlers.onDragLeave = (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dropZone.hidden = true;
    }
  };
  
  dropHandlers.onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  // Handle file drop
  dropHandlers.onDrop = handleFileDrop;

  document.addEventListener('dragenter', dropHandlers.onDragEnter);
  document.addEventListener('dragleave', dropHandlers.onDragLeave);
  document.addEventListener('dragover', dropHandlers.onDragOver);
  document.addEventListener('drop', dropHandlers.onDrop);
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
      // Show password modal instead of direct add
      showPasswordModal(paths, 'encrypt');
    }
    return;
  }

  // 2) In-app drag from sidebar explorer
  const itemsJson = e.dataTransfer?.getData('application/x-fileshot-items');
  if (itemsJson) {
    let items;
    try { items = JSON.parse(itemsJson); } catch (_) { items = null; }
    const list = Array.isArray(items) ? items : [];
    const filesOnly = [];
    const dirsOnly = [];
    for (const it of list) {
      const p = String(it?.path || '').trim();
      if (!p) continue;
      const k = String(it?.kind || 'file');
      if (k === 'dir') dirsOnly.push(p);
      else filesOnly.push(p);
    }

    if (filesOnly.length || dirsOnly.length) {
      switchToTool('vault');
      // Show password modal for files
      if (filesOnly.length) {
        showPasswordModal(filesOnly, 'encrypt');
      }
      // Directories need their own password modal
      if (dirsOnly.length) {
        dirsOnly.forEach((d) => addFolderToVaultWithPassword(d));
      }
    }
    return;
  }

  const kind = e.dataTransfer?.getData('application/x-fileshot-kind');
  const p = e.dataTransfer?.getData('application/x-fileshot-path') || e.dataTransfer?.getData('text/plain');
  if (!p) return;

  switchToTool('vault');
  if (kind === 'dir') addFolderToVault(p);
  else addPathsToVault([p]);
}

// ============================================================================
// VAULT TOOL
// ============================================================================

function initVaultTool() {
  const addBtn = DOM.vaultAddBtn();
  const addFolderBtn = DOM.vaultAddFolderBtn();
  const uploadBtn = DOM.vaultUploadBtn();
  const gridViewBtn = DOM.vaultGridViewBtn();
  const listViewBtn = DOM.vaultListViewBtn();
  const selectAllBtn = DOM.vaultSelectAllBtn();
  const selectNoneBtn = DOM.vaultSelectNoneBtn();
  const deleteSelectedBtn = DOM.vaultDeleteSelectedBtn();
  
  if (addBtn) addBtn.addEventListener('click', pickFiles);
  if (addFolderBtn) addFolderBtn.addEventListener('click', pickFolder);
  if (uploadBtn) uploadBtn.addEventListener('click', uploadVaultToFileShot);
  if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllVaultFiles);
  if (selectNoneBtn) selectNoneBtn.addEventListener('click', selectNoneVaultFiles);
  if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', deleteSelectedVaultFiles);
  
  // View toggle buttons
  if (gridViewBtn) gridViewBtn.addEventListener('click', () => setVaultViewMode('grid'));
  if (listViewBtn) listViewBtn.addEventListener('click', () => setVaultViewMode('list'));
  
  // Initialize password modal
  initPasswordModal();
}

// ============================================================================
// VAULT FILE SELECTION
// ============================================================================

function toggleVaultFileSelection(fileId, event) {
  const idx = state.vaultSelectedFiles.indexOf(fileId);
  if (idx > -1) {
    state.vaultSelectedFiles.splice(idx, 1);
  } else {
    state.vaultSelectedFiles.push(fileId);
  }
  updateVaultSelection();
}

function selectAllVaultFiles() {
  state.vaultSelectedFiles = state.vaultFiles.map(f => String(f.id));
  updateVaultSelection();
}

function selectNoneVaultFiles() {
  state.vaultSelectedFiles = [];
  updateVaultSelection();
}

function updateVaultSelection() {
  // Update selection count
  const countEl = DOM.vaultSelectionCount();
  if (countEl) {
    const count = state.vaultSelectedFiles.length;
    countEl.textContent = count === 0 ? '0 selected' : `${count} selected`;
  }
  
  // Update visual selection on items
  const vaultList = DOM.vaultList();
  if (vaultList) {
    vaultList.querySelectorAll('.vault-item').forEach(el => {
      const id = el.dataset.id;
      const isSelected = state.vaultSelectedFiles.includes(id);
      el.classList.toggle('selected', isSelected);
      const checkbox = el.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = isSelected;
    });
  }
}

async function deleteSelectedVaultFiles() {
  if (state.vaultSelectedFiles.length === 0) {
    alert('No files selected. Select files using the checkboxes first.');
    return;
  }
  
  const count = state.vaultSelectedFiles.length;
  if (!confirm(`Delete ${count} selected file${count > 1 ? 's' : ''} from the vault?\n\nThis will permanently remove the encrypted files.`)) {
    return;
  }
  
  if (!window.electronAPI?.vaultRemove) {
    alert('Delete feature not available');
    return;
  }
  
  let deleted = 0;
  for (const id of state.vaultSelectedFiles) {
    try {
      await window.electronAPI.vaultRemove(id);
      deleted++;
    } catch (e) {
      console.error(`Failed to delete ${id}:`, e);
    }
  }
  
  state.vaultSelectedFiles = [];
  updateVaultSelection();
  refreshVault();
  
  if (deleted > 0) {
    console.log(`Deleted ${deleted} file(s) from vault`);
  }
}

function setVaultViewMode(mode) {
  state.vaultViewMode = mode;
  const vaultList = DOM.vaultList();
  const gridBtn = DOM.vaultGridViewBtn();
  const listBtn = DOM.vaultListViewBtn();
  
  if (vaultList) {
    vaultList.classList.remove('vault-list-view', 'vault-grid-view');
    vaultList.classList.add(mode === 'grid' ? 'vault-grid-view' : 'vault-list-view');
  }
  if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
  if (listBtn) listBtn.classList.toggle('active', mode === 'list');
  
  renderVaultList();
}

function initPasswordModal() {
  // Encrypt modal handlers
  const cancelBtn = DOM.btnCancelPassword();
  const confirmBtn = DOM.btnConfirmPassword();
  const toggleBtn = DOM.btnTogglePassword();
  const generateBtn = DOM.btnGeneratePassword();
  const copyBtn = DOM.btnCopyPassword();
  const passwordInput = DOM.encryptPassword();
  const confirmInput = DOM.confirmPassword();
  
  if (cancelBtn) cancelBtn.addEventListener('click', closePasswordModal);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmPasswordAndEncrypt);
  if (toggleBtn) toggleBtn.addEventListener('click', () => togglePasswordVisibility('encryptPassword'));
  if (generateBtn) generateBtn.addEventListener('click', generateStrongPassword);
  if (copyBtn) copyBtn.addEventListener('click', copyPasswordToClipboard);
  if (passwordInput) passwordInput.addEventListener('input', updatePasswordStrength);
  
  // Decrypt modal handlers
  const cancelDecrypt = DOM.btnCancelDecrypt();
  const confirmDecrypt = DOM.btnConfirmDecrypt();
  const toggleDecrypt = DOM.btnToggleDecryptPassword();
  const decryptInput = DOM.decryptPassword();
  
  if (cancelDecrypt) cancelDecrypt.addEventListener('click', closeDecryptModal);
  if (confirmDecrypt) confirmDecrypt.addEventListener('click', confirmDecryptPassword);
  if (toggleDecrypt) toggleDecrypt.addEventListener('click', () => togglePasswordVisibility('decryptPassword'));
  if (decryptInput) {
    decryptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmDecryptPassword();
    });
  }
}

// ============================================================================
// PASSWORD GENERATION & CLIPBOARD
// ============================================================================

function generateStrongPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const length = 16 + Math.floor(Math.random() * 8); // 16-24 chars
  let password = '';
  
  // Ensure at least one of each type
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  password += lower[Math.floor(Math.random() * lower.length)];
  password += upper[Math.floor(Math.random() * upper.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  
  // Shuffle the password
  password = password.split('').sort(() => Math.random() - 0.5).join('');
  
  const passwordInput = DOM.encryptPassword();
  const confirmInput = DOM.confirmPassword();
  
  if (passwordInput) {
    passwordInput.value = password;
    passwordInput.type = 'text'; // Show the generated password
    updatePasswordStrength();
  }
  if (confirmInput) {
    confirmInput.value = password;
  }
}

async function copyPasswordToClipboard() {
  const passwordInput = DOM.encryptPassword();
  const copyBtn = DOM.btnCopyPassword();
  const password = passwordInput?.value || '';
  
  if (!password) {
    alert('No password to copy. Enter or generate a password first.');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(password);
    
    // Visual feedback
    if (copyBtn) {
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      }, 2000);
    }
  } catch (e) {
    alert('Failed to copy password to clipboard');
  }
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function updatePasswordStrength() {
  const password = DOM.encryptPassword()?.value || '';
  const strengthFill = DOM.strengthFill();
  const strengthText = DOM.strengthText();
  if (!strengthFill || !strengthText) return;
  
  let strength = 0;
  let label = 'Too weak';
  let color = '#ef4444';
  
  if (password.length >= 4) strength += 20;
  if (password.length >= 8) strength += 20;
  if (password.length >= 12) strength += 10;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength += 15;
  if (/\d/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 20;
  
  if (strength >= 80) { label = 'Strong'; color = '#10b981'; }
  else if (strength >= 50) { label = 'Medium'; color = '#f59e0b'; }
  else if (strength >= 30) { label = 'Weak'; color = '#f97316'; }
  
  strengthFill.style.width = `${Math.min(strength, 100)}%`;
  strengthFill.style.background = color;
  strengthText.textContent = password ? `Password strength: ${label}` : 'Password strength: Enter a password';
}

function showPasswordModal(files, mode = 'encrypt') {
  const modal = DOM.passwordModal();
  const title = DOM.passwordModalTitle();
  const subtitle = DOM.passwordModalSubtitle();
  const confirmGroup = DOM.confirmPasswordGroup();
  const filesToEncryptEl = DOM.filesToEncrypt();
  const passwordInput = DOM.encryptPassword();
  const confirmInput = DOM.confirmPassword();
  const saveCheckbox = DOM.chkSavePassword();
  
  state.passwordModal = { isOpen: true, mode, files, fileId: null, callback: null };
  
  if (title) title.textContent = 'Set Encryption Password';
  if (subtitle) subtitle.textContent = `Encrypting ${files.length} file${files.length > 1 ? 's' : ''} with AES-256-GCM`;
  if (confirmGroup) confirmGroup.hidden = false;
  
  // Show files to be encrypted
  if (filesToEncryptEl) {
    const fileNames = files.map(p => {
      const name = String(p).split(/[/\\]/).pop();
      return `<div class="file-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>${escapeHtml(name)}</div>`;
    });
    filesToEncryptEl.innerHTML = fileNames.join('');
  }
  
  // Pre-fill with session password if available
  if (state.sessionPassword) {
    if (passwordInput) passwordInput.value = state.sessionPassword;
    if (confirmInput) confirmInput.value = state.sessionPassword;
    if (saveCheckbox) saveCheckbox.checked = true;
    updatePasswordStrength();
  } else {
    // Reset inputs
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (saveCheckbox) saveCheckbox.checked = false;
    updatePasswordStrength();
  }
  
  if (modal) modal.hidden = false;
  
  // Focus after a tiny delay to ensure modal is visible
  setTimeout(() => {
    if (passwordInput) passwordInput.focus();
  }, 50);
}

function closePasswordModal() {
  const modal = DOM.passwordModal();
  const passwordInput = DOM.encryptPassword();
  const confirmInput = DOM.confirmPassword();
  
  state.passwordModal = { isOpen: false, mode: 'encrypt', files: [], fileId: null, callback: null };
  
  if (passwordInput) passwordInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (modal) modal.hidden = true;
}

async function confirmPasswordAndEncrypt() {
  const passwordInput = DOM.encryptPassword();
  const confirmInput = DOM.confirmPassword();
  const saveCheckbox = DOM.chkSavePassword();
  const password = passwordInput?.value || '';
  const confirm = confirmInput?.value || '';
  
  if (password.length < 4) {
    alert('Password must be at least 4 characters');
    passwordInput?.focus();
    return;
  }
  if (password !== confirm) {
    alert('Passwords do not match');
    confirmInput?.focus();
    return;
  }
  
  // Save password for session if requested
  if (saveCheckbox?.checked) {
    state.sessionPassword = password;
  }
  
  const { mode, files, folderPath } = state.passwordModal;
  closePasswordModal();
  
  // Handle folder encryption
  if (mode === 'encrypt-folder' && folderPath) {
    if (!window.electronAPI?.vaultAddFolder) {
      alert('Vault encryption not available');
      return;
    }
    try {
      const result = await window.electronAPI.vaultAddFolder(folderPath, password);
      if (result.success) {
        refreshVault();
      } else {
        alert(`Encryption failed: ${result.error || 'Unknown error'}`);
      }
    } catch (e) {
      alert(`Error: ${e.message || e}`);
    }
    return;
  }
  
  // Now add files with password
  if (!window.electronAPI?.vaultAdd) {
    alert('Vault encryption not available');
    return;
  }
  
  try {
    const result = await window.electronAPI.vaultAdd(files, password);
    if (result.success) {
      refreshVault();
    } else {
      alert(`Encryption failed: ${result.error || 'Unknown error'}`);
    }
  } catch (e) {
    alert(`Error: ${e.message || e}`);
  }
}

function showDecryptModal(fileId, fileName, callback) {
  // If session password is saved, try it first
  if (state.sessionPassword) {
    (async () => {
      try {
        const result = await callback(fileId, state.sessionPassword);
        if (result.success) {
          return; // Worked with session password
        }
        // Session password didn't work, show modal
        showDecryptModalUI(fileId, fileName, callback);
      } catch (e) {
        showDecryptModalUI(fileId, fileName, callback);
      }
    })();
    return;
  }
  
  showDecryptModalUI(fileId, fileName, callback);
}

function showDecryptModalUI(fileId, fileName, callback) {
  const modal = DOM.decryptModal();
  const fileNameEl = DOM.decryptFileName();
  const passwordInput = DOM.decryptPassword();
  const errorEl = DOM.decryptError();
  
  state.passwordModal = { isOpen: true, mode: 'decrypt', files: [], fileId, callback };
  
  if (fileNameEl) fileNameEl.textContent = `Decrypt: ${fileName}`;
  if (passwordInput) passwordInput.value = '';
  if (errorEl) errorEl.hidden = true;
  if (modal) modal.hidden = false;
  
  // Focus after a tiny delay to ensure modal is visible
  setTimeout(() => {
    if (passwordInput) passwordInput.focus();
  }, 50);
}

function closeDecryptModal() {
  const modal = DOM.decryptModal();
  const passwordInput = DOM.decryptPassword();
  
  state.passwordModal = { isOpen: false, mode: 'encrypt', files: [], fileId: null, callback: null };
  
  if (passwordInput) passwordInput.value = '';
  if (modal) modal.hidden = true;
}

async function confirmDecryptPassword() {
  const passwordInput = DOM.decryptPassword();
  const errorEl = DOM.decryptError();
  const password = passwordInput?.value || '';
  
  if (!password) {
    if (errorEl) { errorEl.textContent = 'Please enter your password'; errorEl.hidden = false; }
    return;
  }
  
  const { fileId, callback } = state.passwordModal;
  
  if (typeof callback === 'function') {
    try {
      const result = await callback(fileId, password);
      if (result.success) {
        closeDecryptModal();
      } else if (result.wrongPassword) {
        if (errorEl) { errorEl.textContent = 'Incorrect password. Please try again.'; errorEl.hidden = false; }
        passwordInput?.select();
      } else {
        if (errorEl) { errorEl.textContent = result.error || 'Decryption failed'; errorEl.hidden = false; }
      }
    } catch (e) {
      if (errorEl) { errorEl.textContent = e.message || 'Decryption error'; errorEl.hidden = false; }
    }
  }
}

function pickFiles() {
  // In Electron, trigger file picker through main process
  if (!window.electronAPI || typeof window.electronAPI.selectFile !== 'function') return;
  window.electronAPI.selectFile().then(filePaths => {
    const paths = Array.isArray(filePaths) ? filePaths : [];
    if (paths.length) showPasswordModal(paths, 'encrypt');
  });
}

function pickFolder() {
  if (!window.electronAPI || typeof window.electronAPI.selectFolder !== 'function') return;
  window.electronAPI.selectFolder().then(folderPaths => {
    const folderPath = Array.isArray(folderPaths) ? folderPaths[0] : null;
    if (folderPath) addFolderToVaultWithPassword(folderPath);
  });
}

function addFolderToVaultWithPassword(folderPath) {
  // For folders, show password modal
  const modal = DOM.passwordModal();
  const title = DOM.passwordModalTitle();
  const subtitle = DOM.passwordModalSubtitle();
  const confirmGroup = DOM.confirmPasswordGroup();
  const filesToEncryptEl = DOM.filesToEncrypt();
  const passwordInput = DOM.encryptPassword();
  const confirmInput = DOM.confirmPassword();
  const saveCheckbox = DOM.chkSavePassword();
  
  state.passwordModal = { isOpen: true, mode: 'encrypt-folder', files: [], fileId: null, folderPath, callback: null };
  
  if (title) title.textContent = 'Set Encryption Password';
  if (subtitle) subtitle.textContent = `Encrypting all files in folder`;
  if (confirmGroup) confirmGroup.hidden = false;
  
  if (filesToEncryptEl) {
    const name = String(folderPath).split(/[/\\]/).pop();
    filesToEncryptEl.innerHTML = `<div class="file-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>📁 ${escapeHtml(name)}</div>`;
  }
  
  // Pre-fill with session password if available
  if (state.sessionPassword) {
    if (passwordInput) passwordInput.value = state.sessionPassword;
    if (confirmInput) confirmInput.value = state.sessionPassword;
    if (saveCheckbox) saveCheckbox.checked = true;
    updatePasswordStrength();
  } else {
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (saveCheckbox) saveCheckbox.checked = false;
    updatePasswordStrength();
  }
  
  if (modal) modal.hidden = false;
  
  // Focus after a tiny delay
  setTimeout(() => {
    if (passwordInput) passwordInput.focus();
  }, 50);
}

async function addPathsToVault(paths, password) {
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
    await window.electronAPI.vaultAdd(paths, password);
  } finally {
    refreshVault();
  }
}

async function addFolderToVault(folderPath, password) {
  if (!window.electronAPI || typeof window.electronAPI.vaultAddFolder !== 'function') return;
  try {
    await window.electronAPI.vaultAddFolder(folderPath, password);
  } finally {
    refreshVault();
  }
}

function renderVaultList() {
  const vaultList = DOM.vaultList();
  const vaultEmpty = DOM.vaultEmpty();

  if (!vaultList) return;
  
  // Update view mode class
  vaultList.classList.remove('vault-list-view', 'vault-grid-view');
  vaultList.classList.add(state.vaultViewMode === 'grid' ? 'vault-grid-view' : 'vault-list-view');
  
  // Clean up any stale selections
  state.vaultSelectedFiles = state.vaultSelectedFiles.filter(id => 
    state.vaultFiles.some(f => String(f.id) === id)
  );
  
  if (state.vaultFiles.length === 0) {
    vaultList.innerHTML = '';
    if (vaultEmpty) vaultEmpty.hidden = false;
    updateVaultSelection();
    return;
  }
  
  if (vaultEmpty) vaultEmpty.hidden = true;

  vaultList.innerHTML = state.vaultFiles.map(file => {
    const addedAt = file.addedAt ? new Date(file.addedAt).toLocaleDateString() : '';
    const displaySize = file.originalSize || file.size;
    const sizeStr = typeof displaySize === 'number' ? fmtBytes(displaySize) : '';
    const isEncrypted = file.encrypted;
    const fileId = String(file.id);
    const isSelected = state.vaultSelectedFiles.includes(fileId);
    
    // Get file extension for icon
    const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
    const fileIcon = getFileIcon(ext);
    
    if (state.vaultViewMode === 'grid') {
      return `
      <div class="vault-item${isSelected ? ' selected' : ''}" data-id="${escapeHtml(fileId)}">
        <div class="vault-item-checkbox">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); window.toggleVaultSelection('${fileId}')" />
        </div>
        <div class="vault-item-icon">${fileIcon}</div>
        <div class="vault-item-info">
          <div class="name">${escapeHtml(file.name || '')}</div>
          <div class="meta">${sizeStr}${isEncrypted ? ' • 🔒' : ''}</div>
        </div>
      </div>
    `;
    }
    
    return `
    <div class="vault-item${isSelected ? ' selected' : ''}" data-id="${escapeHtml(fileId)}">
      <div class="vault-item-checkbox">
        <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); window.toggleVaultSelection('${fileId}')" />
      </div>
      <div class="vault-item-icon">${fileIcon}</div>
      <div class="vault-item-info">
        <div class="name">
          ${escapeHtml(file.name || '')}
          ${isEncrypted ? '<span class="lock-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Encrypted</span>' : ''}
        </div>
        <div class="meta">
          <span>${sizeStr}</span>
          ${addedAt ? `<span>${addedAt}</span>` : ''}
          ${isEncrypted ? '<span style="color: #10b981;">AES-256-GCM</span>' : ''}
        </div>
      </div>
      <div class="vault-item-buttons">
        <button class="btn btn-primary" onclick="window.openVaultItem('${fileId}', '${escapeHtml(file.name || '')}')" title="Open/Preview">Open</button>
        <button class="btn btn-secondary" onclick="window.exportVaultItem('${fileId}', '${escapeHtml(file.name || '')}')" title="Export decrypted copy">Export</button>
        <button class="btn btn-danger" onclick="window.removeVaultItem('${fileId}')" title="Remove from vault">Remove</button>
      </div>
    </div>
  `;
  }).join('');
  
  // Add click handlers for items (row click toggles selection, double-click opens)
  vaultList.querySelectorAll('.vault-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't toggle if clicking on buttons or checkbox
      if (e.target.closest('.vault-item-buttons') || e.target.closest('.vault-item-checkbox')) return;
      const id = el.dataset.id;
      window.toggleVaultSelection(id);
    });
    
    el.addEventListener('dblclick', (e) => {
      // Don't open if clicking on buttons or checkbox
      if (e.target.closest('.vault-item-buttons') || e.target.closest('.vault-item-checkbox')) return;
      const id = el.dataset.id;
      const file = state.vaultFiles.find(f => String(f.id) === id);
      if (file) window.openVaultItem(id, file.name);
    });
  });
  
  updateVaultSelection();
}

// Global function for checkbox click
window.toggleVaultSelection = (fileId) => {
  toggleVaultFileSelection(fileId);
};

function getFileIcon(ext) {
  const iconMap = {
    pdf: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
    doc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
    docx: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
    xls: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
    xlsx: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
    jpg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    jpeg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    png: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    gif: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    mp3: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
    mp4: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>',
    zip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>',
  };
  return iconMap[ext] || '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
}

// Open/preview a vault file
window.openVaultItem = async (fileId, fileName) => {
  const id = String(fileId || '');
  if (!id) return;
  if (!window.electronAPI || typeof window.electronAPI.vaultOpen !== 'function') {
    alert('Open feature not available');
    return;
  }
  
  // First, try without password to check if file needs password
  const checkResult = await window.electronAPI.vaultOpen(id, null);
  
  if (checkResult.needPassword) {
    // Show decrypt modal
    showDecryptModal(id, fileName || 'file', async (fId, password) => {
      return await window.electronAPI.vaultOpen(fId, password);
    });
    return;
  }
  
  if (!checkResult.success) {
    alert(`Failed to open: ${checkResult.error || 'Unknown error'}`);
  }
};

// Export a single vault file
window.exportVaultItem = async (fileId, fileName) => {
  const id = String(fileId || '');
  if (!id) return;
  if (!window.electronAPI || typeof window.electronAPI.vaultExportFile !== 'function') {
    alert('Export feature not available');
    return;
  }
  
  // First, try without password to check if file needs password
  const checkResult = await window.electronAPI.vaultExportFile(id, null);
  
  if (checkResult.needPassword) {
    // Show decrypt modal
    showDecryptModal(id, fileName || 'file', async (fId, password) => {
      return await window.electronAPI.vaultExportFile(fId, password);
    });
    return;
  }
  
  if (checkResult.canceled) return;
  if (!checkResult.success) {
    alert(`Failed to export: ${checkResult.error || 'Unknown error'}`);
  }
};

window.removeVaultItem = async (fileId) => {
  const id = String(fileId || '');
  if (!id) return;
  if (!window.electronAPI || typeof window.electronAPI.vaultRemove !== 'function') return;
  if (!confirm('Remove this file from the vault? The encrypted copy will be deleted.')) return;
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

// Upload encrypted vault files to FileShot.io
async function uploadVaultToFileShot() {
  if (state.vaultFiles.length === 0) {
    alert('Your vault is empty. Add files first.');
    return;
  }
  
  const count = state.vaultFiles.length;
  if (!confirm(`Upload ${count} encrypted file${count > 1 ? 's' : ''} to FileShot.io?\n\nThe files will remain encrypted with your password. They can only be decrypted with your original password.`)) {
    return;
  }
  
  // Check if uploadZke API is available
  if (!window.electronAPI?.uploadZke) {
    alert('Upload feature not available. Please use the Online mode to upload files.');
    return;
  }
  
  let uploaded = 0;
  let failed = 0;
  
  for (const file of state.vaultFiles) {
    try {
      const result = await window.electronAPI.uploadZke(file.id, { keepEncrypted: true }, (progress) => {
        console.log(`Upload progress for ${file.name}:`, progress);
      });
      
      if (result.success) {
        uploaded++;
        // Store the share URL on the vault item
        file.lastUpload = {
          shareUrl: result.shareUrl,
          uploadedAt: Date.now()
        };
      } else {
        failed++;
        console.warn(`Failed to upload ${file.name}:`, result.error);
      }
    } catch (e) {
      failed++;
      console.error(`Error uploading ${file.name}:`, e);
    }
  }
  
  if (failed > 0) {
    alert(`Upload complete.\n✓ ${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded\n✗ ${failed} file${failed !== 1 ? 's' : ''} failed`);
  } else {
    alert(`Successfully uploaded ${uploaded} encrypted file${uploaded !== 1 ? 's' : ''} to FileShot.io!\n\nYou can share the files from the Online section.`);
  }
  
  refreshVault();
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
  const importBtn = document.getElementById('btnImportVault');
  if (clearBtn) clearBtn.addEventListener('click', clearVault);
  if (exportBtn) exportBtn.addEventListener('click', exportVault);
  if (importBtn) importBtn.addEventListener('click', importVault);
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

async function exportVault() {
  if (state.vaultFiles.length === 0) {
    alert('Vault is empty. Add files first.');
    return;
  }
  if (!window.electronAPI || typeof window.electronAPI.vaultExportAll !== 'function') {
    alert('Export feature not available');
    return;
  }
  try {
    const res = await window.electronAPI.vaultExportAll();
    if (res.canceled) return;
    if (res.success) {
      alert(`Vault exported successfully!\n${res.count} file(s) saved to:\n${res.path}`);
    } else {
      alert(`Export failed: ${res.error || 'Unknown error'}`);
    }
  } catch (e) {
    alert(`Error: ${e.message || e}`);
  }
}

async function importVault() {
  if (!window.electronAPI || typeof window.electronAPI.vaultImport !== 'function') {
    alert('Import feature not available');
    return;
  }
  try {
    const res = await window.electronAPI.vaultImport();
    if (res.canceled) return;
    if (res.success) {
      alert(`Vault imported successfully!\n${res.imported} file(s) added.`);
      refreshVault();
    } else {
      alert(`Import failed: ${res.error || 'Unknown error'}`);
    }
  } catch (e) {
    alert(`Error: ${e.message || e}`);
  }
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
  const viewBtn = DOM.explorerViewBtn();

  if (!list) return;

  if (upBtn) upBtn.addEventListener('click', () => explorerUp());
  if (refreshBtn) refreshBtn.addEventListener('click', () => explorerRefresh());
  if (viewBtn) {
    viewBtn.addEventListener('click', () => {
      state.explorer.view = state.explorer.view === 'grid' ? 'list' : 'grid';
      renderExplorerSelection();
    });
  }

  explorerShowDrives();
}

function setExplorerPathLabel(text) {
  const el = DOM.explorerPath();
  if (el) el.textContent = String(text || '');
}

async function explorerShowDrives() {
  state.explorer.mode = 'drives';
  state.explorer.currentPath = null;
  state.explorer.entries = [];
  state.explorer.selectedPaths = [];
  state.explorer.lastSelectedIndex = null;
  setExplorerPathLabel('This PC');

  const list = DOM.explorerList();
  if (!list) return;

  if (!window.electronAPI || typeof window.electronAPI.fsListDrives !== 'function') {
    list.innerHTML = '<div class="explorer-item"><div></div><div class="name">Explorer unavailable</div><div></div></div>';
    return;
  }

  const drives = await window.electronAPI.fsListDrives();
  const items = Array.isArray(drives) ? drives : [];
  state.explorer.entries = items.map((d) => {
    const p = String(d.path || d.name || '');
    return { kind: 'dir', path: p, name: d.name || p, meta: '🖴' };
  });

  list.innerHTML = state.explorer.entries.map((d, idx) => {
    const p = String(d.path || '');
    return `
      <div class="explorer-item" draggable="true" data-index="${idx}" data-kind="dir" data-path="${escapeHtml(p)}">
        <div class="meta">🖴</div>
        <div class="name" title="${escapeHtml(p)}">${escapeHtml(d.name || p)}</div>
        <button class="add" type="button" data-action="open">Open</button>
      </div>
    `;
  }).join('') || '<div class="explorer-item"><div></div><div class="name">No drives found</div><div></div></div>';

  wireExplorerEvents();
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
  state.explorer.entries = [];
  state.explorer.selectedPaths = [];
  state.explorer.lastSelectedIndex = null;
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

  state.explorer.entries = entries.map((ent) => {
    const kind = ent.isDir ? 'dir' : 'file';
    const icon = ent.isDir ? '📁' : '📄';
    const name = ent.name || ent.path;
    const p2 = String(ent.path || '');
    return { kind, icon, name, path: p2 };
  });

  list.innerHTML = state.explorer.entries.map((ent, idx) => {
    const kind = ent.kind;
    const icon = ent.icon;
    const name = ent.name;
    const p2 = String(ent.path || '');
    const btn = kind === 'dir' ? '<button class="add" type="button" data-action="open">Open</button>' : '<button class="add" type="button" data-action="add">Add</button>';
    return `
      <div class="explorer-item" draggable="true" data-index="${idx}" data-kind="${kind}" data-path="${escapeHtml(p2)}" title="${escapeHtml(p2)}">
        <div class="meta">${icon}</div>
        <div class="name">${escapeHtml(name)}</div>
        ${btn}
      </div>
    `;
  }).join('') || '<div class="explorer-item"><div></div><div class="name">(Empty)</div><div></div></div>';

  wireExplorerEvents();
}

function renderExplorerSelection() {
  const list = DOM.explorerList();
  if (!list) return;
  list.classList.toggle('grid', state.explorer.view === 'grid');
  const sel = new Set(state.explorer.selectedPaths.map(String));
  list.querySelectorAll('.explorer-item').forEach((row) => {
    const p = String(row.dataset.path || '');
    row.classList.toggle('selected', sel.has(p));
  });
}

function setExplorerSelection(paths, lastIndex = null) {
  state.explorer.selectedPaths = Array.from(new Set((paths || []).map(String).filter(Boolean)));
  state.explorer.lastSelectedIndex = lastIndex;
  renderExplorerSelection();
}

function wireExplorerEvents() {
  const list = DOM.explorerList();
  if (!list) return;

  renderExplorerSelection();

  list.querySelectorAll('.explorer-item').forEach((row) => {
    row.addEventListener('click', (e) => {
      // Buttons handle their own clicks; keep row selection logic clean.
      if (e.target && e.target.closest('button')) return;
      const p = String(row.dataset.path || '').trim();
      if (!p) return;

      const idx = Number(row.dataset.index);
      const hasCtrl = e.ctrlKey || e.metaKey;
      const hasShift = e.shiftKey;
      const selected = new Set(state.explorer.selectedPaths.map(String));

      if (hasShift && Number.isFinite(state.explorer.lastSelectedIndex) && Number.isFinite(idx)) {
        const start = Math.min(state.explorer.lastSelectedIndex, idx);
        const end = Math.max(state.explorer.lastSelectedIndex, idx);
        const paths = [];
        for (let i = start; i <= end; i++) {
          const r = list.querySelector(`.explorer-item[data-index="${i}"]`);
          const rp = String(r?.dataset?.path || '').trim();
          if (rp) paths.push(rp);
        }
        // Shift-select replaces selection unless Ctrl is held
        if (!hasCtrl) {
          setExplorerSelection(paths, idx);
        } else {
          paths.forEach((p2) => selected.add(p2));
          setExplorerSelection(Array.from(selected), idx);
        }
        return;
      }

      if (hasCtrl) {
        if (selected.has(p)) selected.delete(p);
        else selected.add(p);
        setExplorerSelection(Array.from(selected), Number.isFinite(idx) ? idx : null);
        return;
      }

      setExplorerSelection([p], Number.isFinite(idx) ? idx : null);
    });

    row.addEventListener('dblclick', () => {
      if (row.dataset.kind === 'dir') explorerOpen(row.dataset.path);
      else addPathsToVault([row.dataset.path]);
    });

    row.addEventListener('dragstart', (e) => {
      const p = String(row.dataset.path || '').trim();
      if (!p) return;
      const kind = String(row.dataset.kind || 'file');

      // If dragging an unselected item, select it (common OS behavior)
      const selected = new Set(state.explorer.selectedPaths.map(String));
      if (!selected.has(p)) {
        const idx = Number(row.dataset.index);
        setExplorerSelection([p], Number.isFinite(idx) ? idx : null);
        selected.clear();
        selected.add(p);
      }

      const allRows = Array.from(list.querySelectorAll('.explorer-item'));
      const items = Array.from(selected).map((sp) => {
        const r = allRows.find(r0 => String(r0?.dataset?.path || '') === sp);
        return { path: sp, kind: String(r?.dataset?.kind || 'file') };
      });

      if (e.dataTransfer) {
        e.dataTransfer.setData('application/x-fileshot-items', JSON.stringify(items));
        // Back-compat single-path fields
        e.dataTransfer.setData('application/x-fileshot-path', p);
        e.dataTransfer.setData('application/x-fileshot-kind', kind);
        e.dataTransfer.setData('text/plain', items.map(it => it.path).join('\n'));
        e.dataTransfer.effectAllowed = 'copy';
      }

      // Enable drag from Explorer into the embedded website and the OS.
      try {
        const paths = items.map(it => it.path);
        window.electronAPI?.startDrag?.(paths);
      } catch (_) {}
    });
  });

  list.querySelectorAll('button[data-action="open"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = e.currentTarget.closest('.explorer-item');
      explorerOpen(row?.dataset?.path);
    });
  });

  list.querySelectorAll('button[data-action="add"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = e.currentTarget.closest('.explorer-item');
      const p2 = row?.dataset?.path;
      if (p2) addPathsToVault([p2]);
    });
  });
}

// ============================================================================
// ONLINE TOOL (EMBED LIVE SITE)
// ============================================================================

function initOnlineTool() {
  const wv = DOM.onlineWebview();
  if (!wv) return;

  const setUrlLabel = (u) => {
    const el = DOM.onlineUrl();
    if (!el) return;
    el.textContent = String(u || '');
    el.title = String(u || '');
  };

  wv.addEventListener('did-navigate', () => setUrlLabel(wv.getURL()));
  wv.addEventListener('did-navigate-in-page', () => setUrlLabel(wv.getURL()));

  // Enable drag-drop onto webview for file uploads
  const onlineFrame = wv.closest('.online-frame');
  if (onlineFrame) {
    onlineFrame.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });
    
    onlineFrame.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Handle in-app drag from explorer
      const itemsJson = e.dataTransfer?.getData('application/x-fileshot-items');
      if (itemsJson) {
        let items;
        try { items = JSON.parse(itemsJson); } catch (_) { items = null; }
        const list = Array.isArray(items) ? items : [];
        const paths = list.map(it => String(it?.path || '')).filter(Boolean);
        if (paths.length) {
          triggerWebviewFileUpload(wv, paths);
        }
        return;
      }
      
      // Handle OS-level file drop
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const paths = Array.from(files).map(f => f.path).filter(Boolean);
        if (paths.length) {
          triggerWebviewFileUpload(wv, paths);
        }
      }
    });
  }
  
  // Handle online upload trigger from main process
  window.electronAPI?.onTriggerOnlineUpload?.((paths) => {
    if (paths && paths.length) {
      triggerWebviewFileUpload(wv, paths);
    }
  });

  const backBtn = DOM.onlineBackBtn();
  const fwdBtn = DOM.onlineForwardBtn();
  const reloadBtn = DOM.onlineReloadBtn();
  const externalBtn = DOM.onlineOpenExternalBtn();

  if (backBtn) backBtn.addEventListener('click', () => { try { if (wv.canGoBack()) wv.goBack(); } catch (_) {} });
  if (fwdBtn) fwdBtn.addEventListener('click', () => { try { if (wv.canGoForward()) wv.goForward(); } catch (_) {} });
  if (reloadBtn) reloadBtn.addEventListener('click', () => { try { wv.reload(); } catch (_) {} });
  if (externalBtn) externalBtn.addEventListener('click', () => {
    const url = wv.getURL();
    try {
      window.electronAPI?.openExternal?.(url);
    } catch (_) {
      try { window.electronAPI?.copyToClipboard?.(url); } catch (_) {}
    }
  });

  // Main-process navigation requests (tray/menu)
  window.electronAPI?.onNavigateTo?.((route) => {
    if (!route) return;
    if (typeof route === 'string') {
      if (route === 'online') openOnline('https://fileshot.io');
      return;
    }
    if (route.tool === 'online') {
      openOnline(route.url || 'https://fileshot.io');
      return;
    }
    if (route.tool) switchToTool(route.tool);
  });
}

function openOnline(url) {
  if (state.currentTool !== 'online') switchToTool('online');
  const wv = DOM.onlineWebview();
  if (!wv) return;
  const u = String(url || 'https://fileshot.io');
  try {
    if (!wv.getURL() || wv.getURL() === 'about:blank') {
      wv.src = u;
    } else {
      wv.loadURL(u);
    }
  } catch (_) {
    // Fallback: set src
    wv.src = u;
  }

  const urlEl = DOM.onlineUrl();
  if (urlEl) {
    urlEl.textContent = u;
    urlEl.title = u;
  }
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
// WEBVIEW FILE UPLOAD TRIGGER
// ============================================================================

/**
 * Trigger file upload in the online webview by injecting a script
 * that simulates a file drop on the dropzone.
 */
function triggerWebviewFileUpload(wv, paths) {
  if (!wv || !paths || !paths.length) return;
  
  // We need to use executeJavaScript to trigger the file input in the webview
  // The webview has a dropzone that accepts files
  const script = `
    (function() {
      // Look for file input or dropzone
      const dropzone = document.querySelector('.upload-dropzone, .dropzone, [class*="drop"]');
      const fileInput = document.querySelector('input[type="file"]');
      
      if (fileInput) {
        // Click the file input to trigger native file dialog
        // Note: We can't programmatically set files due to security
        fileInput.click();
        console.log('[FileShot Desktop] Triggered file input click for upload');
      } else if (dropzone) {
        // Visual indicator that drop was received
        dropzone.style.outline = '3px solid #f97316';
        setTimeout(() => { dropzone.style.outline = ''; }, 1500);
        console.log('[FileShot Desktop] Files received - use Choose Files button');
      }
      
      // Show a notification
      const msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;z-index:99999;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
      msg.textContent = 'Files received! Click "Choose Files" to select them.';
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 3000);
    })();
  `;
  
  try {
    wv.executeJavaScript(script);
  } catch (e) {
    console.error('[FileShot Desktop] Failed to trigger webview upload:', e);
  }
}

// Legacy hook removed: online is now embedded inside the local shell.
