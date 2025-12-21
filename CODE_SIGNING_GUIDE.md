# Code Signing Guide for FileShot Desktop App

## 🔒 Why Code Signing Matters

Without code signing, users will see security warnings:
- **Windows:** "Windows protected your PC" (SmartScreen)
- **macOS:** "Cannot be opened because it is from an unidentified developer" (Gatekeeper)

Code signing proves your app is legitimate and hasn't been tampered with.

---

## 📋 Options for Code Signing

### Option 1: Wait for SmartScreen Reputation (FREE)
**Timeline:** 2-4 weeks
**Cost:** $0

**How it works:**
- Windows SmartScreen builds reputation based on downloads
- After ~100-500 downloads, warnings disappear automatically
- No certificate needed

**Pros:**
- ✅ Free
- ✅ No setup required

**Cons:**
- ⚠️ Users see warnings initially
- ⚠️ Takes time to build reputation
- ⚠️ Reputation resets with each new version

**Recommended for:** Initial launch, testing market fit

---

### Option 2: Standard Code Signing Certificate
**Timeline:** 1-3 days
**Cost:** $199-474/year

**Providers:**
1. **SSL.com** - $199/year (cheapest)
2. **Sectigo (Comodo)** - $199/year
3. **DigiCert** - $474/year (most trusted)

**What you get:**
- ✅ Sign Windows .exe files
- ✅ Sign macOS .app files
- ✅ Reduces (but doesn't eliminate) SmartScreen warnings
- ✅ Still need to build reputation

**Setup time:** 1-3 business days (identity verification)

**Recommended for:** Established apps, professional image

---

### Option 3: EV Code Signing Certificate (BEST)
**Timeline:** 3-7 days
**Cost:** $299-599/year

**Providers:**
1. **SSL.com** - $299/year
2. **DigiCert** - $599/year

**What you get:**
- ✅ **Instant SmartScreen trust** (no reputation needed!)
- ✅ No warnings from day 1
- ✅ Hardware token (USB key) for security
- ✅ Higher trust level

**Setup time:** 3-7 business days (stricter identity verification)

**Recommended for:** Professional launch, enterprise customers

---

## 🛠️ How to Get a Certificate

### Step 1: Choose Provider
**Recommended:** SSL.com (best price/value)
- Standard: $199/year
- EV: $299/year
- Link: https://www.ssl.com/code-signing/

### Step 2: Purchase & Verify Identity
You'll need:
- Business registration documents (or personal ID)
- Phone number verification
- Email verification
- DUNS number (for EV only)

**Timeline:**
- Standard: 1-3 days
- EV: 3-7 days

### Step 3: Receive Certificate
- **Standard:** Download .pfx file
- **EV:** Receive USB hardware token in mail

### Step 4: Configure Electron Builder

**For Windows (Standard Certificate):**
```json
// package.json
{
  "build": {
    "win": {
      "certificateFile": "./certificates/fileshot-cert.pfx",
      "certificatePassword": "YOUR_PASSWORD_HERE",
      "signingHashAlgorithms": ["sha256"],
      "sign": "./sign.js"
    }
  }
}
```

**For Windows (EV Certificate with USB token):**
```json
{
  "build": {
    "win": {
      "sign": "./sign-ev.js",
      "signingHashAlgorithms": ["sha256"]
    }
  }
}
```

**For macOS:**
```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

---

## 💰 Cost Comparison

| Option | Year 1 | Year 2+ | SmartScreen | Setup Time |
|--------|--------|---------|-------------|------------|
| **No Certificate** | $0 | $0 | ⚠️ Warnings (2-4 weeks to clear) | 0 days |
| **Standard Cert** | $199-474 | $199-474 | ⚠️ Some warnings (1-2 weeks) | 1-3 days |
| **EV Certificate** | $299-599 | $299-599 | ✅ No warnings (instant) | 3-7 days |

---

## 🎯 Recommended Strategy

### Phase 1: Launch (Week 1-4)
**Use:** No certificate (free)
- Launch app unsigned
- Users click "More info" → "Run anyway"
- Build initial user base
- Collect feedback

**Cost:** $0

### Phase 2: Growth (Month 2)
**Use:** Standard certificate ($199/year)
- Purchase SSL.com standard cert
- Sign all releases
- Professional appearance
- Reduced warnings

**Cost:** $199/year

### Phase 3: Scale (Month 6+)
**Use:** EV certificate ($299/year)
- Upgrade to EV cert
- Zero warnings
- Enterprise-ready
- Maximum trust

**Cost:** $299/year

---

## 📝 Certificate Setup Instructions

### Windows - Standard Certificate

1. **Purchase certificate** from SSL.com
2. **Download .pfx file** after verification
3. **Store securely:**
   ```bash
   mkdir certificates
   mv fileshot-cert.pfx certificates/
   # Add certificates/ to .gitignore
   ```

4. **Create sign.js:**
   ```javascript
   const { execSync } = require('child_process');
   
   exports.default = async function(configuration) {
     const certPath = './certificates/fileshot-cert.pfx';
     const certPassword = process.env.CERT_PASSWORD;
     
     execSync(`signtool sign /f "${certPath}" /p "${certPassword}" /tr http://timestamp.digicert.com /td sha256 /fd sha256 "${configuration.path}"`);
   };
   ```

5. **Set environment variable:**
   ```bash
   # Windows
   set CERT_PASSWORD=your_password_here
   
   # Mac/Linux
   export CERT_PASSWORD=your_password_here
   ```

6. **Build signed app:**
   ```bash
   npm run build:win
   ```

### macOS - Apple Developer Certificate

1. **Join Apple Developer Program** ($99/year)
   - https://developer.apple.com/programs/

2. **Create Developer ID Certificate:**
   - Xcode → Preferences → Accounts
   - Manage Certificates → + → Developer ID Application

3. **Get Team ID:**
   ```bash
   security find-identity -v -p codesigning
   ```

4. **Update package.json:**
   ```json
   {
     "build": {
       "mac": {
         "identity": "Developer ID Application: Your Name (TEAM_ID)"
       }
     }
   }
   ```

5. **Build signed app:**
   ```bash
   npm run build:mac
   ```

---

## 🚨 Security Best Practices

### Protect Your Certificate
- ✅ Never commit certificates to Git
- ✅ Add to .gitignore
- ✅ Use environment variables for passwords
- ✅ Store backups securely (encrypted)
- ✅ Revoke if compromised

### Environment Variables
```bash
# .env (add to .gitignore!)
CERT_PASSWORD=your_secure_password
APPLE_ID=your@email.com
APPLE_ID_PASSWORD=app-specific-password
```

---

## 📞 Support

**Certificate Issues:**
- SSL.com Support: https://www.ssl.com/support/
- DigiCert Support: https://www.digicert.com/support/

**Electron Builder:**
- Docs: https://www.electron.build/code-signing
- GitHub: https://github.com/electron-userland/electron-builder

---

## ✅ Verification

After signing, verify your certificate:

**Windows:**
```bash
signtool verify /pa /v FileShot-Setup-1.0.0.exe
```

**macOS:**
```bash
codesign --verify --deep --strict --verbose=2 FileShot.app
spctl -a -t exec -vv FileShot.app
```

---

## 🎉 Summary

**For immediate launch:** Start unsigned, accept warnings
**For professional image:** Get standard cert ($199/year)
**For zero warnings:** Get EV cert ($299/year)

**My recommendation:** Launch unsigned first, upgrade to EV cert after validating market fit.
