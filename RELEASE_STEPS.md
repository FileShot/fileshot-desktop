# Releasing FileShot Desktop (GitHub build + auto-update)

This repo is configured to build through **GitHub Actions** and publish installers to **GitHub Releases**.

## What this accomplishes
- When you push a tag like `v1.4.8`, GitHub Actions builds the installers.
- `electron-builder` publishes artifacts to the **GitHub Release** for that tag.
- The app’s built-in `electron-updater` then offers the update to users.

## Prerequisites
- The repo exists on GitHub: `FileShot/fileshot-desktop`
- Default branch pushed to GitHub (usually `main`)
- GitHub Actions enabled

## Release steps
1) Ensure `desktop-app/package.json` version is correct (example: `1.4.8`).

2) Commit your changes.

3) Create a tag:
- Tag format should be `v<version>` (example: `v1.4.8`).

4) Push the tag to GitHub.

5) Watch the build:
- Go to GitHub → Actions
- Wait for Windows/macOS/Linux jobs to finish

6) Confirm the Release:
- Go to GitHub → Releases
- Open `v1.4.8`
- You should see:
  - `latest.yml`
  - Windows installer: `FileShot-Setup-1.4.8.exe`
  - (and Mac/Linux artifacts if those builds succeed)

## Notes
- This release is **unsigned**, so SmartScreen may warn. That’s expected.
- SmartScreen cannot be legitimately bypassed for free; the realistic options are: build reputation over time, or sign later when revenue supports it.
