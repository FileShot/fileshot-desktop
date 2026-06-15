# FileShot Desktop (Tauri 2)

New canonical desktop client for FileShot.io.

## Dev (this PC)

```powershell
cd fileshot-desktop
npm install
npm run tauri icon app-icon.png   # first time only
npm run tauri dev
```

## Build locally

```powershell
npm run tauri build
```

## Release (GitHub Actions)

Push a tag `desktop-v1.0.0` or run **Release Desktop** workflow manually. CI builds Windows, macOS, and Linux installers.

## Stack

- **Tauri 2** + Rust backend (API, ZKE FSZK streaming, uploads)
- **Vite + TypeScript** frontend (Filen-inspired shell)

## Open source

MIT licensed — see [LICENSE](LICENSE). CI runs on push/PR (`ci.yml`); releases via tag `desktop-v*` (`release.yml`). Code signing: [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md) (SignPath OSS + Apple notarization).

Replace contents of [github.com/FileShot/fileshot-desktop](https://github.com/FileShot/fileshot-desktop) with this tree when publishing.

- `desktop-app/` (Electron v1) — archived, do not use
- `desktop-app-v2/` (Electron v2) — archived, do not use
