# GitHub Actions - Cross-Platform Build Setup

## ✅ What I Created For You

**File:** `.github/workflows/build.yml`

This GitHub Actions workflow will automatically build your desktop app for **Windows, macOS, and Linux** whenever you push a new version tag.

---

## 🚀 How It Works

### **Automatic Builds on 3 Platforms:**

1. **Windows** (runs on Windows server)
   - Builds `.exe` installer
   - No code signing (same as your local build)

2. **macOS** (runs on macOS server)
   - Builds `.dmg` installer
   - No code signing (CSC_IDENTITY_AUTO_DISCOVERY disabled)

3. **Linux** (runs on Ubuntu server)
   - Builds `.AppImage`, `.deb`, and `.rpm`
   - Works on all major distros

### **Triggered By:**
- Pushing a version tag (e.g., `v1.0.0`)
- Manual trigger via GitHub UI

---

## 📋 Setup Steps

### **1. Push Your Code to GitHub**

```bash
cd d:\FileShot.io\desktop-app

# Initialize git (if not already)
git init

# Add remote (replace with your repo URL)
git remote add origin https://github.com/yourusername/fileshot-desktop.git

# Add all files
git add .

# Commit
git commit -m "Initial desktop app commit"

# Push to GitHub
git push -u origin main
```

### **2. The Workflow is Already There**

The `.github/workflows/build.yml` file I created will be pushed with your code. GitHub will automatically detect it.

### **3. Create a Release Tag**

```bash
# Tag your current version
git tag v1.0.0

# Push the tag
git push origin v1.0.0
```

**That's it!** GitHub Actions will automatically:
1. Build Windows installer
2. Build macOS installer
3. Build Linux installers
4. Create a GitHub Release with all files attached

---

## 📥 Where to Find Built Files

### **Option 1: GitHub Releases**
- Go to your repo: `https://github.com/yourusername/fileshot-desktop/releases`
- Find your release (e.g., `v1.0.0`)
- Download the installers:
  - `FileShot-Setup-1.0.0.exe` (Windows)
  - `FileShot-1.0.0.dmg` (macOS)
  - `FileShot-1.0.0.AppImage` (Linux)
  - `FileShot-1.0.0.deb` (Debian/Ubuntu)
  - `FileShot-1.0.0.rpm` (Fedora/RedHat)

### **Option 2: Actions Artifacts**
- Go to Actions tab in your repo
- Click on the workflow run
- Download artifacts from each job

---

## 💰 Cost: **100% FREE**

- GitHub Actions is **free** for public repositories
- 2,000 minutes/month free for private repos
- Each build takes ~5-10 minutes
- You can do **200+ builds per month for free**

---

## 🎯 Benefits

### **vs Building Locally:**
✅ **No need for Mac** - GitHub provides macOS runners
✅ **No need for Linux VM** - GitHub provides Ubuntu runners
✅ **Consistent builds** - Same environment every time
✅ **Automatic releases** - Files uploaded to GitHub automatically
✅ **Version control** - Every build is tagged and tracked

### **vs Manual Cross-Platform:**
✅ **Saves hours** - No switching between systems
✅ **No setup** - No VMs, no dual boot, no remote machines
✅ **Parallel builds** - All 3 platforms build simultaneously
✅ **Professional** - Industry-standard CI/CD

---

## 🔧 Customization

### **Build on Every Push (Not Just Tags):**

Change this in `build.yml`:
```yaml
on:
  push:
    branches: [main]  # Build on every push to main
  workflow_dispatch:
```

### **Add Code Signing Later:**

When you get certificates, add secrets to GitHub:
1. Go to repo Settings → Secrets
2. Add `CSC_LINK` (certificate file base64)
3. Add `CSC_KEY_PASSWORD` (certificate password)
4. Update workflow to use them

### **Change Node Version:**

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v3
  with:
    node-version: '20'  # Change to 20 if needed
```

---

## 📝 Next Steps

### **Immediate:**
1. ✅ Push code to GitHub
2. ✅ Create `v1.0.0` tag
3. ✅ Wait 10-15 minutes for builds
4. ✅ Download all installers from Releases

### **After First Build:**
1. Upload installers to your server
2. Update desktop.html with download links
3. Remove "Coming Soon" from Mac/Linux
4. Announce cross-platform support!

### **Future:**
1. Add code signing certificates
2. Set up auto-updates
3. Add build notifications (Slack/Discord)
4. Add automated testing

---

## 🐛 Troubleshooting

### **Build Fails:**
- Check Actions tab for error logs
- Most common: Missing dependencies in package.json
- Fix: Add missing packages and push again

### **macOS Build Fails:**
- Usually code signing issues
- Solution: Keep `CSC_IDENTITY_AUTO_DISCOVERY: false`

### **Linux Build Fails:**
- Usually missing system dependencies
- Solution: Add to workflow:
  ```yaml
  - name: Install Linux dependencies
    run: sudo apt-get install -y libgtk-3-0 libnotify4
  ```

---

## 🎉 Summary

**GitHub Actions gives you:**
- ✅ Free cross-platform builds
- ✅ No need for Mac or Linux machines
- ✅ Automatic releases
- ✅ Professional CI/CD pipeline

**Time to first cross-platform release: ~20 minutes**

Just push your code, create a tag, and let GitHub do the work!
