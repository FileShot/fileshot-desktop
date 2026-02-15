/**
 * Simulates the drive mount + populate + watcher + file-drop flow
 * without Electron, to isolate crashes.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const LETTER = 'G';
const ROOT = `${LETTER}:\\`;
const EXE = path.join(__dirname, 'drive', 'windows', 'winfsp', 'fileshot-drive', 'bin', 'fileshot-drive.exe');
const WINFSP_BIN = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WinFsp', 'bin');

console.log(`[1] Spawning drive on ${LETTER}:`);

const env = { ...process.env };
env.PATH = `${WINFSP_BIN};${env.PATH || ''}`;

const driveProc = spawn(EXE, ['-m', `${LETTER}:`, '--label', 'TestFlow'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env
});

driveProc.stdout.on('data', d => console.log('[drive stdout]', d.toString().trim()));
driveProc.stderr.on('data', d => console.log('[drive stderr]', d.toString().trim()));
driveProc.on('exit', (code, sig) => {
  console.log(`[DRIVE EXIT] code=${code} signal=${sig}`);
  process.exit(1);
});

// Wait for drive to be ready
async function main() {
  console.log('[2] Waiting for drive...');
  for (let i = 0; i < 20; i++) {
    try {
      if (fs.existsSync(ROOT) && fs.statSync(ROOT).isDirectory()) break;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
  }

  if (!fs.existsSync(ROOT)) {
    console.error('[FAIL] Drive did not mount');
    driveProc.kill();
    process.exit(1);
  }
  console.log('[3] Drive mounted. Simulating populate...');

  // Simulate populateDriveFromCloud - write some files
  fs.mkdirSync(path.join(ROOT, 'Documents'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'test1.txt'), 'Hello from populate');
  fs.writeFileSync(path.join(ROOT, 'Documents', 'test2.txt'), 'Nested file');
  console.log('[4] Populate done. Starting watcher...');

  // Start watcher (exactly like the app does)
  let watcher;
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (evType, filename) => {
      console.log(`[WATCH] ${evType} ${filename}`);
      if (!filename) return;
      const fullPath = path.join(ROOT, filename);
      try {
        const st = fs.statSync(fullPath);
        console.log(`[WATCH] stat: isFile=${st.isFile()} size=${st.size}`);
      } catch (e) {
        console.log(`[WATCH] stat failed: ${e.message}`);
      }
    });
    watcher.on('error', (err) => {
      console.error(`[WATCH ERROR] ${err.message}`);
    });
    console.log('[5] Watcher started. Now copying a file into the drive...');
  } catch (e) {
    console.error(`[FAIL] Watcher start failed: ${e.message}`);
    driveProc.kill();
    process.exit(1);
  }

  // Simulate file drag (copy a file in)
  await new Promise(r => setTimeout(r, 1000));
  const srcFile = path.join(__dirname, '..', 'COPYING.txt');
  const dstFile = path.join(ROOT, 'COPYING.txt');
  console.log(`[6] Copying ${srcFile} -> ${dstFile}`);
  try {
    fs.copyFileSync(srcFile, dstFile);
    console.log('[7] Copy succeeded!');
  } catch (e) {
    console.error(`[FAIL] Copy failed: ${e.message}`);
  }

  // Wait for watcher events
  await new Promise(r => setTimeout(r, 3000));
  console.log('[8] Listing drive contents:');
  const files = fs.readdirSync(ROOT);
  for (const f of files) {
    const st = fs.statSync(path.join(ROOT, f));
    console.log(`  ${f} ${st.isDirectory() ? '<DIR>' : st.size + ' bytes'}`);
  }

  console.log('[9] Test passed! Cleaning up...');
  watcher.close();
  driveProc.kill();
  await new Promise(r => setTimeout(r, 1000));
  console.log('[DONE]');
  process.exit(0);
}

main().catch(e => {
  console.error('[FATAL]', e);
  driveProc.kill();
  process.exit(1);
});
