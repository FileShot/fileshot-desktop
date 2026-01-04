/* global window */

const el = (id) => document.getElementById(id);

const listEl = el('list');
const emptyEl = el('empty');
const statusEl = el('status');
const uploadModeEl = el('uploadMode');
const passphraseWrapEl = el('passphraseWrap');
const passphraseEl = el('passphrase');
const progressFillEl = el('progressFill');
const progressTextEl = el('progressText');
const shareLinkEl = el('shareLink');
const btnCopyEl = el('btnCopy');

let selectedLocalIdForUpload = null;

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

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function setProgress(pct, text) {
  const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
  progressFillEl.style.width = `${clamped}%`;
  progressTextEl.textContent = text || (clamped > 0 ? `${Math.round(clamped)}%` : 'Idle');
}

function setShareLink(url) {
  shareLinkEl.value = url || '';
  btnCopyEl.disabled = !url;
}

async function refreshList() {
  if (!window.electronAPI?.vaultList) {
    setStatus('Desktop bridge not available');
    return;
  }

  const { items, totalBytes } = await window.electronAPI.vaultList();
  setStatus(`${items.length} file(s) • ${fmtBytes(totalBytes)}`);

  listEl.innerHTML = '';
  emptyEl.hidden = items.length !== 0;

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'item';

    const left = document.createElement('div');
    left.innerHTML = `
      <div class="name">${escapeHtml(item.name)}</div>
      <div class="meta">${fmtBytes(item.size)} • added ${new Date(item.addedAt).toLocaleString()}</div>
    `;

    const buttons = document.createElement('div');
    buttons.className = 'buttons';

    const btnUpload = document.createElement('button');
    btnUpload.className = 'btn btn-primary';
    btnUpload.textContent = 'Upload (ZKE)';
    btnUpload.addEventListener('click', async () => {
      selectedLocalIdForUpload = item.id;
      await startUploadForSelected();
    });

    const btnReveal = document.createElement('button');
    btnReveal.className = 'btn btn-secondary';
    btnReveal.textContent = 'Reveal key';
    btnReveal.addEventListener('click', async () => {
      const r = await window.electronAPI.vaultRevealKey(item.id);
      if (r && r.shareKey) {
        setShareLink(r.shareKey);
        setProgress(0, 'Key revealed (local only)');
      } else {
        setProgress(0, 'No key stored for this file yet');
      }
    });

    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn';
    btnRemove.textContent = 'Remove';
    btnRemove.addEventListener('click', async () => {
      await window.electronAPI.vaultRemove(item.id);
      if (selectedLocalIdForUpload === item.id) selectedLocalIdForUpload = null;
      await refreshList();
    });

    buttons.appendChild(btnUpload);
    buttons.appendChild(btnReveal);
    buttons.appendChild(btnRemove);

    div.appendChild(left);
    div.appendChild(buttons);
    listEl.appendChild(div);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function addFiles() {
  const paths = await window.electronAPI.selectFile();
  if (!paths || paths.length === 0) return;
  await window.electronAPI.vaultAdd(paths);
  await refreshList();
}

async function addFolder() {
  const paths = await window.electronAPI.selectFolder();
  if (!paths || paths.length === 0) return;
  await window.electronAPI.vaultAddFolder(paths[0]);
  await refreshList();
}

function getUploadOptions() {
  const mode = uploadModeEl.value;
  const passphrase = passphraseEl.value;
  if (mode === 'passphrase') {
    if (!passphrase || String(passphrase).trim().length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    return { mode: 'passphrase', passphrase: String(passphrase) };
  }
  return { mode: 'raw' };
}

async function startUploadForSelected() {
  if (!selectedLocalIdForUpload) {
    setProgress(0, 'Pick a file to upload');
    return;
  }

  setShareLink('');
  setProgress(1, 'Encrypting locally...');

  let opts;
  try {
    opts = getUploadOptions();
  } catch (e) {
    setProgress(0, e.message || 'Invalid upload options');
    return;
  }

  const onProgress = (p) => {
    if (!p) return;
    setProgress(p.percent || 0, p.stage || 'Working...');
  };

  try {
    const result = await window.electronAPI.uploadZke(selectedLocalIdForUpload, opts, onProgress);
    if (result && result.shareUrl) {
      setShareLink(result.shareUrl);
      setProgress(100, 'Upload complete');
    } else {
      setProgress(0, 'Upload finished but no share link returned');
    }
  } catch (e) {
    setProgress(0, e.message || 'Upload failed');
  }
}

uploadModeEl.addEventListener('change', () => {
  passphraseWrapEl.hidden = uploadModeEl.value !== 'passphrase';
});

el('btnAddFiles').addEventListener('click', addFiles);
el('btnAddFolder').addEventListener('click', addFolder);
el('btnGoOnline').addEventListener('click', () => {
  window.electronAPI.goOnline();
});

btnCopyEl.addEventListener('click', async () => {
  const val = shareLinkEl.value;
  if (!val) return;
  await window.electronAPI.copyToClipboard(val);
  setProgress(0, 'Copied');
});

// Boot
(async () => {
  passphraseWrapEl.hidden = uploadModeEl.value !== 'passphrase';
  setProgress(0, 'Idle');
  setShareLink('');
  if (window.electronAPI?.onVaultUpdated) {
    window.electronAPI.onVaultUpdated(() => {
      refreshList().catch(() => {});
    });
  }
  await refreshList();
})();
