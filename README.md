# FileShot Desktop App

Official desktop application for FileShot.io - Fast, Private File Sharing with Zero-Knowledge Encryption.

## Features

- 🖥️ **Native Desktop Experience** - Full-featured desktop app for Windows, Mac, and Linux
- 📤 **Drag & Drop Upload** - Drop files on tray icon for instant upload
- 🔔 **System Tray Integration** - Quick access from system tray
- 🔄 **Background Uploads** - Upload files in the background
- 🔐 **Secure & Private** - Same zero-knowledge encryption as web app
- 🚀 **Auto-Updates** - Automatic updates when new versions are available
- 📋 **Recent Uploads** - Quick access to recently uploaded files
- ⚡ **Fast & Lightweight** - Optimized for performance

## Installation

### Windows
1. Download `FileShot-Setup-1.0.0.exe`
2. Run the installer
3. FileShot will launch automatically after installation

### macOS
1. Download `FileShot-1.0.0.dmg`
2. Open the DMG file
3. Drag FileShot to Applications folder
4. Launch FileShot from Applications

### Linux
1. Download `FileShot-1.0.0.AppImage`
2. Make it executable: `chmod +x FileShot-1.0.0.AppImage`
3. Run: `./FileShot-1.0.0.AppImage`

## Development

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Setup
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Build for specific platform
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

### Project Structure
```
desktop-app/
├── main.js          # Main process (Electron)
├── preload.js       # Preload script (security bridge)
├── renderer/        # Renderer process (UI)
├── assets/          # Icons and images
├── build/           # Build resources
└── package.json     # Dependencies and build config
```

## Code Signing

### Current Status (Unsigned)
The app is currently **unsigned** which may trigger Windows SmartScreen warnings. This is normal for new applications.

### Getting a Code Signing Certificate

**For Windows:**
1. Purchase certificate from:
   - DigiCert ($474/year) - Recommended
   - Sectigo ($199/year)
   - SSL.com ($199/year)

2. Certificate types:
   - **Standard Code Signing** - $199-474/year
   - **EV Code Signing** - $299-599/year (instant SmartScreen trust)

3. Setup:
   ```bash
   # Install certificate
   # Add to package.json build config:
   "win": {
     "certificateFile": "path/to/cert.pfx",
     "certificatePassword": "your-password",
     "signingHashAlgorithms": ["sha256"],
     "sign": "./sign.js"
   }
   ```

**For macOS:**
1. Join Apple Developer Program ($99/year)
2. Create Developer ID certificate
3. Configure in package.json:
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Name (TEAM_ID)"
   }
   ```

### Temporary Workaround (Self-Signed)
Users can bypass SmartScreen warning:
1. Click "More info"
2. Click "Run anyway"

After ~100 downloads, Windows SmartScreen will automatically trust the app.

## Security

- ✅ Context isolation enabled
- ✅ Node integration disabled
- ✅ Web security enabled
- ✅ Preload script for safe IPC
- ✅ CSP headers enforced
- ✅ External links open in browser

## Auto-Updates

The app checks for updates on startup and notifies users when updates are available.

Update server: GitHub Releases (configured in package.json)

## Building Installers

### Windows (NSIS)
```bash
npm run build:win
```
Output: `dist/FileShot-Setup-1.0.0.exe` (one-click installer)

### macOS (DMG)
```bash
npm run build:mac
```
Output: `dist/FileShot-1.0.0.dmg`

### Linux (AppImage)
```bash
npm run build:linux
```
Output: `dist/FileShot-1.0.0.AppImage`

## Troubleshooting

### Windows SmartScreen Warning
**Issue:** "Windows protected your PC" warning

**Solution:** 
- Click "More info" → "Run anyway"
- This is normal for unsigned apps
- Will disappear after getting code signing certificate

### macOS Gatekeeper Warning
**Issue:** "FileShot cannot be opened because it is from an unidentified developer"

**Solution:**
- Right-click app → Open
- Click "Open" in dialog
- Or: System Preferences → Security → "Open Anyway"

### Linux Permission Denied
**Issue:** Cannot execute AppImage

**Solution:**
```bash
chmod +x FileShot-1.0.0.AppImage
```

## Support

- Website: https://fileshot.io
- Email: admin@fileshot.io
- GitHub: https://github.com/FileShot/fileshot-desktop

## License

MIT License - See LICENSE file for details

## Changelog

### Version 1.0.0 (2025-01-XX)
- Initial release
- System tray integration
- Drag & drop upload
- Background uploads
- Auto-updates
- Cross-platform support (Windows, Mac, Linux)
