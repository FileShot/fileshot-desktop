/* ═══════════════════════════════════════════════════════════════════════════
   FileShot Desktop V2 — Renderer Application
   All UI logic, wired to real IPC calls via window.fileshot.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const api = window.fileshot;

  /* ─── Helpers ──────────────────────────────────────────────────────────── */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  function formatBytes(b) {
    if (b == null || isNaN(b) || b === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
    return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }

  function relativeDate(d) {
    const now = Date.now();
    const ts = typeof d === 'string' ? new Date(d).getTime() : (typeof d === 'number' ? d : NaN);
    if (isNaN(ts)) return '—';
    const diff = now - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function fileTypeClass(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) return 'img';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'].includes(ext)) return 'vid';
    if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'].includes(ext)) return 'audio';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archive';
    if (['doc', 'docx', 'pdf', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(ext)) return 'doc';
    return '';
  }

  function fileIconSvg(name) {
    const cls = fileTypeClass(name);
    const c = {
      img: '#9fa3ad', vid: '#a855f7', audio: '#ec4899',
      archive: '#f59e0b', doc: '#10b981', '': '#fa3800'
    }[cls];
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ─── State ────────────────────────────────────────────────────────────── */
  const state = {
    user: null,
    currentView: 'dashboard',
    files: [],
    folders: [],
    usage: { usage: 0, limit: 0, tier: 'free' },
    vaultItems: [],
    settings: {},
    filesViewMode: 'list',
    activeFolder: '',
    searchQuery: '',
    shredPaths: [],
    uploadResults: [],
    driveStatus: { mounted: false, letter: 'F', winfspInstalled: false },
    selectedFiles: new Set(),
    driveShareUrls: {}
  };

  /* ─── Toast Notification ───────────────────────────────────────────────── */
  function toast(msg, type) {
    type = type || 'info';
    const c = $('#toastContainer');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span>${escHtml(msg)}</span><button class="toast-close">&times;</button>`;
    c.appendChild(el);
    el.querySelector('.toast-close').onclick = () => el.remove();
    setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
  }

  /* ─── View Router ──────────────────────────────────────────────────────── */
  function switchView(view) {
    state.currentView = view;

    // Update sidebar active
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));

    // Show/hide views
    $$('.view').forEach(v => {
      v.hidden = v.id !== 'view-' + view;
    });

    // On-enter hooks
    switch (view) {
      case 'dashboard': loadDashboard(); break;
      case 'upload': break;
      case 'files': loadFiles(); break;
      case 'vault': loadVault(); break;
      case 'shredder': break;
      case 'drive': loadDrive(); break;
      case 'settings': loadSettings(); break;
    }
  }

  /* ─── Auth ─────────────────────────────────────────────────────────────── */
  let authMode = 'login';

  function setupAuth() {
    // Tab switching
    $$('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        authMode = tab.dataset.tab;
        $$('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
        const isReg = authMode === 'register';
        $('#confirmGroup').hidden = !isReg;
        $('#authSubmit .btn-text').textContent = isReg ? 'Create Account' : 'Sign In';
        $('#authPassword').autocomplete = isReg ? 'new-password' : 'current-password';
        $('#authError').hidden = true;
      });
    });

    // Form submission
    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#authEmail').value.trim();
      const pw = $('#authPassword').value;
      const confirm = $('#authConfirm').value;

      if (!email || !pw) return showAuthError('Please fill in all fields');
      if (authMode === 'register' && pw !== confirm) return showAuthError('Passwords do not match');
      if (pw.length < 6) return showAuthError('Password must be at least 6 characters');

      setAuthLoading(true);
      $('#authError').hidden = true;

      try {
        const result = authMode === 'login'
          ? await api.auth.login(email, pw)
          : await api.auth.register(email, pw);

        if (!result.ok) {
          showAuthError(result.error || 'Authentication failed');
          setAuthLoading(false);
          return;
        }

        state.user = result.user || {};
        if (result.user?.email) state.user.email = result.user.email;
        else state.user.email = email;
        showApp();
        toast('Signed in successfully', 'success');
      } catch (err) {
        showAuthError(err.message || 'Connection error');
      }
      setAuthLoading(false);
    });

    // Forgot password
    $('#authForgot').addEventListener('click', (e) => {
      e.preventDefault();
      api.shell.open('https://fileshot.io/forgot-password');
    });

    // OAuth buttons
    $('#btnGoogleLogin').addEventListener('click', () => doOAuth('google'));
    $('#btnGithubLogin').addEventListener('click', () => doOAuth('github'));
  }

  async function doOAuth(provider) {
    setAuthLoading(true);
    $('#authError').hidden = true;
    try {
      const result = await api.auth.oauth(provider);
      if (result.ok) {
        state.user = result.user || {};
        if (result.user?.email) state.user.email = result.user.email;
        showApp();
        toast('Signed in with ' + provider.charAt(0).toUpperCase() + provider.slice(1), 'success');
      } else if (result.error && result.error !== 'OAuth window closed') {
        showAuthError(result.error);
      }
    } catch (err) {
      showAuthError(err.message || 'OAuth failed');
    }
    setAuthLoading(false);
  }

  function showAuthError(msg) {
    const el = $('#authError');
    el.textContent = msg;
    el.hidden = false;
  }

  function setAuthLoading(on) {
    $('#authSubmit').disabled = on;
    $('#authSubmit .btn-text').hidden = on;
    $('#authSubmit .btn-loader').hidden = !on;
  }

  function showAuth() {
    $('#authScreen').hidden = false;
    $('#appScreen').hidden = true;
    state.user = null;
  }

  async function showApp() {
    $('#authScreen').hidden = true;
    $('#appScreen').hidden = false;

    // Load user info if not set
    if (!state.user || !state.user.email) {
      const check = await api.auth.check();
      if (check.loggedIn) {
        state.user = { email: check.email };
        const me = await api.auth.me();
        if (me.ok && me.user) {
          state.user = { ...state.user, ...me.user };
        }
      } else {
        showAuth();
        return;
      }
    }

    updateUserUI();
    switchView('dashboard');
  }

  function updateUserUI() {
    const email = state.user?.email || 'user@email.com';
    $('#userEmail').textContent = email;
    $('#userAvatar').textContent = (email[0] || 'U').toUpperCase();
    $('#accountEmail').textContent = email;
  }

  /* ─── Titlebar ─────────────────────────────────────────────────────────── */
  function setupTitlebar() {
    $('#btnMin').addEventListener('click', () => api.win.minimize());
    $('#btnMax').addEventListener('click', () => api.win.maximize());
    $('#btnClose').addEventListener('click', () => api.win.close());

    api.win.onMaximizedChange((isMax) => {
      const svg = isMax
        ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0" y="2" width="8" height="8" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1"/></svg>'
        : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
      $('#btnMax').innerHTML = svg;
    });

    // Show version
    api.app.version().then(v => { $('#titlebarVersion').textContent = 'v' + v; });
  }

  /* ─── Sidebar ──────────────────────────────────────────────────────────── */
  function setupSidebar() {
    // Navigation
    $$('.nav-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Collapse toggle
    $('#sidebarToggle').addEventListener('click', () => {
      $('#sidebar').classList.toggle('collapsed');
    });

    // Logout
    $('#btnLogout').addEventListener('click', async () => {
      await api.auth.logout();
      state.user = null;
      state.files = [];
      state.folders = [];
      showAuth();
      toast('Signed out', 'info');
    });
  }

  /* ─── Storage helper ───────────────────────────────────────────────────── */
  async function loadStorageUsage() {
    const data = await api.storage.usage();
    if (data.ok !== false) {
      state.usage = {
        usage: data.usage || 0,
        limit: data.limit || 0,
        tier: data.tier || 'free'
      };
    }
    updateStorageUI();
  }

  function updateStorageUI() {
    const { usage, limit, tier } = state.usage;
    const pct = limit > 0 ? Math.min(Math.round((usage / limit) * 100), 100) : 0;

    // Sidebar mini bar
    $('#storageFill').style.width = pct + '%';
    $('#storageText').textContent = `${formatBytes(usage)} / ${limit > 0 ? formatBytes(limit) : '∞'}`;

    // Dashboard ring
    const arc = $('#storageArc');
    if (arc) {
      const circum = 326.73;
      arc.style.strokeDashoffset = circum - (circum * pct / 100);
      arc.style.transition = 'stroke-dashoffset 800ms ease';
    }
    const el = (id) => document.getElementById(id);
    if (el('storagePercent')) el('storagePercent').textContent = pct + '%';
    if (el('storageUsed')) el('storageUsed').textContent = formatBytes(usage);
    if (el('storageAvail')) el('storageAvail').textContent = limit > 0 ? formatBytes(limit - usage) : '∞';
    if (el('storageTotal')) el('storageTotal').textContent = limit > 0 ? formatBytes(limit) : '∞';
    if (el('tierBadge')) el('tierBadge').textContent = (tier || 'free').charAt(0).toUpperCase() + (tier || 'free').slice(1);
  }

  /* ─── Dashboard ────────────────────────────────────────────────────────── */
  async function loadDashboard() {
    await loadStorageUsage();

    // Account info
    const me = await api.auth.me();
    if (me.ok && me.user) {
      state.user = { ...state.user, ...me.user };
      updateUserUI();
      const u = me.user;
      $('#accountPlan').textContent = (u.tier || u.plan || state.usage.tier || 'free').charAt(0).toUpperCase() + (u.tier || u.plan || state.usage.tier || 'free').slice(1);
    }

    // Recent files
    await loadFilesData();
    renderRecentFiles();

    // File count
    $('#accountFileCount').textContent = String(state.files.length);

    // Quick actions
    $$('.qa-btn').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === 'upload') switchView('upload');
        else if (action === 'vault') switchView('vault');
        else if (action === 'drive') switchView('drive');
        else if (action === 'website') api.shell.open('https://fileshot.io');
      };
    });

    // View all files
    $('#btnViewAllFiles').onclick = () => switchView('files');

    // Upgrade
    $('#btnUpgrade').onclick = (e) => {
      e.preventDefault();
      api.shell.open('https://fileshot.io/pricing');
    };
  }

  function renderRecentFiles() {
    const recent = state.files.slice(0, 8);
    const list = $('#recentFilesList');

    if (recent.length === 0) {
      list.innerHTML = '<div class="empty-state small"><p>No files yet</p></div>';
      return;
    }

    list.innerHTML = recent.map(f => {
      const name = f.originalFileName || f.fileName || f.name || 'file';
      const cls = fileTypeClass(name);
      return `<div class="recent-item" data-id="${escHtml(f.fileId || f.id || '')}">
        <div class="file-icon ${cls}">${fileIconSvg(name)}</div>
        <span class="name">${escHtml(name)}</span>
        <span class="meta">${formatBytes(f.originalFileSize || f.fileSize || f.size || 0)}</span>
        <span class="actions">
          <button class="btn-icon" data-act="download" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="btn-icon" data-act="share" title="Share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
        </span>
      </div>`;
    }).join('');

    // Wire actions
    list.querySelectorAll('.recent-item').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-act="download"]')?.addEventListener('click', (e) => { e.stopPropagation(); downloadFile(id, row.querySelector('.name').textContent); });
      row.querySelector('[data-act="share"]')?.addEventListener('click', (e) => { e.stopPropagation(); openShareModal(id); });
    });
  }

  /* ─── Files Data ───────────────────────────────────────────────────────── */
  async function loadFilesData() {
    const res = await api.files.list();
    if (res.ok !== false) {
      state.files = (res.files || []).sort((a, b) => {
        const da = new Date(a.createdAt || a.uploadedAt || 0).getTime();
        const db = new Date(b.createdAt || b.uploadedAt || 0).getTime();
        return db - da;
      });
    }
  }

  /* ─── My Files View ────────────────────────────────────────────────────── */
  async function loadFiles() {
    await Promise.all([loadFilesData(), loadFolders()]);
    renderFolderBar();
    renderFiles();
  }

  async function loadFolders() {
    const res = await api.folders.list();
    if (res.ok !== false) {
      state.folders = res.folders || [];
    }
  }

  function renderFolderBar() {
    const tabs = $('#folderTabs');
    tabs.innerHTML = state.folders.map(f => {
      const id = f.id || f._id || '';
      const name = f.name || 'Folder';
      return `<button class="folder-tab${state.activeFolder === id ? ' active' : ''}" data-folder="${escHtml(id)}">${escHtml(name)}</button>`;
    }).join('');

    // All Files tab
    const allTab = $('[data-folder=""]');
    if (allTab) allTab.classList.toggle('active', !state.activeFolder);

    // Click handlers
    $$('.folder-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeFolder = btn.dataset.folder;
        $$('.folder-tab').forEach(t => t.classList.toggle('active', t.dataset.folder === state.activeFolder));
        renderFiles();
      });
    });

    // New folder
    $('#btnNewFolder').onclick = async () => {
      const name = prompt('Folder name:');
      if (!name || !name.trim()) return;
      const res = await api.folders.create(name.trim());
      if (res.ok !== false) {
        toast('Folder created', 'success');
        await loadFolders();
        renderFolderBar();
      } else {
        toast(res.error || 'Failed to create folder', 'error');
      }
    };
  }

  function renderFiles() {
    let filtered = state.files;

    // Folder filter
    if (state.activeFolder) {
      filtered = filtered.filter(f => f.folderId === state.activeFolder);
    }

    // Search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(f => {
        const name = (f.originalFileName || f.fileName || f.name || '').toLowerCase();
        return name.includes(q);
      });
    }

    const list = $('#filesList');
    const empty = $('#filesEmpty');

    if (filtered.length === 0) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;

    if (state.filesViewMode === 'list') {
      list.className = 'files-list';
      list.innerHTML = filtered.map(f => renderFileRow(f)).join('');
    } else {
      list.className = 'files-list grid';
      list.innerHTML = filtered.map(f => renderFileRow(f)).join('');
    }

    wireFileActions(list);
  }

  function renderFileRow(f) {
    const name = f.originalFileName || f.fileName || f.name || 'file';
    const id = f.fileId || f.id || f._id || '';
    const size = f.originalFileSize || f.fileSize || f.size || 0;
    const date = f.createdAt || f.uploadedAt || f.updatedAt || '';
    const cls = fileTypeClass(name);
    const checked = state.selectedFiles && state.selectedFiles.has(id) ? 'checked' : '';

    return `<div class="file-row ${checked ? 'selected' : ''}" data-id="${escHtml(id)}" data-name="${escHtml(name)}">
      <input type="checkbox" class="file-checkbox" data-id="${escHtml(id)}" ${checked} />
      <div class="file-icon ${cls}">${fileIconSvg(name)}</div>
      <span class="file-name" title="${escHtml(name)}">${escHtml(name)}</span>
      <span class="file-size">${formatBytes(size)}</span>
      <span class="file-date">${relativeDate(date)}</span>
      <span class="file-actions">
        <button class="btn-icon" data-act="preview" title="Preview"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="btn-icon" data-act="download" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <button class="btn-icon" data-act="share" title="Share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
        <button class="btn-icon" data-act="delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </span>
    </div>`;
  }

  function wireFileActions(container) {
    container.querySelectorAll('.file-row').forEach(row => {
      const id = row.dataset.id;
      const name = row.dataset.name || row.querySelector('.file-name')?.textContent || 'file';

      // Checkbox selection
      const cb = row.querySelector('.file-checkbox');
      if (cb) {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleFileSelection(id, cb.checked);
          row.classList.toggle('selected', cb.checked);
        });
      }

      // Click row to toggle selection (but not on buttons/links)
      row.addEventListener('click', (e) => {
        if (e.target.closest('.file-actions') || e.target.closest('.file-checkbox')) return;
        if (cb) {
          cb.checked = !cb.checked;
          toggleFileSelection(id, cb.checked);
          row.classList.toggle('selected', cb.checked);
        }
      });

      row.querySelector('[data-act="preview"]')?.addEventListener('click', (e) => { e.stopPropagation(); previewFile(id, name); });
      row.querySelector('[data-act="download"]')?.addEventListener('click', (e) => { e.stopPropagation(); downloadFile(id, name); });
      row.querySelector('[data-act="share"]')?.addEventListener('click', (e) => { e.stopPropagation(); openShareModal(id); });
      row.querySelector('[data-act="delete"]')?.addEventListener('click', (e) => { e.stopPropagation(); deleteFile(id, name); });
    });
  }

  /* ─── Multi-Select ─────────────────────────────────────────────────────── */

  function toggleFileSelection(id, selected) {
    if (selected) {
      state.selectedFiles.add(id);
    } else {
      state.selectedFiles.delete(id);
    }
    updateSelectionBar();
  }

  function clearSelection() {
    state.selectedFiles.clear();
    document.querySelectorAll('.file-checkbox').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('.file-row.selected').forEach(r => r.classList.remove('selected'));
    updateSelectionBar();
  }

  function updateSelectionBar() {
    let bar = $('#selectionBar');
    if (!bar) {
      // Create it once, insert before filesList
      bar = document.createElement('div');
      bar.id = 'selectionBar';
      bar.className = 'selection-bar';
      bar.hidden = true;
      bar.innerHTML = `
        <span class="selection-count"></span>
        <button class="btn btn-sm btn-ghost" id="selBtnSelectAll">Select All</button>
        <button class="btn btn-sm btn-ghost" id="selBtnClear">Clear</button>
        <button class="btn btn-sm btn-primary" id="selBtnDownload">Download</button>
        <button class="btn btn-sm btn-danger" id="selBtnDelete">Delete</button>
      `;
      const container = $('#filesContainer');
      container.insertBefore(bar, container.firstChild);

      // Wire buttons
      $('#selBtnSelectAll').addEventListener('click', () => {
        state.files.forEach(f => {
          const fid = f.fileId || f.id || f._id;
          if (fid) state.selectedFiles.add(fid);
        });
        document.querySelectorAll('.file-checkbox').forEach(cb => { cb.checked = true; });
        document.querySelectorAll('.file-row').forEach(r => r.classList.add('selected'));
        updateSelectionBar();
      });
      $('#selBtnClear').addEventListener('click', clearSelection);
      $('#selBtnDownload').addEventListener('click', async () => {
        const ids = [...state.selectedFiles];
        for (const fid of ids) {
          const f = state.files.find(x => (x.fileId || x.id || x._id) === fid);
          const fn = f?.originalFileName || f?.fileName || f?.name || 'file';
          await downloadFile(fid, fn);
        }
      });
      $('#selBtnDelete').addEventListener('click', async () => {
        const ids = [...state.selectedFiles];
        if (!confirm(`Delete ${ids.length} file${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
        let deleted = 0;
        for (const fid of ids) {
          const res = await api.files.delete(fid);
          if (res.ok !== false) deleted++;
        }
        state.files = state.files.filter(f => !state.selectedFiles.has(f.fileId || f.id || f._id));
        clearSelection();
        renderFiles();
        toast(`${deleted} file${deleted > 1 ? 's' : ''} deleted`, 'success');
        await loadStorageUsage();
      });
    }

    const count = state.selectedFiles.size;
    bar.hidden = count === 0;
    const countEl = bar.querySelector('.selection-count');
    if (countEl) countEl.textContent = `${count} selected`;
  }

  /* ─── File Preview ─────────────────────────────────────────────────────── */
  async function previewFile(fileId, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const previewableExts = [
      'jpg','jpeg','png','gif','webp','svg','bmp','ico',
      'mp4','webm','ogg',
      'mp3','wav','flac','aac','m4a',
      'pdf',
      'txt','md','json','js','ts','css','html','xml','csv','py','c','h',
      'log','cfg','ini','yaml','yml','toml','sh','bat','ps1'
    ];

    if (!previewableExts.includes(ext)) {
      toast('Preview not available for this file type', 'info');
      return;
    }

    toast('Loading preview…', 'info');
    const result = await api.files.preview(fileId);
    if (!result.ok) {
      toast(result.error || 'Preview failed', 'error');
      return;
    }

    showPreviewModal(result, fileName);
  }

  function showPreviewModal(result, fallbackName) {
    // Remove existing preview modal
    let pm = $('#previewModal');
    if (pm) pm.remove();

    const fileName = result.fileName || fallbackName || 'file';
    const mime = result.mimeType || '';

    let contentHtml = '';
    if (mime.startsWith('image/')) {
      contentHtml = `<img src="${result.dataUrl}" alt="${escHtml(fileName)}" class="preview-image" />`;
    } else if (mime.startsWith('video/')) {
      contentHtml = `<video controls autoplay class="preview-video"><source src="${result.dataUrl}" type="${mime}" /></video>`;
    } else if (mime.startsWith('audio/')) {
      contentHtml = `<div class="preview-audio-wrap"><p>${escHtml(fileName)}</p><audio controls autoplay><source src="${result.dataUrl}" type="${mime}" /></audio></div>`;
    } else if (mime === 'application/pdf') {
      contentHtml = `<iframe src="${result.dataUrl}" class="preview-pdf"></iframe>`;
    } else if (mime.startsWith('text/')) {
      // Decode base64 text
      const text = atob(result.dataUrl.split(',')[1]);
      contentHtml = `<pre class="preview-text">${escHtml(text)}</pre>`;
    } else {
      contentHtml = `<p>Cannot preview this file type.</p>`;
    }

    pm = document.createElement('div');
    pm.id = 'previewModal';
    pm.className = 'modal-backdrop';
    pm.innerHTML = `
      <div class="modal glass-card modal-preview">
        <div class="modal-header">
          <h3 title="${escHtml(fileName)}">${escHtml(fileName)}</h3>
          <span class="preview-meta">${formatBytes(result.size || 0)}</span>
          <button class="btn-icon modal-close" id="previewModalClose">&times;</button>
        </div>
        <div class="modal-body preview-body">${contentHtml}</div>
      </div>
    `;
    document.body.appendChild(pm);

    $('#previewModalClose').addEventListener('click', () => pm.remove());
    pm.addEventListener('click', (e) => { if (e.target === pm) pm.remove(); });
    // Escape key
    const escHandler = (e) => { if (e.key === 'Escape') { pm.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
  }

  function setupFilesView() {
    // Search
    $('#filesSearch').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderFiles();
    });

    // View mode toggle
    $('#filesListView').addEventListener('click', () => {
      state.filesViewMode = 'list';
      $('#filesListView').classList.add('active');
      $('#filesGridView').classList.remove('active');
      renderFiles();
    });
    $('#filesGridView').addEventListener('click', () => {
      state.filesViewMode = 'grid';
      $('#filesGridView').classList.add('active');
      $('#filesListView').classList.remove('active');
      renderFiles();
    });

    // Refresh
    $('#btnRefreshFiles').addEventListener('click', async () => {
      await loadFiles();
      toast('Files refreshed', 'info');
    });

    // Empty state upload button
    $$('[data-action="upload"]').forEach(btn => {
      btn.addEventListener('click', () => switchView('upload'));
    });
  }

  /* ─── File Actions ─────────────────────────────────────────────────────── */
  async function downloadFile(fileId, fileName) {
    toast('Starting download...', 'info');
    const res = await api.files.download(fileId, fileName);
    if (res.ok) {
      toast('Download complete!', 'success');
    } else if (!res.canceled) {
      toast(res.error || 'Download failed', 'error');
    }
  }

  async function deleteFile(fileId, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const res = await api.files.delete(fileId);
    if (res.ok !== false) {
      state.files = state.files.filter(f => (f.fileId || f.id || f._id) !== fileId);
      renderFiles();
      toast('File deleted', 'success');
      await loadStorageUsage();
    } else {
      toast(res.error || 'Delete failed', 'error');
    }
  }

  /* ─── Share Modal ──────────────────────────────────────────────────────── */
  let shareFileId = null;
  let shareFileData = null;

  async function openShareModal(fileId) {
    shareFileId = fileId;
    const modal = $('#shareModal');
    modal.hidden = false;

    const file = state.files.find(f => (f.fileId || f.id || f._id) === fileId);
    const name = file?.originalFileName || file?.fileName || file?.name || 'file';
    $('#shareFileName').textContent = name;

    // Build share link — include ZKE key from keyring so it's accessible without password
    const baseUrl = 'https://fileshot.io/downloads.html';
    let shareLink = file?.shareUrl || `${baseUrl}?f=${encodeURIComponent(fileId)}`;

    // If the link doesn't already have a key fragment, look it up from keyring
    if (!shareLink.includes('#k=')) {
      try {
        const keyResult = await api.files.getKey(fileId);
        if (keyResult.ok && keyResult.rawKey) {
          shareLink += `#k=${encodeURIComponent(keyResult.rawKey)}`;
        }
      } catch (_) {}
    }

    $('#shareLinkInput').value = shareLink;

    // Set existing share settings
    if (file) {
      shareFileData = file;
      $('#shareExpiry').value = file.expiresInHours ? String(file.expiresInHours) : '';
      $('#shareMaxDl').value = file.maxDownloads ? String(file.maxDownloads) : '';
      $('#sharePassword').value = '';
    }

    // Load QR code
    const qrContainer = $('#shareQR');
    qrContainer.innerHTML = '<div class="qr-loading">Loading QR code...</div>';
    try {
      const qr = await api.files.qr(fileId);
      if (qr.ok && qr.dataUrl) {
        qrContainer.innerHTML = `<img src="${qr.dataUrl}" alt="QR Code" />`;
      } else {
        qrContainer.innerHTML = '<div class="qr-loading">QR code unavailable</div>';
      }
    } catch {
      qrContainer.innerHTML = '<div class="qr-loading">Failed to load QR code</div>';
    }
  }

  function setupShareModal() {
    // Close
    $('#shareModalClose').addEventListener('click', () => { $('#shareModal').hidden = true; });
    $('#shareModal').addEventListener('click', (e) => {
      if (e.target === $('#shareModal')) $('#shareModal').hidden = true;
    });

    // Copy link
    $('#shareCopyBtn').addEventListener('click', async () => {
      const link = $('#shareLinkInput').value;
      if (link) {
        await api.clipboard.write(link);
        toast('Link copied to clipboard!', 'success');
      }
    });

    // Update share settings
    $('#shareUpdateBtn').addEventListener('click', async () => {
      if (!shareFileId) return;
      const settings = {};
      const expiry = $('#shareExpiry').value;
      const maxDl = $('#shareMaxDl').value;
      const pw = $('#sharePassword').value;

      if (expiry) settings.expiresInHours = parseInt(expiry, 10);
      if (maxDl) settings.maxDownloads = parseInt(maxDl, 10);
      if (pw) settings.sharePassword = pw;

      const res = await api.files.update(shareFileId, settings);
      if (res.ok !== false) {
        toast('Share settings updated', 'success');
      } else {
        toast(res.error || 'Failed to update settings', 'error');
      }
    });
  }

  /* ─── Upload Center ────────────────────────────────────────────────────── */
  let uploadActive = false;

  function setupUpload() {
    const zone = $('#uploadZone');
    const pickBtn = $('#btnPickUpload');

    // Click to browse
    pickBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      startUploadFromDialog();
    });

    zone.addEventListener('click', () => {
      startUploadFromDialog();
    });

    // Drag events on upload zone
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleDroppedFiles(e);
    });

    // Upload progress listener
    api.upload.onProgress((data) => {
      updateUploadProgress(data);
    });

    // Trigger from tray / external
    api.upload.onTrigger((paths) => {
      if (paths && paths.length) {
        switchView('upload');
        startUpload(paths);
      }
    });
  }

  async function startUploadFromDialog() {
    if (uploadActive) return;
    const files = await api.dialog.openFiles();
    if (files && files.length > 0) {
      startUpload(files);
    }
  }

  async function startUpload(filePaths) {
    if (uploadActive) return;
    uploadActive = true;

    const queue = $('#uploadQueue');
    const list = $('#uploadList');
    queue.hidden = false;
    $('#uploadSummary').textContent = filePaths.length + ' file' + (filePaths.length > 1 ? 's' : '');

    // Build queue UI
    list.innerHTML = filePaths.map((fp, i) => {
      const name = fp.split(/[\\/]/).pop();
      return `<div class="upload-item" data-index="${i}">
        <div class="upload-item-icon">${fileIconSvg(name)}</div>
        <div class="upload-item-info">
          <div class="upload-item-name">${escHtml(name)}</div>
          <div class="upload-item-status">Waiting...</div>
          <div class="upload-item-progress"><div class="upload-item-progress-fill"></div></div>
        </div>
      </div>`;
    }).join('');

    // Start upload via IPC
    try {
      const result = await api.upload.files(filePaths, {});
      state.uploadResults = result.results || [];

      // Show summary
      const succCount = state.uploadResults.filter(r => r.ok).length;
      const failCount = state.uploadResults.filter(r => !r.ok).length;

      if (failCount === 0) {
        toast(`${succCount} file${succCount > 1 ? 's' : ''} uploaded successfully!`, 'success');
      } else {
        toast(`${succCount} succeeded, ${failCount} failed`, failCount > 0 ? 'error' : 'info');
      }

      await loadStorageUsage();
    } catch (err) {
      toast(err.message || 'Upload failed', 'error');
    }

    uploadActive = false;
  }

  function updateUploadProgress(data) {
    const { index, name, percent, stage } = data;
    const item = $(`.upload-item[data-index="${index}"]`);
    if (!item) return;

    const status = item.querySelector('.upload-item-status');
    const fill = item.querySelector('.upload-item-progress-fill');

    if (percent < 0) {
      // Error
      status.textContent = stage || 'Failed';
      fill.className = 'upload-item-progress-fill error';
      fill.style.width = '100%';
    } else if (percent >= 100) {
      status.textContent = 'Complete';
      fill.className = 'upload-item-progress-fill done';
      fill.style.width = '100%';
    } else {
      status.textContent = stage || `${percent}%`;
      fill.style.width = percent + '%';
    }
  }

  /* ─── Global Drop Zone ─────────────────────────────────────────────────── */
  function setupGlobalDrop() {
    let dragCounter = 0;
    const overlay = $('#dropOverlay');
    const content = $('#contentArea');

    content.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) overlay.hidden = false;
    });

    content.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; overlay.hidden = true; }
    });

    content.addEventListener('dragover', (e) => e.preventDefault());

    content.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      overlay.hidden = true;
      handleDroppedFiles(e);
    });
  }

  function handleDroppedFiles(e) {
    const items = e.dataTransfer?.files;
    if (!items || items.length === 0) return;
    const paths = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].path) paths.push(items[i].path);
    }
    if (paths.length > 0) {
      switchView('upload');
      startUpload(paths);
    }
  }

  /* ─── Local Vault ──────────────────────────────────────────────────────── */
  let vaultPwCallback = null;

  async function loadVault() {
    const data = await api.vault.list();
    state.vaultItems = data.items || [];
    renderVault();
  }

  function renderVault() {
    const list = $('#vaultList');
    const empty = $('#vaultEmpty');

    if (state.vaultItems.length === 0) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.innerHTML = state.vaultItems.map(item => {
      const cls = fileTypeClass(item.name);
      return `<div class="vault-item" data-id="${escHtml(item.id)}">
        <div class="vault-item-icon file-icon ${cls}">${fileIconSvg(item.name)}</div>
        <div class="vault-item-info">
          <div class="vault-item-name">${escHtml(item.name)}</div>
          <div class="vault-item-meta">${formatBytes(item.originalSize || item.size)} • Added ${relativeDate(item.addedAt)}</div>
        </div>
        <div class="vault-item-actions">
          <button class="btn-icon" data-act="open" title="Decrypt & Open"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="btn-icon" data-act="export" title="Decrypt & Save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="btn-icon" data-act="upload" title="Decrypt & Upload"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
          <button class="btn-icon" data-act="remove" title="Remove from Vault"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>`;
    }).join('');

    // Wire actions
    list.querySelectorAll('.vault-item').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-act="open"]')?.addEventListener('click', () => vaultAction(id, 'open'));
      row.querySelector('[data-act="export"]')?.addEventListener('click', () => vaultAction(id, 'export'));
      row.querySelector('[data-act="upload"]')?.addEventListener('click', () => vaultAction(id, 'upload'));
      row.querySelector('[data-act="remove"]')?.addEventListener('click', () => vaultRemove(id));
    });
  }

  function setupVault() {
    const addFiles = async () => {
      const files = await api.dialog.openFiles();
      if (!files || files.length === 0) return;
      openVaultPasswordModal('Set Encryption Password', 'Choose a password to encrypt these files.', true, async (pw) => {
        const res = await api.vault.add(files, pw);
        if (res.ok !== false) {
          toast(`${(res.added || []).length} file(s) added to vault`, 'success');
          await loadVault();
        } else {
          toast(res.error || 'Failed to add files', 'error');
        }
      });
    };

    $('#btnVaultAdd').addEventListener('click', addFiles);
    $('#btnVaultAddEmpty')?.addEventListener('click', addFiles);

    // Listen for vault updates from main process
    api.vault.onUpdated(() => loadVault());
  }

  function vaultAction(id, action) {
    const title = action === 'open' ? 'Decrypt & Open' : action === 'export' ? 'Decrypt & Save' : 'Decrypt & Upload';
    openVaultPasswordModal(title, 'Enter the password used when encrypting this file.', false, async (pw) => {
      let res;
      if (action === 'open') res = await api.vault.open(id, pw);
      else if (action === 'export') res = await api.vault.export(id, pw);
      else if (action === 'upload') res = await api.vault.upload(id, pw);

      if (res && res.ok !== false) {
        if (action === 'open') toast('File opened', 'success');
        else if (action === 'export') toast('File exported', 'success');
        else toast('File uploaded from vault', 'success');
      } else {
        toast(res?.error || 'Operation failed — wrong password?', 'error');
      }
    });
  }

  async function vaultRemove(id) {
    const item = state.vaultItems.find(i => i.id === id);
    if (!confirm(`Remove "${item?.name || 'file'}" from vault? The encrypted file will be deleted.`)) return;
    const res = await api.vault.remove(id);
    if (res.ok !== false) {
      toast('Removed from vault', 'success');
      await loadVault();
    } else {
      toast(res.error || 'Failed to remove', 'error');
    }
  }

  /* ─── Vault Password Modal ────────────────────────────────────────────── */
  function openVaultPasswordModal(title, desc, showConfirm, callback) {
    const modal = $('#vaultPwModal');
    modal.hidden = false;
    $('#vaultPwTitle').textContent = title;
    $('#vaultPwDesc').textContent = desc;
    $('#vaultPwInput').value = '';
    $('#vaultPwConfirm').value = '';
    $('#vaultPwConfirmGroup').hidden = !showConfirm;
    $('#vaultPwError').hidden = true;
    vaultPwCallback = callback;

    setTimeout(() => $('#vaultPwInput').focus(), 100);
  }

  function setupVaultPwModal() {
    const close = () => { $('#vaultPwModal').hidden = true; vaultPwCallback = null; };
    $('#vaultPwClose').addEventListener('click', close);
    $('#vaultPwModal').addEventListener('click', (e) => {
      if (e.target === $('#vaultPwModal')) close();
    });

    $('#vaultPwSubmit').addEventListener('click', () => {
      const pw = $('#vaultPwInput').value;
      if (!pw) { $('#vaultPwError').textContent = 'Password required'; $('#vaultPwError').hidden = false; return; }
      if (!$('#vaultPwConfirmGroup').hidden) {
        const confirm = $('#vaultPwConfirm').value;
        if (pw !== confirm) { $('#vaultPwError').textContent = 'Passwords do not match'; $('#vaultPwError').hidden = false; return; }
      }
      close();
      if (vaultPwCallback) vaultPwCallback(pw);
    });

    // Enter key
    $('#vaultPwInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#vaultPwSubmit').click(); });
    $('#vaultPwConfirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#vaultPwSubmit').click(); });
  }

  /* ─── File Shredder ────────────────────────────────────────────────────── */
  function setupShredder() {
    state.shredPaths = [];
    renderShredPaths();

    $('#btnShredAddFiles').addEventListener('click', async () => {
      const files = await api.dialog.openFiles();
      if (files && files.length) {
        state.shredPaths.push(...files);
        renderShredPaths();
      }
    });

    $('#btnShredAddFolder').addEventListener('click', async () => {
      const folder = await api.dialog.openFolder();
      if (folder) {
        state.shredPaths.push(folder);
        renderShredPaths();
      }
    });

    $('#btnShredStart').addEventListener('click', startShred);

    // Shred progress listener
    api.shred.onProgress((data) => {
      updateShredProgress(data);
    });
  }

  function renderShredPaths() {
    const container = $('#shredPaths');
    if (state.shredPaths.length === 0) {
      container.innerHTML = '<div class="empty-hint">No custom paths added</div>';
      return;
    }
    container.innerHTML = state.shredPaths.map((p, i) => {
      const short = p.length > 60 ? '...' + p.slice(-57) : p;
      return `<div class="shred-path-item" data-index="${i}">
        <span title="${escHtml(p)}">${escHtml(short)}</span>
        <button class="btn-icon shred-path-remove" data-index="${i}" title="Remove">
          <svg width="12" height="12" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>`;
    }).join('');

    container.querySelectorAll('.shred-path-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        state.shredPaths.splice(parseInt(btn.dataset.index, 10), 1);
        renderShredPaths();
      });
    });
  }

  async function startShred() {
    // Gather targets
    const targets = {};
    if ($('#shredDownloads').checked) targets.downloads = true;
    if ($('#shredTemp').checked) targets.temp = true;
    if ($('#shredBrowser').checked) targets.browserCache = true;

    if (state.shredPaths.length === 0 && !targets.downloads && !targets.temp && !targets.browserCache) {
      toast('Add at least one file, folder, or quick target to shred', 'error');
      return;
    }

    const method = $('input[name="shredMethod"]:checked')?.value || 'simple';

    if (!confirm('Are you sure? This will permanently destroy the selected files. This CANNOT be undone.')) return;

    // Show progress pane
    $('#shredProgress').hidden = false;
    $('#shredFill').style.width = '0%';
    $('#shredStatus').textContent = 'Starting...';
    $('#shredCount').textContent = '';
    $('#shredLog').innerHTML = '';

    try {
      const res = await api.shred.start(state.shredPaths, method, targets);
      if (res && res.ok !== false) {
        toast('Shredding complete', 'success');
      } else {
        toast(res?.error || 'Shredding failed', 'error');
      }
    } catch (err) {
      toast(err.message || 'Shred error', 'error');
    }
  }

  function updateShredProgress(data) {
    const { percent, current, total, file, status } = data;
    if (typeof percent === 'number') {
      $('#shredFill').style.width = Math.min(percent, 100) + '%';
    }
    if (status) $('#shredStatus').textContent = status;
    if (typeof current === 'number' && typeof total === 'number') {
      $('#shredCount').textContent = `${current} / ${total}`;
    }
    if (file) {
      const log = $('#shredLog');
      const line = document.createElement('div');
      line.textContent = `${status || 'Shredding'}: ${file}`;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
  }

  /* ─── Virtual Drive ────────────────────────────────────────────────────── */
  let drivePolling = null;

  async function loadDrive() {
    // Check WinFsp
    updateDriveUI('checking');
    try {
      const status = await api.drive.status();
      state.driveStatus = {
        mounted: status.mounted || false,
        letter: status.letter || 'F',
        winfspInstalled: status.winfspInstalled !== false,
        binaryExists: status.binaryExists !== false
      };
    } catch {
      state.driveStatus = { mounted: false, letter: 'F', winfspInstalled: false, binaryExists: false };
    }
    updateDriveUI();
  }

  function updateDriveUI(mode) {
    const statusEl = $('#driveStatusText');
    const winfspEl = $('#driveWinfspText');
    const mountBtn = $('#btnDriveMount');
    const unmountBtn = $('#btnDriveUnmount');
    const installBtn = $('#btnDriveInstallWinfsp');
    const letterSel = $('#driveLetter');
    const noteEl = $('#driveNote');

    if (mode === 'checking') {
      statusEl.innerHTML = '<span class="status-dot mounting"></span> Checking...';
      winfspEl.textContent = 'Checking...';
      mountBtn.hidden = true;
      unmountBtn.hidden = true;
      installBtn.hidden = true;
      return;
    }

    const { mounted, letter, winfspInstalled, binaryExists } = state.driveStatus;

    if (!winfspInstalled) {
      statusEl.innerHTML = '<span class="status-dot offline"></span> WinFsp Required';
      winfspEl.innerHTML = '<span style="color:var(--danger)">Not Installed</span>';
      mountBtn.hidden = true;
      unmountBtn.hidden = true;
      installBtn.hidden = false;
      noteEl.textContent = 'WinFsp is required to create a virtual drive. Click "Install WinFsp" to download and install it.';
      return;
    }

    winfspEl.innerHTML = '<span style="color:var(--success)">Installed</span>';
    installBtn.hidden = true;

    if (!binaryExists) {
      statusEl.innerHTML = '<span class="status-dot offline"></span> Drive Binary Missing';
      mountBtn.hidden = true;
      unmountBtn.hidden = true;
      noteEl.textContent = 'The drive binary could not be found. Please reinstall the app or contact support.';
      return;
    }

    if (mounted) {
      statusEl.innerHTML = `<span class="status-dot online"></span> Mounted (${letter}:)`;
      mountBtn.hidden = true;
      unmountBtn.hidden = false;
      noteEl.textContent = `Your FileShot drive is live at ${letter}:\\ — open it in File Explorer.`;
    } else {
      statusEl.innerHTML = '<span class="status-dot offline"></span> Not Mounted';
      mountBtn.hidden = false;
      unmountBtn.hidden = true;
      noteEl.textContent = 'Click "Mount Drive" to create a virtual drive in File Explorer with your FileShot files.';
    }

    // Letter select
    letterSel.value = letter || 'F';
  }

  function setupDrive() {
    // Mount
    $('#btnDriveMount').addEventListener('click', async () => {
      const letter = $('#driveLetter').value;
      await api.drive.setLetter(letter);
      toast('Mounting drive...', 'info');
      const res = await api.drive.mount();
      if (res && res.ok !== false) {
        state.driveStatus.mounted = true;
        state.driveStatus.letter = letter;
        updateDriveUI();
        toast(`Drive mounted at ${letter}:\\`, 'success');
      } else {
        toast(res?.error || 'Failed to mount drive', 'error');
      }
    });

    // Unmount
    $('#btnDriveUnmount').addEventListener('click', async () => {
      const res = await api.drive.unmount();
      if (res && res.ok !== false) {
        state.driveStatus.mounted = false;
        updateDriveUI();
        toast('Drive unmounted', 'success');
      } else {
        toast(res?.error || 'Failed to unmount', 'error');
      }
    });

    // Install WinFsp
    $('#btnDriveInstallWinfsp').addEventListener('click', async () => {
      toast('Starting WinFsp installation...', 'info');
      const res = await api.drive.installWinFsp();
      if (res && res.ok !== false) {
        toast('WinFsp installed — recheck status', 'success');
        await loadDrive();
      } else {
        toast(res?.error || 'WinFsp installation failed', 'error');
      }
    });

    // Drive letter change
    $('#driveLetter').addEventListener('change', async (e) => {
      await api.drive.setLetter(e.target.value);
    });

    // Listen for status changes from main
    api.drive.onStatusChanged(() => loadDrive());

    // Drive sync notifications
    api.drive.onUploadStarted(({ fileName }) => {
      toast(`Uploading ${fileName} to FileShot…`, 'info');
    });
    api.drive.onFileUploaded(({ fileName, fileId, shareUrl }) => {
      toast(`${fileName} uploaded to FileShot ✓`, 'success');
      // Store the shareUrl (with key) so it's available when the user clicks Share
      if (fileId && shareUrl) {
        state.driveShareUrls = state.driveShareUrls || {};
        state.driveShareUrls[fileId] = shareUrl;
      }
      loadFiles();   // refresh cloud files list
    });
    api.drive.onUploadError(({ fileName, error }) => {
      toast(`Upload failed: ${fileName} — ${error}`, 'error');
    });
    api.drive.onPopulated(({ folders, files, skipped, errored }) => {
      let msg = `Drive synced: ${files} file${files !== 1 ? 's' : ''}, ${folders} folder${folders !== 1 ? 's' : ''}`;
      if (skipped > 0) msg += ` (${skipped} skipped — no local key)`;
      if (errored > 0) msg += ` (${errored} failed)`;
      toast(msg, errored > 0 ? 'warning' : 'info');
    });
  }

  /* ─── Settings ─────────────────────────────────────────────────────────── */
  async function loadSettings() {
    const s = await api.settings.get();
    state.settings = s || {};

    // Apply to UI
    $('#setStartOnLogin').checked = !!s.startOnLogin;
    $('#setMinToTray').checked = !!s.minimizeToTray;
    $('#setNotifications').checked = s.notifications !== false;
    $('#setEncryption').value = s.defaultEncryption || 'zke';
    $('#setDownloadPathDisplay').textContent = s.downloadPath || 'Default downloads folder';

    // About info
    const ver = await api.app.version();
    $('#aboutVersion').textContent = ver || '2.0.0';
    $('#aboutPlatform').textContent = api.app.platform || 'unknown';
    $('#aboutElectron').textContent = navigator.userAgent.match(/Electron\/(\S+)/)?.[1] || '—';
  }

  function setupSettings() {
    // Toggle handlers
    const save = async () => {
      const s = {
        startOnLogin: $('#setStartOnLogin').checked,
        minimizeToTray: $('#setMinToTray').checked,
        notifications: $('#setNotifications').checked,
        defaultEncryption: $('#setEncryption').value,
        downloadPath: state.settings.downloadPath || ''
      };
      state.settings = s;
      await api.settings.set(s);
    };

    ['setStartOnLogin', 'setMinToTray', 'setNotifications'].forEach(id => {
      $('#' + id).addEventListener('change', save);
    });
    $('#setEncryption').addEventListener('change', save);

    // Download path
    $('#btnSetDownloadPath').addEventListener('click', async () => {
      const dir = await api.dialog.openFolder();
      if (dir) {
        state.settings.downloadPath = dir;
        $('#setDownloadPathDisplay').textContent = dir;
        await save();
        toast('Download path updated', 'success');
      }
    });

    // Change password
    $('#btnChangePassword').addEventListener('click', () => {
      api.shell.open('https://fileshot.io/account/change-password');
    });

    // Manage subscription
    $('#btnManageSub').addEventListener('click', () => {
      api.shell.open('https://fileshot.io/pricing');
    });

    // About website
    $('#btnAboutWebsite').addEventListener('click', (e) => {
      e.preventDefault();
      api.shell.open('https://fileshot.io');
    });
  }

  /* ─── Auto-update UI ───────────────────────────────────────────────────── */
  function setupUpdates() {
    api.updates.onAvailable((info) => {
      const ver = info?.version || 'new';
      toast(`Update available: v${ver}. Downloading...`, 'info');
    });

    api.updates.onDownloaded((info) => {
      const ver = info?.version || 'new';
      if (confirm(`FileShot v${ver} is ready to install. Restart now?`)) {
        // There's no install IPC in preload, so app will install on next launch
        api.win.close();
      }
    });
  }

  /* ─── Init ─────────────────────────────────────────────────────────────── */
  async function init() {
    setupTitlebar();
    setupAuth();
    setupSidebar();
    setupUpload();
    setupFilesView();
    setupShareModal();
    setupVault();
    setupVaultPwModal();
    setupShredder();
    setupDrive();
    setupSettings();
    setupGlobalDrop();
    setupUpdates();

    // Check if already logged in
    const check = await api.auth.check();
    if (check.loggedIn) {
      state.user = { email: check.email };
      showApp();
    } else {
      showAuth();
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);
})();
