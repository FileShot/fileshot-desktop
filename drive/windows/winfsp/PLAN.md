# Windows True Drive Plan (WinFsp)

Goal: A mounted `FileShot (F:)` drive that reports **tier quota** as total/free space and maps file operations to FileShot cloud with ZKE.

## Why WinFsp
- User-mode filesystem driver with a stable API and good compatibility.
- Supports reporting custom volume stats (required for tier-based capacity/free space).
- Has a FUSE-compatibility option that can reduce duplicated logic later.

## Components

### 1) Mount service executable (`fileshot-drive.exe`)
Responsibilities:
- Mount a filesystem at a drive letter (e.g. `F:`).
- Implement filesystem callbacks:
  - list directories
  - create/write/close => stage then upload
  - open/read => download+decrypt
  - rename/move
  - delete
- Report filesystem stats:
  - Total bytes = quota limit for the user’s tier (e.g. Free = 50GB)
  - Free bytes = max(0, quota - current usage)

Configuration inputs:
- auth token (short-lived access token stored by Electron)
- API base URL
- mount letter
- local cache/staging directory
- current usage + limit (periodically refreshed)

Drive letter selection:
- The app stores a **preferred** letter (default `F:`).
- At mount time:
  1) try preferred
  2) if it's already in use or mount fails, auto-try a sane list (e.g. `F..Z`, then `E`, then `D`)
  3) avoid `A/B` (legacy) and `C` (system)
- If no drive letter is available, we show a clear error and offer a “mount to folder path” fallback (optional).

IPC:
- Expose a local control API (named pipe or localhost) for:
  - start/stop
  - status (mounted, letter, errors)
  - current quota (usage/limit)

### 2) Electron integration
- Detect whether WinFsp is installed.
- UI flow:
  - enable/disable “True Drive”
  - choose drive letter
  - show quota and mount status
- Fail gracefully:
  - if WinFsp missing -> offer install instructions / link
  - if mount fails -> show actionable error

## Password / upload options from Explorer
Explorer doesn’t provide “prompt for password” mid-copy.

We will support a deterministic mechanism:
- Folder config file: `.fileshot/settings.json`
- Electron stores secrets in OS keychain; the config references a keychain entry id.

Example:
```json
{
  "upload": {
    "passphraseRef": "keychain:fileshot:default-passphrase",
    "expirationHours": 24,
    "maxDownloads": 5
  }
}
```

## Phased delivery (Windows first)
1) Read-only mount (list + open/download/decrypt) + correct quota stats
2) Write/upload path (create/write/close => upload)
3) Delete/rename/move
4) Offline cache/pinning

## Definition of done (Windows)
- Explorer shows `FileShot (F:)` with total/free matching tier quota.
- Upload via copy into drive works reliably.
- Download/open from drive works.
- No “mirrors C:” behavior.
