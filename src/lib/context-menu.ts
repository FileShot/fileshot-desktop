import { icon } from "./icons";

export interface ContextMenuState {
  fileId: string;
  x: number;
  y: number;
  submenu?: "move";
}

function clampMenuPos(x: number, y: number, w = 220, h = 380): { x: number; y: number } {
  const pad = 8;
  const maxX = window.innerWidth - w - pad;
  const maxY = window.innerHeight - h - pad;
  return { x: Math.max(pad, Math.min(x, maxX)), y: Math.max(pad, Math.min(y, maxY)) };
}

export function renderFileContextMenu(
  menu: ContextMenuState,
  opts: {
    isFavorite: boolean;
    folders: Array<{ id: string; name: string }>;
  }
): string {
  const { x, y } = clampMenuPos(menu.x, menu.y);
  const favLabel = opts.isFavorite ? "Unfavorite" : "Favorite";
  const favIcon = opts.isFavorite ? "heart-filled" : "heart";

  const folderItems =
    opts.folders.length === 0
      ? `<div class="ctx-item ctx-item-muted">No folders</div>`
      : opts.folders
          .map(
            (f) =>
              `<button type="button" class="ctx-item" data-ctx="move-folder" data-folder-id="${escapeAttr(f.id)}">${escapeHtml(f.name)}</button>`
          )
          .join("");

  const moveSub =
    menu.submenu === "move"
      ? `<div class="ctx-submenu" style="left:${x + 200}px;top:${y + 168}px">
          <button type="button" class="ctx-item" data-ctx="move-folder" data-folder-id="">Cloud Drive (root)</button>
          ${folderItems}
        </div>`
      : "";

  return `
    <div class="ctx-backdrop" data-ctx="close"></div>
    <div class="ctx-menu" style="left:${x}px;top:${y}px" role="menu">
      <button type="button" class="ctx-item" data-ctx="download">${icon("download", 16)} Download</button>
      <button type="button" class="ctx-item" data-ctx="public-link">${icon("link", 16)} Public link</button>
      <button type="button" class="ctx-item" data-ctx="share">${icon("share", 16)} Share</button>
      <div class="ctx-divider"></div>
      <button type="button" class="ctx-item" data-ctx="versions">${icon("history", 16)} Versions</button>
      <div class="ctx-divider"></div>
      <button type="button" class="ctx-item" data-ctx="favorite">${icon(favIcon, 16, favIcon === "heart-filled")} ${favLabel}</button>
      <button type="button" class="ctx-item" data-ctx="info">${icon("info", 16)} Info</button>
      <div class="ctx-divider"></div>
      <button type="button" class="ctx-item ctx-item-has-sub" data-ctx="move-toggle">${icon("move", 16)} Move ${icon("chevron-right", 14)}</button>
      <div class="ctx-divider"></div>
      <button type="button" class="ctx-item" data-ctx="copy-id">${icon("copy", 16)} Copy ID</button>
      <div class="ctx-divider"></div>
      <button type="button" class="ctx-item danger" data-ctx="trash">${icon("trash", 16)} Trash</button>
    </div>
    ${moveSub}
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
