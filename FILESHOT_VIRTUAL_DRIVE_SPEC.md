# FileShot Virtual Drive (True Volume) — Spec + Implementation Plan

Status: **Not implemented yet** (current app uses `SUBST` mapping to a local folder; that cannot report custom capacity/free space in Explorer).

This document defines the **hard requirements** and a realistic implementation path for a true FileShot drive that appears in the OS file explorer as a mounted volume with a tier-based quota.

---

## 1) Hard requirements (non-negotiable)

### 1.1 Appears as a real drive / volume
- **Windows:** shows under **“This PC”** as a drive letter (e.g. `F:`).
- **macOS:** shows in Finder as a mounted volume.
- **Linux:** shows as a mounted filesystem (e.g. under `/mnt/fileshot` or user-chosen).

### 1.2 Capacity + free space must reflect FileShot tier quota
- Explorer/Finder must show:
  - **Total size** = tier quota (e.g. Free = **50 GB**)
  - **Free space** = quota remaining (quota - usage)
- This must **not** mirror the host disk (no “it looks like C:” / “it’s just a folder”).

### 1.3 File operations map to FileShot cloud (ZKE)
- Creating/copying a file into the drive uploads it to FileShot.
- Browsing the drive shows the user’s remote FileShot files/folders.
- Opening/reading a file downloads and decrypts it locally.
- Deleting a file deletes it remotely (with safety settings/confirmation behavior defined below).

### 1.4 Optional password support
- Users must be able to set an **optional password** per upload (or per folder default) from the drive workflow.
- This must remain compatible with FileShot’s **zero-knowledge encryption** model.

---

## 2) Constraints we must respect

### 2.1 Filesystem drivers are OS-specific
To report custom volume size/free space, we need a **real filesystem mount**:
- Windows: **WinFsp** (chosen) or Dokan-style user-mode filesystem
- macOS: macFUSE (or native FS APIs)
- Linux: FUSE

Electron alone cannot do this; it needs a companion native component.

#### Windows choice (decision)

We will implement the Windows “true drive” using **WinFsp**.

Why:
- It’s a mature, widely-used user-mode filesystem stack.
- It supports filesystem statistics reporting (total/free bytes), which we must control to match tier quota.
- It supports a FUSE-compatibility path, which helps keep the long-term cross-platform story coherent.

Non-goal (explicit): `SUBST` can never meet the “Explorer shows tier quota capacity” requirement, because it inherits capacity from the underlying disk.

### 2.2 Encryption model
FileShot’s ZKE model means:
- The server must never learn the plaintext
- Client must encrypt before upload
- Client must decrypt after download

The current desktop app already has ZKE streaming container support in `utils/zke-stream.js`.

### 2.3 Explorer/Finder cannot prompt for “password” mid-copy
File managers don’t provide a standard UI to prompt for extra metadata when copying.
So we need a deterministic UX mechanism (see §5).

---

## 3) Proposed architecture (no compromises)

### 3.1 Split responsibilities

**A) Electron app (UI + auth + settings)**
- Login, store auth token
- Shows status (mounted/unmounted, quota used/remaining)
- Starts/stops the mount service
- Handles configuration (drive letter, mount point, sync rules)

**B) `fileshot-drive` mount service (native executable)**
- Implements filesystem callbacks (list/read/write/delete/etc)
- Reports filesystem statistics (total bytes, free bytes)
- Streams encryption/decryption
- Talks to FileShot API using the user token

Electron communicates with the service over a local IPC channel:
- Windows named pipe / localhost loopback HTTP
- macOS/Linux: Unix domain socket / localhost

### 3.2 Why a separate service is required
- Node/Electron cannot reliably implement a filesystem driver
- A dedicated service can be:
  - restarted independently
  - kept minimal for security
  - packaged per OS

---

## 4) Filesystem semantics

### 4.1 Path layout
Default layout:
- `/` (root)
  - `My Files/` (remote user root)
  - `Shared With Me/` (optional, later)
  - `.fileshot/` (special config folder; see §5)

We can start simpler: `/` == user’s file root.

### 4.2 Upload behavior
When a file is copied into the mounted drive:
- The mount service receives write operations
- It buffers to a local temp file
- On close/flush, it:
  1) encrypts to FSZK (streaming)
  2) performs pre-upload
  3) uploads chunks
  4) finalizes
  5) exposes a stable remote entry in the drive

### 4.3 Download behavior
When a file is opened:
- Service downloads encrypted blob
- Decrypts on the fly or to temp
- Serves plaintext bytes to the filesystem reader

### 4.4 Delete behavior
Options (must be decided):
- Immediate remote delete
- Or move-to-trash semantics (special folder)

### 4.5 Offline / caching
- Minimal v1: small read cache + write staging only
- Later: full offline pinning

---

## 5) Optional password UX (works in file explorers)

We need a mechanism that does not require interactive prompts.

### Option A (recommended): folder-level config file
- In any folder, user can create/edit:
  - `.fileshot/settings.json`
- Example keys:
  - `defaultPassphrase` (or password hint; careful)
  - `requirePassphrase: true/false`
  - `defaultExpirationHours`
  - `defaultMaxDownloads`

Security note: storing passphrases in plaintext on disk is risky.
Better: store an identifier that tells Electron to fetch the secret from OS keychain.

### Option B: sidecar metadata files
- For `photo.jpg` allow `photo.jpg.fileshot.json`
- Contains upload settings for that one file

### Option C: extended attributes
- Use xattrs/ADS where supported
- Not cross-platform reliable; keep as later enhancement

---

## 6) Cross-platform plan

### Phase 1: Windows true drive (priority)
- Implement `fileshot-drive.exe` using **WinFsp** (user-mode filesystem).
- Must support:
  - directory listing
  - file read
  - file create/write/close->upload
  - delete
  - **disk free/total reporting based on tier quota**

### Phase 2: macOS mount
- Implement `fileshot-drive` via macFUSE

### Phase 3: Linux mount
- Implement via FUSE3

---

## 7) Release/build requirements

- GitHub Actions builds installers for:
  - Windows (NSIS)
  - macOS (DMG/ZIP)
  - Linux (AppImage/DEB/RPM)
- The mount service binaries must be included inside the Electron app bundle and signed/notarized later.

---

## 8) Acceptance tests (what “done” means)

### Windows
- In Explorer, `FileShot (F:)` shows:
  - Capacity: **50 GB** for Free tier
  - Free space decreases as usage increases
- Copying a file into `F:` uploads it to FileShot and the file appears in the user’s account
- Opening a file in `F:` downloads/decrypts and opens correctly
- No “C drive mirror” behavior

### macOS/Linux
- Same semantics, appropriate mount points

---

## 9) Current state in this repo

- There is an existing “FileShot Drive” feature implemented with `SUBST` mapping to `app.getPath('userData')/vault/drive-inbox`.
- This is useful as a drop-folder workflow, but it **cannot** meet the quota/capacity requirement.

Next step is implementing the native mount service and switching the UI to prefer the true mount.
