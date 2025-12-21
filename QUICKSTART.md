# FileShot Desktop App - Quick Start

## 🚀 Build Your First Installer (5 Minutes)

### Step 1: Install Dependencies
```bash
cd d:\FileShot.io\desktop-app
npm install
```

This will install:
- Electron (desktop framework)
- electron-builder (creates installers)
- electron-updater (auto-updates)
- Other dependencies

**Time:** ~2 minutes

---

### Step 2: Test in Development Mode
```bash
npm run dev
```

This will:
- Launch the desktop app
- Connect to your web app (localhost:8080 or fileshot.io)
- Open DevTools for debugging
- Enable hot reload

**What to test:**
- ✅ App window opens
- ✅ System tray icon appears
- ✅ Can drag & drop files
- ✅ Context menu works

Press `Ctrl+C` to stop when done testing.

---

### Step 3: Build Windows Installer
```bash
npm run build:win
```

This will:
- Package the app
- Create Windows installer
- Output to `dist/` folder

**Output:**
- `dist/FileShot-Setup-1.0.0.exe` - One-click installer (NSIS)
- `dist/FileShot-1.0.0-portable.exe` - Portable version (no install)

**Time:** ~3-5 minutes

---

### Step 4: Test the Installer
1. Go to `d:\FileShot.io\desktop-app\dist\`
2. Double-click `FileShot-Setup-1.0.0.exe`
3. **You'll see "Windows protected your PC"** - This is normal!
   - Click "More info"
   - Click "Run anyway"
4. App installs and launches
5. Check system tray for FileShot icon

---

## 🎯 What You Have Now

✅ **Fully functional desktop app**
✅ **Windows installer (.exe)**
✅ **System tray integration**
✅ **Drag & drop upload**
✅ **Auto-update capability**
✅ **Ready to distribute**

---

## 📦 Distribution Options

### Option 1: Direct Download
1. Upload `FileShot-Setup-1.0.0.exe` to your server
2. Add download link to fileshot.io/desktop
3. Users download and install

### Option 2: GitHub Releases
1. Create GitHub repo: `FileShot/fileshot-desktop`
2. Push code
3. Create release with installer attached
4. Auto-updates will work automatically

### Option 3: Microsoft Store (Future)
- Requires Microsoft Developer account ($19)
- No SmartScreen warnings
- Automatic updates via Store

---

## 🔧 Customization

### Change App Name
Edit `package.json`:
```json
{
  "name": "fileshot-desktop",
  "productName": "FileShot",
  "description": "Your description here"
}
```

### Change Version
Edit `package.json`:
```json
{
  "version": "1.0.0"
}
```

### Change Icon
Replace these files:
- `build/icon.ico` - Windows icon
- `build/icon.icns` - Mac icon (if building for Mac)
- `assets/tray-icon.png` - System tray icon

---

## 🐛 Common Issues

### "npm install" fails
**Solution:** Update Node.js to version 18+
```bash
node --version  # Should be 18.0.0 or higher
```

### Build fails with "ENOENT: no such file"
**Solution:** Make sure you're in the correct directory
```bash
cd d:\FileShot.io\desktop-app
```

### "Windows protected your PC" warning
**Solution:** This is normal for unsigned apps
- Click "More info" → "Run anyway"
- See CODE_SIGNING_GUIDE.md for certificate options

### App won't start after install
**Solution:** Check if port 3000 is in use
```bash
netstat -ano | findstr :3000
```

---

## 📝 Next Steps

### Immediate:
1. ✅ Build and test installer
2. ✅ Upload to your server
3. ✅ Add download page to website

### Soon:
1. Get code signing certificate (removes warnings)
2. Set up GitHub releases (for auto-updates)
3. Add more features (screenshot, GIF maker)

### Future:
1. Mac version (`npm run build:mac`)
2. Linux version (`npm run build:linux`)
3. Microsoft Store submission

---

## 💡 Pro Tips

### Speed Up Builds
```bash
# Build without compression (faster for testing)
npm run pack

# Build only portable version (no installer)
npm run build:win -- --portable
```

### Debug Production Build
```bash
# Run built app with console
dist/win-unpacked/FileShot.exe --dev
```

### Clean Build
```bash
# Remove old builds
rmdir /s /q dist
npm run build:win
```

---

## 🎉 You're Ready!

Your desktop app is production-ready. Just:
1. Build the installer
2. Upload to your site
3. Share with users

**Questions?** Check the other guides:
- `README.md` - Full documentation
- `CODE_SIGNING_GUIDE.md` - Certificate options
- `INSTALLATION_GUIDE.md` - User instructions

---

**Let's build something amazing! 🚀**
