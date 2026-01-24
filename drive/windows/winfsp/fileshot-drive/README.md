# fileshot-drive (Windows / WinFsp)

This folder will contain the Windows native mount service (`fileshot-drive.exe`) that provides the **True FileShot Drive**.

## Current status
- **Scaffolded**: minimal WinFsp filesystem skeleton (not yet wired into the Electron app).
- **Not shippable yet**: until we support the required FileShot semantics (upload/download/delete) and have CI building the binary.

## What this is for
WinFsp is required so Windows Explorer can show **custom total/free space** (tier quota) for `FileShot (F:)`.

Electron/Node cannot control Explorer-reported disk stats when using `SUBST`, which is why this native component exists.

## Roadmap (Windows)
1) Mount an empty drive with quota-based volume stats (Explorer shows the right capacity/free space).
2) Make root list + open/read for remote files.
3) Implement create/write/close => stage + ZKE upload.
4) Implement delete/rename/move.

## References
- WinFsp tutorial: https://github.com/winfsp/winfsp/blob/master/doc/WinFsp-Tutorial.asciidoc
