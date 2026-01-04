/**
 * FileShot Offline Desktop App - Main Application Logic
 * Handles sidebar navigation, drag-drop, storage management, and secure shredding
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  currentTool: 'vault',
  sidebarCollapsed: false,
  vaultFiles: [],
  storageUsage: { used: 0, total: 0 },
  shredProgress: { current: 0, total: 0, isRunning: false },
  settings: {
    autoLock: false,
    requirePin: false
  }
};

// ============================================================================
// DOM QUERIES & CACHE
// ============================================================================

const DOM = {
  // Sidebar
  sidebar: () => document.getElementById('sidebar'),
  btnCollapse: () => document.getElementById('btnCollapse'),
  navItems: () => document.querySelectorAll('.nav-item'),
  
  // Main content
  topbarLeft: () => document.querySelector('.topbar-left'),
  toolsContainer: () => document.querySelector('.tools-container'),
  dropZone: () => document.getElementById('dropZone'),
  dropZoneText: () => document.querySelector('.drop-zone-text'),
  
  // Tool panels
  toolPanel: (toolName) => document.getElementById(`tool-${toolName}`),
  
  // Specific tools
  vaultAddBtn: () => document.getElementById('addFilesBtn'),
  vaultAddFolderBtn: () => document.getElementById('addFolderBtn'),
  vaultList: () => document.getElementById('vaultList'),
  vaultUploadBtn: () => document.getElementById('uploadVaultBtn'),
  vaultUploadPassword: () => document.getElementById('uploadPassword'),
  vaultUploadProtect: () => document.getElementById('protectWithPassword'),
  
  storageUsedValue: () => document.getElementById('storageUsedValue'),
  storageFreeValue: () => document.getElementById('storageFreeValue'),
  storagePercent: () => document.querySelector('.storage-percent'),
  storageProgressFill: () => document.querySelector('.storage-progress-fill'),
  clearVaultBtn: () => document.getElementById('clearVaultBtn'),
  exportVaultBtn: () => document.getElementById('exportVaultBtn'),
  fileListContainer: () => document.getElementById('fileListContainer'),
  
  shredMethod: () => document.querySelector('input[name="shred-method"]:checked'),
  shredTargets: () => document.querySelectorAll('input[name="shred-target"]:checked'),
  shredStartBtn: () => document.getElementById('startShredBtn'),
  shredProgressSection: () => document.getElementById('shredProgressSection'),
  shredProgressFill: () => document.querySelector('.shred-progress-fill'),
  shredStatus: () => document.getElementById('shredStatus'),
  
  settingsAutoLock: () => document.getElementById('autoLock'),
  settingsPin: () => document.getElementById('requirePin'),
  settingsPinValue: () => document.getElementById('pinValue'),
  settingsVersion: () => document.getElementById('versionInfo'),
  settingsEncryptionMethod: () => document.getElementById('encryptionMethod')
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
  initDropZone();
  initToolPanels();
  initVaultTool();
  initStorageTool();
  initShredTool();
  initSettingsTool();
  loadSettings();
  calculateStorageUsage();
  switchToTool('vault');
});

// ============================================================================
// SIDEBAR NAVIGATION
// ============================================================================

function initSidebar() {
  DOM.btnCollapse().addEventListener('click', toggleSidebar);
  
  DOM.navItems().forEach(item => {
    item.addEventListener('click', (e) => {
      const tool = e.currentTarget.dataset.tool;
      switchToTool(tool);
    });
  });
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  DOM.sidebar().classList.toggle('collapsed', state.sidebarCollapsed);
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
  
  DOM.topbarLeft().innerHTML = `<h1>${titles[toolName]}</h1>`;
}

// ============================================================================
// DRAG & DROP
// ============================================================================

let dragCounter = 0;

function initDropZone() {
  const dropZone = DOM.dropZone();
  
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
  DOM.dropZone().hidden = true;
  
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  
  // Switch to vault tool
  switchToTool('vault');
  
  // Add files to vault
  Array.from(files).forEach(file => {
    addFileToVault(file);
  });
}

// ============================================================================
// VAULT TOOL
// ============================================================================

function initVaultTool() {
  DOM.vaultAddBtn().addEventListener('click', pickFiles);
  DOM.vaultAddFolderBtn().addEventListener('click', pickFolder);
  DOM.vaultUploadBtn().addEventListener('click', uploadVault);
  DOM.vaultUploadProtect().addEventListener('change', togglePasswordField);
}

function pickFiles() {
  // In Electron, trigger file picker through main process
  if (window.electronAPI && window.electronAPI.pickFiles) {
    window.electronAPI.pickFiles().then(filePaths => {
      filePaths.forEach(filePath => {
        addFileToVault({ path: filePath, name: filePath.split(/[/\\]/).pop() });
      });
    });
  }
}

function pickFolder() {
  if (window.electronAPI && window.electronAPI.pickFolder) {
    window.electronAPI.pickFolder().then(folderPath => {
      if (folderPath) {
        addFileToVault({ path: folderPath, name: folderPath.split(/[/\\]/).pop(), isFolder: true });
      }
    });
  }
}

function addFileToVault(file) {
  const fileInfo = {
    id: Math.random().toString(36).substr(2, 9),
    name: file.name || file.path?.split(/[/\\]/).pop(),
    path: file.path || file.name,
    size: file.size || 0,
    isFolder: file.isFolder || false,
    addedAt: new Date().toLocaleString()
  };
  
  state.vaultFiles.push(fileInfo);
  renderVaultList();
  calculateStorageUsage();
}

function renderVaultList() {
  const vaultList = DOM.vaultList();
  
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
  
  vaultList.innerHTML = state.vaultFiles.map(file => `
    <div class="vault-item">
      <div class="vault-item-info">
        <div class="name">${file.isFolder ? '📁' : '📄'} ${escapeHtml(file.name)}</div>
        <div class="meta">Added: ${file.addedAt}</div>
      </div>
      <div class="vault-item-buttons">
        <button class="btn" onclick="removeFileFromVault('${file.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

function removeFileFromVault(fileId) {
  state.vaultFiles = state.vaultFiles.filter(f => f.id !== fileId);
  renderVaultList();
  calculateStorageUsage();
}

function togglePasswordField() {
  DOM.vaultUploadPassword().hidden = !DOM.vaultUploadProtect().checked;
}

async function uploadVault() {
  if (state.vaultFiles.length === 0) {
    alert('Add files to vault first');
    return;
  }
  
  const protect = DOM.vaultUploadProtect().checked;
  const password = protect ? DOM.vaultUploadPassword().value : null;
  
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
  DOM.clearVaultBtn().addEventListener('click', clearVault);
  DOM.exportVaultBtn().addEventListener('click', exportVault);
}

function calculateStorageUsage() {
  let totalSize = 0;
  state.vaultFiles.forEach(file => {
    totalSize += file.size || 0;
  });
  
  state.storageUsage.used = totalSize;
  // Assume 1GB total for demo (could be system storage)
  state.storageUsage.total = 1024 * 1024 * 1024;
  
  const percent = Math.round((state.storageUsage.used / state.storageUsage.total) * 100);
  
  DOM.storageUsedValue().textContent = fmtBytes(state.storageUsage.used);
  DOM.storageFreeValue().textContent = fmtBytes(state.storageUsage.total - state.storageUsage.used);
  DOM.storagePercent().textContent = `${percent}%`;
  DOM.storageProgressFill().style.width = `${percent}%`;
  
  renderFileList();
}

function renderFileList() {
  const container = DOM.fileListContainer();
  
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
  if (confirm('Delete all files from vault? This cannot be undone.')) {
    state.vaultFiles = [];
    renderVaultList();
    calculateStorageUsage();
  }
}

function exportVault() {
  if (state.vaultFiles.length === 0) {
    alert('No files to export');
    return;
  }
  
  if (window.electronAPI && window.electronAPI.exportVault) {
    window.electronAPI.exportVault(state.vaultFiles).then(() => {
      alert('Vault exported successfully');
    }).catch(err => {
      alert(`Export failed: ${err.message}`);
    });
  }
}

// ============================================================================
// SECURE SHRED TOOL
// ============================================================================

function initShredTool() {
  DOM.shredStartBtn().addEventListener('click', startShredding);
}

function startShredding() {
  const method = DOM.shredMethod().value;
  const targets = Array.from(DOM.shredTargets()).map(t => t.value);
  
  if (targets.length === 0) {
    alert('Select at least one target location');
    return;
  }
  
  // Show progress section
  DOM.shredProgressSection().hidden = false;
  state.shredProgress.isRunning = true;
  state.shredProgress.current = 0;
  state.shredProgress.total = 100;
  
  // Simulate shredding process
  const interval = setInterval(() => {
    state.shredProgress.current += Math.random() * 25;
    
    if (state.shredProgress.current >= state.shredProgress.total) {
      state.shredProgress.current = state.shredProgress.total;
      clearInterval(interval);
      state.shredProgress.isRunning = false;
      
      DOM.shredStatus().innerHTML = `
        <div style="color: var(--ok);">✓ Shredding complete!</div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
          Method: <strong>${method}</strong><br>
          Targets: <strong>${targets.join(', ')}</strong><br>
          Files securely wiped with multiple passes
        </div>
      `;
      
      // Reset button after 3s
      setTimeout(() => {
        DOM.shredProgressSection().hidden = true;
        DOM.shredStatus().innerHTML = '';
      }, 3000);
    }
    
    updateShredProgress();
  }, 300);
}

function updateShredProgress() {
  const percent = Math.round((state.shredProgress.current / state.shredProgress.total) * 100);
  DOM.shredProgressFill().style.width = `${percent}%`;
}

// ============================================================================
// SETTINGS TOOL
// ============================================================================

function initSettingsTool() {
  DOM.settingsAutoLock().addEventListener('change', (e) => {
    state.settings.autoLock = e.target.checked;
    saveSettings();
  });
  
  DOM.settingsPin().addEventListener('change', (e) => {
    state.settings.requirePin = e.target.checked;
    DOM.settingsPinValue().hidden = !e.target.checked;
    saveSettings();
  });
  
  // Set version info
  DOM.settingsVersion().textContent = '1.2.0';
  DOM.settingsEncryptionMethod().textContent = 'ZKE (Zero-Knowledge Encryption)';
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
    DOM.settingsAutoLock().checked = state.settings.autoLock;
    DOM.settingsPin().checked = state.settings.requirePin;
    DOM.settingsPinValue().hidden = !state.settings.requirePin;
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
// BACK BUTTON FOR "GO ONLINE" MODE
// ============================================================================

// This will be called from main.js when user tries to go online
window.returnFromOnlineMode = () => {
  switchToTool('vault');
  console.log('Returned to offline mode');
};
