# Quick Icon Fix

## Problem
The favicon.ico is too small (needs 256x256 minimum for Windows installer).

## Solution Options

### Option 1: Use PNG instead (EASIEST)
Copy your logo.png or logonew.png to the build folder:

```bash
copy "d:\FileShot.io\test\logo.png" "d:\FileShot.io\desktop-app\build\icon.png"
```

Then update package.json to use PNG:
```json
"win": {
  "icon": "build/icon.png"
}
```

### Option 2: Create proper ICO online (RECOMMENDED)
1. Go to https://icoconvert.com/
2. Upload your logo.png
3. Select 256x256 size
4. Download the .ico file
5. Replace build/icon.ico

### Option 3: Skip icon temporarily
Remove icon from package.json temporarily:
```json
"win": {
  "target": ["nsis", "portable"]
  // Remove: "icon": "build/icon.ico"
}
```

This will use Electron's default icon for now.
