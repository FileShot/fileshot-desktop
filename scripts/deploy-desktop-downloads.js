/*
  Deploy desktop build artifacts to the public downloads directory.

  This replaces the old ZKE upload approach. Files are served as direct downloads
  from /downloads/desktop/{windows,macos,linux}/ via the frontend static server.

  Usage:
    node scripts/deploy-desktop-downloads.js
    node scripts/deploy-desktop-downloads.js --ci        # use _ci_artifacts
    node scripts/deploy-desktop-downloads.js --dist      # use dist/ (local build)
    node scripts/deploy-desktop-downloads.js --version 2.1.0  # override version

  What it does:
    1. Finds build artifacts (exe, dmg, zip, AppImage, deb)
    2. Copies them to public_html/public_html/downloads/desktop/{platform}/
    3. Creates "latest" aliases (FileShot-Setup-latest.exe, etc.)
    4. Updates version.json with direct download paths
    5. Copies electron-updater YAML files (latest.yml, latest-mac.yml, latest-linux.yml)
*/

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FILESHOT_ROOT = path.resolve(PROJECT_ROOT, '..');
const PUBLIC_DOWNLOADS = path.join(FILESHOT_ROOT, 'public_html', 'public_html', 'downloads', 'desktop');

const PLATFORM_DIRS = {
  windows: path.join(PUBLIC_DOWNLOADS, 'windows'),
  macos: path.join(PUBLIC_DOWNLOADS, 'macos'),
  linux: path.join(PUBLIC_DOWNLOADS, 'linux'),
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { source: 'ci', version: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ci') opts.source = 'ci';
    else if (args[i] === '--dist') opts.source = 'dist';
    else if (args[i] === '--version' && args[i + 1]) opts.version = args[++i];
  }

  return opts;
}

