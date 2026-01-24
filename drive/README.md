# FileShot Drive (True Mounted Volume)

This folder will contain the **native mount service** and related docs.

Important distinction:
- The existing feature in `main.js` uses `SUBST` (drive letter -> local folder). That is a *drop-folder UX* and **cannot** control Explorer/Finder “capacity/free space”.
- The **true drive** requires an OS filesystem mount (Windows: WinFsp, macOS: macFUSE, Linux: FUSE).

High-level architecture:
- Electron app: auth UI, settings, tray, status, starts/stops mount service
- `fileshot-drive` service: actual filesystem implementation + tier quota reporting + ZKE upload/download

See `../FILESHOT_VIRTUAL_DRIVE_SPEC.md` for the hard requirements.
