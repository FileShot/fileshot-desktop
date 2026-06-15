# Code signing (FileShot Desktop)

## Windows — SignPath Foundation (recommended, free for OSS)

1. Apply at [signpath.org/open-source](https://signpath.org/open-source)
2. Link the public GitHub repo `FileShot/fileshot-desktop`
3. Add GitHub secrets: `SIGNPATH_API_TOKEN`, `SIGNPATH_ORG_ID`, `SIGNPATH_PROJECT_SLUG`
4. On release tag `desktop-v*`, workflow submits artifacts for signing (manual approval per release)

## macOS — Apple Developer Program ($99/yr)

Required for Gatekeeper + notarization. Add to GitHub secrets:

- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

`tauri-action` uses these on `macos-latest` builds.

## Linux

Ship unsigned AppImage/deb (standard for OSS).

## Fallback — Azure Artifact Signing (~$10/mo)

If SignPath is delayed, use Azure Artifact Signing with `signCommand` in `tauri.conf.json`. See [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/).
