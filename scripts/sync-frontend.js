/*
  Sync the production static frontend (../CURRENT) into the desktop app bundle.

  Why:
  - The desktop app should be able to load even when the cloud site is unreachable
    (offline, DNS issues, tunnel hiccups).
  - Electron packages only files under desktop-app/, so we copy CURRENT/ into
    desktop-app/renderer/site/ before building.

  This is intentionally simple and safe: if CURRENT/ doesn't exist, it exits
  successfully (so CI/dev doesn't break).
*/

const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '..', '..', 'CURRENT');
const destDir = path.resolve(__dirname, '..', 'renderer', 'site');

function safeRm(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function safeCopy(src, dst) {
  // Node 18+ supports fs.cpSync
  fs.cpSync(src, dst, {
    recursive: true,
    force: true,
    // Keep the bundle reasonably clean
    filter: (srcPath) => {
      const rel = path.relative(src, srcPath);
      if (!rel) return true;

      // Ignore OS noise
      const base = path.basename(srcPath);
      if (base === '.DS_Store' || base === 'Thumbs.db') return false;

      // Ignore very large or irrelevant directories if they ever appear
      if (rel.startsWith('node_modules')) return false;

      return true;
    }
  });
}

try {
  if (!fs.existsSync(sourceDir)) {
    console.log('[sync-frontend] CURRENT/ not found. Skipping.');
    process.exit(0);
  }

  console.log('[sync-frontend] Copying frontend...');
  console.log('  from:', sourceDir);
  console.log('  to  :', destDir);

  safeRm(destDir);
  fs.mkdirSync(destDir, { recursive: true });
  safeCopy(sourceDir, destDir);

  const indexPath = path.join(destDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.warn('[sync-frontend] Warning: index.html not found in copied site.');
  }

  console.log('[sync-frontend] Done.');
} catch (err) {
  console.error('[sync-frontend] Failed:', err);
  process.exit(1);
}
