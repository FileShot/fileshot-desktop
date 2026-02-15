/*
  Upload desktop installer artifacts to FileShot using the same ZKE chunked upload
  pipeline as the desktop app.

  Usage (PowerShell):
    node scripts/upload-desktop-builds.js
    node scripts/upload-desktop-builds.js --folder "Desktop Installers" --out .\_upload_links.json
    node scripts/upload-desktop-builds.js --files dist\FileShot-Setup-2.0.0.exe dist\fileshot-desktop-v2-2.0.0.tar.gz

  Auth:
    - Prefer FILESHOT_TOKEN env var
    - Otherwise reads %APPDATA%\fileshot-desktop-v2\fileshot-v2.json (local dev only)
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const archiver = require('archiver');

const { encryptFileToZkeContainer } = require('../utils/zke-stream');

const API_BASE = 'https://api.fileshot.io/api';
const FRONTEND_URL = 'https://fileshot.io';

const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.msi',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1',
  '.sh', '.bash', '.zsh', '.run', '.app', '.deb', '.rpm', '.dmg', '.pkg',
  '.jar', '.apk',
  '.php', '.php3', '.php4', '.php5', '.phtml', '.asp', '.aspx', '.jsp', '.cgi',
  '.dll', '.sys', '.drv', '.ocx', '.so', '.dylib'
];

function hasBlockedExtension(filename) {
  const lower = String(filename || '').toLowerCase();
  return BLOCKED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function getAuthToken() {
  if (process.env.FILESHOT_TOKEN) return String(process.env.FILESHOT_TOKEN).trim();

  try {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const cfgPath = path.join(appData, 'fileshot-desktop-v2', 'fileshot-v2.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const token = raw && raw.authToken ? String(raw.authToken).trim() : null;
    return token || null;
  } catch (_) {
    return null;
  }
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet(token, endpoint) {
  const res = await axios.get(`${API_BASE}${endpoint}`, {
    headers: authHeaders(token),
    timeout: 30000
  });
  return res.data;
}

async function apiPostJson(token, endpoint, body) {
  const res = await axios.post(`${API_BASE}${endpoint}`, body, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    timeout: 60000
  });
  return res.data;
}

async function ensureFolder(token, name) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;

  const data = await apiGet(token, '/folders/');
  const folders = data?.folders || data || [];
  const match = folders.find(f => String(f?.name || '').toLowerCase() === safeName.toLowerCase());
  if (match?.folderId) return match.folderId;

  const created = await apiPostJson(token, '/folders/', { name: safeName });
  return created?.folderId || created?.folder?.folderId || null;
}

function zipSingleFile(inputPath, entryName) {
  return new Promise((resolve, reject) => {
    const tmpZip = path.join(os.tmpdir(), `fileshot-installer-${genId()}.zip`);
    const output = fs.createWriteStream(tmpZip);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(tmpZip));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.file(inputPath, { name: entryName });
    archive.finalize();
  });
}

async function uploadOne({ token, filePath, desiredFolderId = null }) {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error('Not a file');

  const originalName = path.basename(filePath);
  const originalFileSize = st.size;

  // Auto-zip blocked types so the server accepts them.
  let uploadSourcePath = filePath;
  let uploadFileName = originalName;
  let wasZipped = false;
  let tmpZip = null;

  if (hasBlockedExtension(originalName)) {
    tmpZip = await zipSingleFile(filePath, originalName);
    uploadSourcePath = tmpZip;
    // IMPORTANT: backend blocks if the *stored name* contains blocked extensions
    // anywhere in the string. So avoid names like "setup.exe.zip".
    const base = path.parse(originalName).name;
    uploadFileName = `${base}.zip`;
    wasZipped = true;
  }

  // ZKE encrypt to a temp .fszk container
  const tmpOut = path.join(os.tmpdir(), `fileshot-upload-${genId()}.fszk`);
  const tmpFiles = [tmpOut];
  if (tmpZip) tmpFiles.push(tmpZip);

  try {
    const enc = await encryptFileToZkeContainer({
      inputPath: uploadSourcePath,
      outputPath: tmpOut,
      originalName: uploadFileName,
      originalMimeType: 'application/octet-stream',
      mode: 'raw',
      chunkSize: 512 * 1024
    });

    const encryptedSize = fs.statSync(tmpOut).size;

    // Pre-upload
    const preData = await apiPostJson(token, '/files/pre-upload', {
      fileName: uploadFileName,
      fileSize: originalFileSize,
      isZeroKnowledge: 'true',
      originalFileName: uploadFileName,
      originalFileSize: originalFileSize,
      originalMimeType: 'application/octet-stream'
    });

    const fileId = preData?.fileId;
    if (!fileId) throw new Error('Pre-upload failed (no fileId)');

    // Upload chunks (encrypted blob)
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
          headers: { ...form.getHeaders(), ...authHeaders(token) },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 600000
        });
      }
    } finally {
      try { fs.closeSync(fd); } catch (_) {}
    }

    // Finalize
    await apiPostJson(token, `/files/finalize-upload/${fileId}`, {});

    // Move to folder (optional)
    if (desiredFolderId) {
      await apiPostJson(token, '/files/move', { fileIds: [fileId], folderId: desiredFolderId });
    }

    const shareUrl = `${FRONTEND_URL}/downloads.html?f=${encodeURIComponent(fileId)}${enc.rawKey ? `#k=${encodeURIComponent(enc.rawKey)}` : ''}`;

    return {
      localPath: filePath,
      name: originalName,
      uploadedAs: uploadFileName,
      wasZipped,
      fileId,
      shareUrl
    };
  } finally {
    for (const p of tmpFiles) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}

function parseArgs(argv) {
  const args = { files: [], folder: 'Desktop Installers', out: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.files.push(argv[++i]);
      }
    } else if (a === '--folder') {
      args.folder = argv[++i] || '';
    } else if (a === '--out') {
      args.out = argv[++i] || '';
    } else if (!a.startsWith('--')) {
      // Allow positional files
      args.files.push(a);
    }
  }
  return args;
}

async function main() {
  const token = getAuthToken();
  if (!token) {
    console.error('Missing auth token. Set FILESHOT_TOKEN or login via the desktop app first.');
    process.exitCode = 2;
    return;
  }

  const args = parseArgs(process.argv);

  const defaultFiles = [
    path.join(__dirname, '..', 'dist', 'FileShot-Setup-2.0.0.exe'),
    path.join(__dirname, '..', 'dist', 'fileshot-desktop-v2-2.0.0.tar.gz')
  ];

  const files = (args.files.length ? args.files : defaultFiles)
    .map(f => path.isAbsolute(f) ? f : path.join(process.cwd(), f))
    .filter(f => fs.existsSync(f));

  if (!files.length) {
    console.error('No files to upload. Build artifacts first (desktop-app-v2/dist).');
    process.exitCode = 3;
    return;
  }

  let folderId = null;
  try {
    folderId = await ensureFolder(token, args.folder);
  } catch (e) {
    console.warn('Warning: could not ensure folder:', e?.message || String(e));
    folderId = null;
  }

  const results = [];
  for (const fp of files) {
    const name = path.basename(fp);
    console.log(`Uploading: ${name}`);
    try {
      const r = await uploadOne({ token, filePath: fp, desiredFolderId: folderId });
      results.push({ ...r, ok: true });
      console.log(`  OK: ${r.shareUrl}`);
    } catch (e) {
      results.push({ localPath: fp, name, ok: false, error: e?.response?.data?.error || e?.message || String(e) });
      console.error(`  FAIL: ${name} — ${e?.message || String(e)}`);
    }
  }

  const out = args.out ? (path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out)) : '';
  if (out) {
    try {
      fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
      console.log(`\nWrote: ${out}`);
    } catch (e) {
      console.warn('Warning: failed to write output file:', e?.message || String(e));
    }
  }

  // Exit non-zero if any upload failed
  if (results.some(r => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
