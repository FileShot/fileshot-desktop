# FileShot Desktop App

Official desktop application for [FileShot.io](https://fileshot.io) — Fast, Private File Sharing with Zero-Knowledge Encryption.

**Current version: 1.4.10** | [Download latest release](https://github.com/FileShot/fileshot-desktop/releases/latest) | [Website](https://fileshot.io)

---

<!-- Screenshot placeholder: upload UI with tray menu visible -->
<!-- Add screenshot here once available: docs/screenshot-app.png -->

---

## Features

### Core
- Native desktop experience for Windows, macOS, and Linux
- Drag-and-drop files onto the tray icon for instant upload
- System tray integration — FileShot stays out of your way until you need it
- Background uploads — queue files and continue working
- The same zero-knowledge AES-256-GCM encryption as the web app

### FileShot Drive (Windows, v1.3+)
- Mounts a real virtual drive letter (e.g. `F:\FileShot\`) via WinFsp
- Drag files into the drive folder — they upload automatically
- Quota and usage stats shown in the Metrics dashboard
- Requires [WinFsp](https://winfsp.dev/) installed

### Metrics Dashboard (v1.2+)
- Upload history, bandwidth used, files shared
- Local-only — no data sent to any server

### Offline Mode (v1.2+)
- Local-first UI bundled inside the app
- Works without internet; queued uploads sync when connection resumes

### Other
- Auto-updates on startup — no manual installer downloads
- Recent uploads list with one-click copy of share link
- Clipboard integration
- Context isolation, CSP headers, node integration disabled (secure by default)

---

## Installation

### Windows
1. [Download `FileShot-Setup-1.4.10.exe`](https://github.com/FileShot/fileshot-desktop/releases/latest)
2. Run the installer — no admin rights required
3. FileShot launches automatically and appears in the system tray

> Windows SmartScreen may warn "Windows protected your PC" because the app is currently unsigned. Click **More info → Run anyway**. After approximately 100 downloads from different IPs, Windows SmartScreen trust builds automatically.

### macOS
1. [Download `FileShot-1.4.10.dmg`](https://github.com/FileShot/fileshot-desktop/releases/latest)
2. Open the DMG and drag FileShot to Applications
3. Right-click → Open if Gatekeeper blocks it

### Linux
1. [Download `FileShot-1.4.10.AppImage`](https://github.com/FileShot/fileshot-desktop/releases/latest)
2. `chmod +x FileShot-1.4.10.AppImage && ./FileShot-1.4.10.AppImage`

---

## FileShot Drive Setup (Windows)

The FileShot Drive requires WinFsp, a free Windows file system driver:

1. Download and install [WinFsp](https://winfsp.dev/rel/) (free, open source)
2. Open FileShot Desktop
3. Go to Settings → Drive → Enable FileShot Drive
4. A drive letter (default: `F:`) mounts as `FileShot Drive`
5. Drop any file into `F:\` — it encrypts and uploads automatically

---

## Development

### Prerequisites
- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Run in development mode (connects to localhost:3000 API)
npm run dev

# Run in production mode (connects to api.fileshot.io)
npm run start
```

### Build

```bash
npm run build:win    # Windows NSIS installer (.exe)
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

### Project Structure

```
desktop-app/
├── main.js              # Main process — tray, windows, upload queue, drive
├── preload.js           # Secure IPC bridge (context isolation)
├── renderer/
│   ├── local/           # Local-first UI (v1.2+, always available offline)
│   ├── site/            # Bundled web frontend fallback
│   ├── metrics/         # Metrics dashboard UI
│   └── offline.html     # Offline landing page
├── utils/
│   └── zke-stream.js    # Streaming zero-knowledge encryption for large files
├── assets/              # App icons
├── build/               # Build resources (icons, NSIS config)
└── package.json
```

---

## Security Notes

- Context isolation: enabled
- Node integration in renderer: disabled
- Web security: enabled
- Preload script as the only IPC bridge
- CSP headers enforced on all windows
- External links open in the system browser, not inside the app
- The app is currently **unsigned**. Code signing with an EV certificate is planned. See [CODE_SIGNING_GUIDE.md](CODE_SIGNING_GUIDE.md).

---

## Auto-Updates

The app checks for updates on startup via GitHub Releases. When an update is available, a notification appears in the tray — click to install. No manual downloads required.

---

## Support

- Website: https://fileshot.io
- Email: admin@fileshot.io
- Issues: https://github.com/FileShot/fileshot-desktop/issues

---

## Related Repositories

- [FileShotZKE](https://github.com/FileShot/FileShotZKE) — Standalone zero-knowledge encryption library (AES-256-GCM, browser)
- [FileShot Chrome Extension](https://chromewebstore.google.com/detail/ppbbdbmpeckkimfplcgodkeejmjakjik) — MV3 extension for capturing and uploading directly from any webpage

---

## License

MIT — see LICENSE.

---

## Changelog

### v1.4.10 (2026)
- Stability improvements and bug fixes

### v1.4.x (2025-2026)
- FileShot Drive improvements and quota display
- Metrics dashboard refinements
- Streaming ZKE encryption for very large files

### v1.3.0 (2025)
- FileShot Drive: WinFsp virtual drive letter mount
- Automatic upload on file drop into drive folder

### v1.2.0 (2025)
- Metrics dashboard (local upload history, bandwidth stats)
- Offline mode with locally bundled UI
- Upload queue with background sync

### v1.0.0 (2025)
- Initial release
- System tray integration
- Drag-and-drop upload
- Background uploads
- Auto-updates via GitHub Releases
- Cross-platform: Windows, macOS, Linux