function getVersion(override) {
  if (override) return override;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created: ${dir}`);
  }
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`  ${path.basename(dest)} (${sizeMB} MB)`);
}

function findArtifacts(source) {
  const artifacts = { windows: [], macos: [], linux: [] };

  if (source === 'ci') {
    const ciDir = path.join(PROJECT_ROOT, '_ci_artifacts');
    if (!fs.existsSync(ciDir)) {
      throw new Error(`CI artifacts directory not found: ${ciDir}\nRun GitHub Actions build first, then download artifacts.`);
    }

    const winDir = path.join(ciDir, 'dist-windows-latest');
    const macDir = path.join(ciDir, 'dist-macos-latest');
    const linuxDir = path.join(ciDir, 'dist-ubuntu-latest');

    if (fs.existsSync(winDir)) {
      for (const f of fs.readdirSync(winDir)) {
        artifacts.windows.push(path.join(winDir, f));
      }
    }
    if (fs.existsSync(macDir)) {
      for (const f of fs.readdirSync(macDir)) {
        artifacts.macos.push(path.join(macDir, f));
      }
    }
    if (fs.existsSync(linuxDir)) {
      for (const f of fs.readdirSync(linuxDir)) {
        artifacts.linux.push(path.join(linuxDir, f));
      }
    }
  } else {
    const distDir = path.join(PROJECT_ROOT, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new Error(`dist directory not found: ${distDir}\nRun 'npm run build' first.`);
    }

    for (const f of fs.readdirSync(distDir)) {
      const full = path.join(distDir, f);
      if (!fs.statSync(full).isFile()) continue;
      const lower = f.toLowerCase();

      if (lower.endsWith('.exe') || lower === 'latest.yml') {
        artifacts.windows.push(full);
      } else if (lower.endsWith('.dmg') || lower.endsWith('-mac.zip') || lower === 'latest-mac.yml' || (lower.endsWith('.blockmap') && lower.includes('mac'))) {
        artifacts.macos.push(full);
      } else if (lower.endsWith('.appimage') || lower.endsWith('.deb') || lower === 'latest-linux.yml') {
        artifacts.linux.push(full);
      }
    }
  }

  return artifacts;
}

function deployPlatform(platformName, files, destDir, version) {
  if (files.length === 0) {
    console.log(`  [${platformName}] No artifacts found, skipping.`);
    return null;
  }

  ensureDir(destDir);

  const result = { downloadPath: null, artifactName: null };
  const extras = {};

  for (const src of files) {
    const name = path.basename(src);
    const lower = name.toLowerCase();
    const dest = path.join(destDir, name);

    // Skip debug/build metadata files
    if (lower === 'builder-debug.yml' || lower === 'builder-effective-config.yaml') continue;

    copyFile(src, dest);

    // Create "latest" aliases for the primary installers
    if (platformName === 'windows' && lower.endsWith('.exe') && lower.includes('setup')) {
      const latest = path.join(destDir, 'FileShot-Setup-latest.exe');
      copyFile(src, latest);
      result.downloadPath = `/downloads/desktop/windows/FileShot-Setup-latest.exe`;
      result.artifactName = name;
    }

    if (platformName === 'macos') {
      if (lower.endsWith('-mac.zip')) {
        result.downloadPath = `/downloads/desktop/macos/${name}`;
        result.artifactName = name;
      }
      if (lower.endsWith('.dmg') && !lower.endsWith('.blockmap')) {
        const latest = path.join(destDir, 'FileShot-latest.dmg');
        copyFile(src, latest);
        extras.dmgZipPath = `/downloads/desktop/macos/FileShot-latest.dmg`;
        extras.dmgZipName = name;
      }
    }

    if (platformName === 'linux') {
      if (lower.endsWith('.appimage')) {
        const latest = path.join(destDir, 'FileShot-latest.AppImage');
        copyFile(src, latest);
        result.downloadPath = `/downloads/desktop/linux/FileShot-latest.AppImage`;
        result.artifactName = name;
      }
      if (lower.endsWith('.deb')) {
        extras.debZipPath = `/downloads/desktop/linux/${name}`;
        extras.debZipName = name;
      }
    }
  }

  return { ...result, ...extras };
}

function writeVersionJson(version, platforms) {
  const versionJson = {
    version,
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: `deploy-script:v${version}`,
  };

  if (platforms.windows) versionJson.windows = platforms.windows;
  if (platforms.macos) versionJson.macos = platforms.macos;
  if (platforms.linux) versionJson.linux = platforms.linux;

  const dest = path.join(PUBLIC_DOWNLOADS, 'version.json');
  fs.writeFileSync(dest, JSON.stringify(versionJson, null, 2) + '\n', 'utf8');
  console.log(`\n  version.json updated -> ${dest}`);
  return versionJson;
}

function main() {
  const opts = parseArgs();
  const version = getVersion(opts.version);

  console.log('=== FileShot Desktop Deploy ===');
  console.log(`  Version:  ${version}`);
  console.log(`  Source:   ${opts.source === 'ci' ? '_ci_artifacts/' : 'dist/'}`);
  console.log(`  Target:   ${PUBLIC_DOWNLOADS}`);
  console.log('');

  const artifacts = findArtifacts(opts.source);

  console.log('[Windows]');
  const win = deployPlatform('windows', artifacts.windows, PLATFORM_DIRS.windows, version);

  console.log('\n[macOS]');
  const mac = deployPlatform('macos', artifacts.macos, PLATFORM_DIRS.macos, version);

  console.log('\n[Linux]');
  const linux = deployPlatform('linux', artifacts.linux, PLATFORM_DIRS.linux, version);

  const platforms = {};
  if (win && win.downloadPath) platforms.windows = win;
  if (mac && mac.downloadPath) platforms.macos = mac;
  if (linux && linux.downloadPath) platforms.linux = linux;

  const vj = writeVersionJson(version, platforms);

  console.log('\n=== Deploy Complete ===');
  console.log('');
  console.log('Download URLs:');
  if (vj.windows) console.log(`  Windows: https://fileshot.io${vj.windows.downloadPath}`);
  if (vj.macos) console.log(`  macOS:   https://fileshot.io${vj.macos.downloadPath}`);
  if (vj.linux) console.log(`  Linux:   https://fileshot.io${vj.linux.downloadPath}`);
  console.log('');
  console.log('Desktop page: https://fileshot.io/desktop');
}

main();
