# FileShot Desktop App - Installation & Setup Guide

## 📦 Quick Start

### For Users (Installing the App)

#### Windows
1. Download `FileShot-Setup-1.0.0.exe` from [fileshot.io/desktop](https://fileshot.io/desktop)
2. Double-click the installer
3. **If you see "Windows protected your PC":**
   - Click "More info"
   - Click "Run anyway"
   - This is normal for new apps without expensive certificates
4. FileShot will install and launch automatically
5. Look for the FileShot icon in your system tray (bottom-right)

#### macOS
1. Download `FileShot-1.0.0.dmg` from [fileshot.io/desktop](https://fileshot.io/desktop)
2. Open the DMG file
3. Drag FileShot to Applications folder
4. **If you see "cannot be opened" warning:**
   - Right-click FileShot.app → Open
   - Click "Open" in the dialog
5. FileShot will launch and appear in menu bar

#### Linux
1. Download `FileShot-1.0.0.AppImage` from [fileshot.io/desktop](https://fileshot.io/desktop)
2. Make it executable:
   ```bash
   chmod +x FileShot-1.0.0.AppImage
   ```
3. Run it:
   ```bash
   ./FileShot-1.0.0.AppImage
   ```
4. FileShot will launch and appear in system tray

---

## 🛠️ For Developers (Building from Source)

### Prerequisites
- Node.js 18 or higher
- npm or yarn
- Git

### Clone and Setup
```bash
# Clone the repository
git clone https://github.com/FileShot/fileshot-desktop.git
cd fileshot-desktop

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Development Mode
```bash
# Run with hot reload
npm run dev

# This will:
# - Launch the app
# - Open DevTools
# - Connect to localhost:8080 (your web app)
# - Enable live reload
```

### Building for Production

#### Build for All Platforms
```bash
npm run build
```

#### Build for Specific Platform
```bash
# Windows only
npm run build:win

# macOS only  
npm run build:mac

# Linux only
npm run build:linux
```

### Build Output
After building, installers will be in the `dist/` folder:
- **Windows:** `FileShot-Setup-1.0.0.exe` (NSIS installer)
- **macOS:** `FileShot-1.0.0.dmg` (DMG image)
- **Linux:** `FileShot-1.0.0.AppImage` (AppImage)

---

## 🎯 Features & Usage

### System Tray
- **Single-click:** Open context menu
- **Double-click:** Open main window
- **Drag & drop:** Drop files on tray icon to upload

### Context Menu Options
- **Open FileShot** - Open main window
- **Upload File** - Select file(s) to upload
- **Upload Folder** - Select folder to upload
- **Recent Uploads** - Quick access to recent files
- **Settings** - Open settings page
- **Check for Updates** - Manually check for updates
- **Quit** - Exit application

### Keyboard Shortcuts
- `Ctrl+O` / `Cmd+O` - Open file picker
- `Ctrl+U` / `Cmd+U` - Upload selected files
- `Ctrl+,` / `Cmd+,` - Open settings
- `Ctrl+Q` / `Cmd+Q` - Quit app

### Drag & Drop
1. Drag files from anywhere
2. Drop on FileShot tray icon
3. Files upload automatically
4. Link copied to clipboard

---

## 🔧 Configuration

### Settings Location
- **Windows:** `%APPDATA%\fileshot-desktop\config.json`
- **macOS:** `~/Library/Application Support/fileshot-desktop/config.json`
- **Linux:** `~/.config/fileshot-desktop/config.json`

### Available Settings
```json
{
  "autoStart": true,
  "minimizeToTray": true,
  "notifications": true,
  "autoUpdate": true,
  "uploadQuality": "original",
  "defaultExpiration": "7d"
}
```

---

## 🐛 Troubleshooting

### Windows: "Windows protected your PC"
**Cause:** App is unsigned (no code signing certificate yet)

**Solution:**
1. Click "More info"
2. Click "Run anyway"
3. This is safe - we just haven't purchased a $300/year certificate yet

**Why this happens:**
- New apps without certificates trigger SmartScreen
- After ~100 downloads, Windows automatically trusts the app
- We'll add proper signing in future updates

### macOS: "Cannot be opened"
**Cause:** App is not notarized by Apple

**Solution:**
1. Right-click FileShot.app
2. Click "Open"
3. Click "Open" in dialog

**Alternative:**
```bash
xattr -cr /Applications/FileShot.app
```

### Linux: "Permission denied"
**Cause:** AppImage not executable

**Solution:**
```bash
chmod +x FileShot-1.0.0.AppImage
```

### App Won't Start
**Check:**
1. Node.js version: `node --version` (need 18+)
2. Ports in use: FileShot uses port 3000 for API
3. Firewall: Allow FileShot through firewall
4. Logs: Check console for errors

**Windows logs:**
```
%APPDATA%\fileshot-desktop\logs\
```

**macOS/Linux logs:**
```
~/.config/fileshot-desktop/logs/
```

### Upload Fails
**Check:**
1. Internet connection
2. File size (max 15GB free, 300GB pro, unlimited creator)
3. File type (executables blocked for security)
4. Authentication (login required for large files)

---

## 🔄 Updates

### Automatic Updates
- App checks for updates on startup
- Notification shown when update available
- One-click update installation
- App restarts automatically

### Manual Update Check
1. Click tray icon
2. Select "Check for Updates"
3. Download and install if available

### Update Channels
- **Stable:** Recommended for most users
- **Beta:** Early access to new features
- **Dev:** Latest changes (may be unstable)

Change channel in Settings → Updates

---

## 🔐 Security & Privacy

### Data Storage
- **Local only:** Settings stored locally
- **Encrypted:** Auth tokens encrypted at rest
- **No tracking:** No analytics or telemetry
- **Zero-knowledge:** Files encrypted before upload

### Permissions Required
- **File system:** Read files for upload
- **Network:** Upload files to FileShot.io
- **Notifications:** Show upload status
- **Auto-start:** Launch on system startup (optional)

### What We DON'T Collect
- ❌ No file contents
- ❌ No browsing history
- ❌ No personal data
- ❌ No usage analytics
- ❌ No crash reports (unless you opt-in)

---

## 📞 Support

### Get Help
- **Website:** https://fileshot.io/support
- **Email:** admin@fileshot.io
- **GitHub Issues:** https://github.com/FileShot/fileshot-desktop/issues
- **Discord:** https://discord.gg/fileshot (coming soon)

### Report Bugs
1. Go to GitHub Issues
2. Click "New Issue"
3. Select "Bug Report"
4. Fill in template
5. Attach logs if possible

### Feature Requests
1. Go to GitHub Issues
2. Click "New Issue"
3. Select "Feature Request"
4. Describe your idea

---

## 🚀 Advanced Usage

### Command Line
```bash
# Open specific file
fileshot upload /path/to/file.pdf

# Upload folder
fileshot upload /path/to/folder/

# Set expiration
fileshot upload file.pdf --expires 7d

# Enable zero-knowledge encryption
fileshot upload file.pdf --zke --password mypassword

# Copy link to clipboard
fileshot upload file.pdf --copy
```

### API Integration
```javascript
// Use desktop app as upload backend
const { electronAPI } = window;

// Upload file
const files = await electronAPI.selectFile();
const result = await uploadFiles(files);

// Get auth token
const token = await electronAPI.getAuthToken();
```

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🎉 What's Next?

### Coming Soon
- 📱 Mobile companion app
- 🎥 Screen recording
- 🎨 GIF maker
- 🔌 Zapier integration
- 👥 Team collaboration
- 🤖 Slack/Discord bots

### Stay Updated
- Follow us on Twitter: [@FileShotIO](https://twitter.com/FileShotIO)
- Join our newsletter: https://fileshot.io/newsletter
- Star us on GitHub: https://github.com/FileShot/fileshot-desktop

---

**Thank you for using FileShot Desktop! 🚀**
