import "./styles/tokens.css";
import "./styles/app.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  formatUsageLabel,
  normalizeFile,
  normalizeUsage,
  renderThumb,
  usagePercent,
  type UsageInfo,
} from "./lib/files";
import { icon, type IconName } from "./lib/icons";
import { log } from "./lib/log";
import {
  effectiveTierFromUser,
  isPremiumTier,
  tierDisplayName,
  normalizeTierName,
} from "./lib/tier";
import {
  api,
  formatBytes,
  formatDate,
  type AppSettings,
  type FileItem,
  type SessionState,
  type TransferItem,
} from "./lib/invoke";

type Section = "files" | "transfers" | "inbox" | "chat" | "tools" | "settings";
type FilesView = "drive" | "recents" | "favorites" | "links";
type SettingsView = "general" | "account" | "security" | "billing" | "apikeys";
type FileFilter = "all" | "image" | "video" | "zke" | "starred";
type SortBy = "date" | "name" | "size";
type ToolsView = "converter" | "pdf" | "compressor" | "paste" | "video-downloader" | "archive" | "virus-scanner";

interface AppState {
  session: SessionState | null;
  section: Section;
  filesView: FilesView;
  settingsView: SettingsView;
  files: FileItem[];
  transfers: TransferItem[];
  favorites: string[];
  activity: Array<{ id: string; kind: string; name: string; at: number; file_id?: string }>;
  usage: UsageInfo | null;
  search: string;
  fileFilter: FileFilter;
  sortBy: SortBy;
  selectedIds: Set<string>;
  toolsView: ToolsView;
  billingInterval: "month" | "year";
  contentAnim: boolean;
  authTab: "login" | "register";
  loading: boolean;
  error: string;
  shareUrl: string | null;
  settings: AppSettings | null;
  inbox: unknown[];
  chatRooms: unknown[];
  apiKeys: unknown[];
  keyringIds: Set<string>;
  userProfile: Record<string, unknown> | null;
  folders: Array<{ id: string; name: string }>;
}

const state: AppState = {
  session: null,
  section: "files",
  filesView: "drive",
  settingsView: "general",
  files: [],
  transfers: [],
  favorites: [],
  activity: [],
  usage: null,
  search: "",
  fileFilter: "all",
  sortBy: "date",
  selectedIds: new Set(),
  toolsView: "converter",
  billingInterval: "month",
  contentAnim: true,
  authTab: "login",
  loading: false,
  error: "",
  shareUrl: null,
  settings: null,
  inbox: [],
  chatRooms: [],
  apiKeys: [],
  keyringIds: new Set(),
  userProfile: null,
  folders: [],
};

const appEl = document.getElementById("app")!;

function logoImg(className: string, size = 18) {
  return `<img src="/favicon.ico" alt="" class="${className}" width="${size}" height="${size}" />`;
}

function authBrandLogo() {
  return `<img src="/logonew.png" alt="FileShot.io" class="auth-brand-logo" width="280" height="36" />`;
}

function titlebar() {
  return `
    <header class="titlebar">
      <div class="titlebar-brand">
        ${logoImg("titlebar-logo")}
        <span>FileShot</span>
      </div>
      <div class="titlebar-controls">
        <button class="tb-btn" data-win="min" title="Minimize">&#8211;</button>
        <button class="tb-btn" data-win="max" title="Maximize">&#9633;</button>
        <button class="tb-btn tb-close" data-win="close" title="Close">&#10005;</button>
      </div>
    </header>
  `;
}

function renderAuth() {
  return `
    ${titlebar()}
    <div class="auth-screen">
      <div class="auth-card glass">
        ${authBrandLogo()}
        <h1>${state.authTab === "login" ? "Login" : "Create account"}</h1>
        <p class="auth-sub">Enter your email and password to access your encrypted cloud drive.</p>
        <div class="auth-tabs">
          <button class="auth-tab ${state.authTab === "login" ? "active" : ""}" data-auth-tab="login">Sign In</button>
          <button class="auth-tab ${state.authTab === "register" ? "active" : ""}" data-auth-tab="register">Register</button>
        </div>
        ${state.error ? `<div class="auth-error">${escapeHtml(state.error)}</div>` : ""}
        <form id="authForm">
          <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" placeholder="you@example.com" required />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" name="password" placeholder="Password" required minlength="8" />
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:4px">
            ${state.authTab === "login" ? "Login" : "Create account"}
          </button>
        </form>
        <div class="auth-divider"><span>or</span></div>
        <div class="oauth-row">
          <button class="btn btn-ghost" data-oauth="google" style="width:100%">Continue with Google</button>
          <button class="btn btn-ghost" data-oauth="github" style="width:100%">Continue with GitHub</button>
        </div>
        <div class="auth-footer">
          <a href="#" data-open="https://fileshot.io/tos.html">Terms of Service</a>
          &nbsp;&middot;&nbsp;
          <a href="#" data-open="https://fileshot.io/privacy.html">Privacy</a>
        </div>
      </div>
    </div>
  `;
}

function sidebarNavItems(): string {
  if (state.section === "files") {
    const items: { id: FilesView; label: string; ic: IconName }[] = [
      { id: "drive", label: "Cloud Drive", ic: "cloud" },
      { id: "recents", label: "Recents", ic: "clock" },
      { id: "favorites", label: "Favorites", ic: "star" },
      { id: "links", label: "Shared Links", ic: "link" },
    ];
    return items
      .map(
        (i) =>
          `<div class="nav-item ${state.filesView === i.id ? "active" : ""}" data-files-view="${i.id}">${icon(i.ic, 18)}<span>${i.label}</span></div>`
      )
      .join("") + (state.folders.length ? `<div class="sidebar-divider">Folders</div>${state.folders.map((f) => `<div class="nav-item" data-folder-id="${escapeHtml(f.id)}">${icon("file", 16)}<span>${escapeHtml(f.name)}</span></div>`).join("")}` : "");
  }
  if (state.section === "tools") {
    const tools: { id: ToolsView; label: string }[] = [
      { id: "converter", label: "Converter" },
      { id: "pdf", label: "PDF Editor" },
      { id: "compressor", label: "Compressor" },
      { id: "paste", label: "Paste Bin" },
      { id: "video-downloader", label: "Video Downloader" },
      { id: "archive", label: "Archive Builder" },
      { id: "virus-scanner", label: "Virus Scanner" },
    ];
    return tools
      .map(
        (t) =>
          `<div class="nav-item ${state.toolsView === t.id ? "active" : ""}" data-tools-view="${t.id}">${icon("tools", 18)}<span>${t.label}</span></div>`
      )
      .join("");
  }
  if (state.section === "inbox") {
    const items = state.inbox as Array<{ request_id?: string; title?: string; receiveUrl?: string }>;
    const list = items
      .map(
        (i) =>
          `<div class="nav-item" data-inbox-open="${escapeHtml(i.receiveUrl || "")}">${icon("mail", 18)}<span>${escapeHtml(i.title || "Inbox")}</span></div>`
      )
      .join("");
    return `${list}${isProOrAbove() ? `<button class="btn btn-primary btn-sm" id="newInboxBtn" style="margin:12px 8px">New inbox</button>` : `<p class="inbox-gate">Receive Inbox requires Pro.</p><button class="btn btn-primary btn-sm upgrade-btn" data-upgrade="pro" style="margin:8px">Upgrade to Pro</button>`}`;
  }
  if (state.section === "settings") {
    const items: { id: SettingsView; label: string; ic: IconName }[] = [
      { id: "general", label: "General", ic: "settings" },
      { id: "account", label: "Account", ic: "file" },
      { id: "security", label: "Security", ic: "lock" },
      { id: "billing", label: "Billing", ic: "star" },
      { id: "apikeys", label: "API Keys", ic: "link" },
    ];
    return items
      .map(
        (i) =>
          `<div class="nav-item ${state.settingsView === i.id ? "active" : ""}" data-settings-view="${i.id}">${icon(i.ic, 18)}<span>${i.label}</span></div>`
      )
      .join("");
  }
  return "";
}

function sidebarTitle(): string {
  const titles: Record<Section, string> = {
    files: "Files",
    transfers: "Transfers",
    inbox: "Receive",
    chat: "Chats",
    tools: "Tools",
    settings: "Settings",
  };
  return titles[state.section];
}

function usagePct(): number {
  return state.usage ? usagePercent(state.usage) : 0;
}

function storageLabel(): string {
  if (!state.usage) return "Loading storage…";
  return formatUsageLabel(state.usage, formatBytes);
}

function currentTier(): string {
  return normalizeTierName(
    state.usage?.tier || state.session?.tier || effectiveTierFromUser(state.userProfile) || "free"
  );
}

function tierLabel(): string {
  return tierDisplayName(currentTier());
}

function isFreeTier(): boolean {
  const t = currentTier();
  return t === "free" || t === "lite";
}

function isProOrAbove(): boolean {
  return isPremiumTier(currentTier());
}

function sidebarAccount(): string {
  const email = state.session?.email || "Account";
  return `
    <div class="sidebar-account glass">
      <button class="sidebar-account-btn" data-section="settings" data-settings-view="account" type="button">
        <div class="account-avatar">${icon("file", 18)}</div>
        <div class="account-meta">
          <div class="account-email">${escapeHtml(email)}</div>
          <div class="account-tier">${escapeHtml(tierLabel())} plan</div>
        </div>
      </button>
      ${isFreeTier() ? `<button class="btn btn-primary btn-sm upgrade-btn" data-upgrade="pro" type="button">Upgrade to Pro</button>` : currentTier() === "pro" ? `<button class="btn btn-ghost btn-sm upgrade-btn" data-upgrade="creator" type="button">Upgrade to Creator</button>` : ""}
    </div>
  `;
}

function filteredFiles(): FileItem[] {
  let list = [...state.files];
  if (state.filesView === "favorites") {
    list = list.filter((f) => state.favorites.includes(f.fileId));
  } else if (state.filesView === "recents") {
    const recentIds = state.activity
      .filter((a) => a.file_id)
      .map((a) => a.file_id!);
    list = list.filter((f) => recentIds.includes(f.fileId));
    list.sort((a, b) => recentIds.indexOf(a.fileId) - recentIds.indexOf(b.fileId));
  } else if (state.filesView === "links") {
    list = list.filter((f) => f.customLink || f.isZeroKnowledge);
  }
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    list = list.filter((f) => f.fileName.toLowerCase().includes(q));
  }
  if (state.fileFilter === "image") {
    list = list.filter((f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.fileName));
  } else if (state.fileFilter === "video") {
    list = list.filter((f) => /\.(mp4|mov|webm|m4v)$/i.test(f.fileName));
  } else if (state.fileFilter === "zke") {
    list = list.filter((f) => f.isZeroKnowledge);
  } else if (state.fileFilter === "starred") {
    list = list.filter((f) => state.favorites.includes(f.fileId));
  }
  list.sort((a, b) => {
    if (state.sortBy === "name") return a.fileName.localeCompare(b.fileName);
    if (state.sortBy === "size") return b.fileSize - a.fileSize;
    return b.createdAt - a.createdAt;
  });
  return list;
}

function filesToolbarHtml(): string {
  const sel = state.selectedIds.size;
  return `
    <div class="files-toolbar glass">
      <div class="files-toolbar-row">
        <label class="select-all"><input type="checkbox" id="selectAllCb" ${sel && sel === filteredFiles().length ? "checked" : ""} /> Select all</label>
        <div class="search-wrap glass toolbar-search">${icon("search", 14)}<input class="search-input" id="toolbarSearch" placeholder="Search files…" value="${escapeHtml(state.search)}" /></div>
        <select id="fileFilterSel" class="filter-select">
          <option value="all" ${state.fileFilter === "all" ? "selected" : ""}>All types</option>
          <option value="image" ${state.fileFilter === "image" ? "selected" : ""}>Images</option>
          <option value="video" ${state.fileFilter === "video" ? "selected" : ""}>Videos</option>
          <option value="zke" ${state.fileFilter === "zke" ? "selected" : ""}>Encrypted</option>
          <option value="starred" ${state.fileFilter === "starred" ? "selected" : ""}>Starred</option>
        </select>
        <select id="sortBySel" class="filter-select">
          <option value="date" ${state.sortBy === "date" ? "selected" : ""}>Newest</option>
          <option value="name" ${state.sortBy === "name" ? "selected" : ""}>Name</option>
          <option value="size" ${state.sortBy === "size" ? "selected" : ""}>Size</option>
        </select>
      </div>
      ${sel > 0 ? `<div class="bulk-bar glass"><span>${sel} selected</span>
        <button class="btn btn-ghost btn-sm" data-bulk="copy">Copy links</button>
        <button class="btn btn-ghost btn-sm" data-bulk="download">Download</button>
        <button class="btn btn-ghost btn-sm" data-bulk="star">Star</button>
        <button class="btn btn-ghost btn-sm danger-text" data-bulk="delete">Delete</button>
        <button class="btn btn-ghost btn-sm" id="clearSelection">Clear</button></div>` : ""}
    </div>`;
}

function uploadZoneHtml(): string {
  return `
    <div class="upload-zone glass" id="dropzone" role="button" tabindex="0">
      <div class="upload-zone-icon">${icon("upload", 26)}</div>
      <h3>Drop files to upload</h3>
      <p>Drag and drop here, or click to browse</p>
    </div>
  `;
}

function renderFilesContent(): string {
  const files = filteredFiles();
  const token = state.session?.token ?? null;
  const showUpload = state.filesView === "drive";
  const grid =
    files.length === 0
      ? showUpload && !state.search
        ? ""
        : `<div class="empty-state glass" style="padding:32px;border-radius:var(--r16)"><div class="empty-icon">${icon("files", 28)}</div><h2>No files here</h2><p>Try another view or upload something new.</p></div>`
      : `
    <div class="file-grid">
      ${files
        .map(
          (f) => `
        <div class="file-card glass ${state.selectedIds.has(f.fileId) ? "selected" : ""}" data-file-id="${f.fileId}">
          <label class="file-select"><input type="checkbox" class="file-cb" data-id="${f.fileId}" ${state.selectedIds.has(f.fileId) ? "checked" : ""} /></label>
          ${renderThumb(f, token, state.keyringIds.has(f.fileId))}
          <div class="file-card-body">
            <div class="name" title="${escapeHtml(f.fileName)}">${escapeHtml(f.fileName)}</div>
            <div class="meta">${formatBytes(f.fileSize)} &middot; ${formatDate(f.createdAt)}${f.isZeroKnowledge ? " &middot; ZKE" : ""}${state.keyringIds.has(f.fileId) ? " &middot; Key" : ""}</div>
            <div class="file-actions">
              <button class="ibtn" data-action="copy" data-id="${f.fileId}" title="Copy link">${icon("copy", 15)}</button>
              <button class="ibtn" data-action="download" data-id="${f.fileId}" title="Download">${icon("download", 15)}</button>
              <button class="ibtn" data-action="open" data-id="${f.fileId}" title="Open in browser">${icon("link", 15)}</button>
              <button class="ibtn ${state.favorites.includes(f.fileId) ? "starred" : ""}" data-action="star" data-id="${f.fileId}" title="${state.favorites.includes(f.fileId) ? "Unstar" : "Star"}">${icon("star", 15)}</button>
              <button class="ibtn danger" data-action="delete" data-id="${f.fileId}" title="Delete">${icon("trash", 15)}</button>
            </div>
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;
  return `${showUpload ? uploadZoneHtml() : ""}${showUpload ? filesToolbarHtml() : ""}${grid}`;
}

function renderTransfersContent(): string {
  if (!state.transfers.length) {
    return `<div class="empty-state"><div class="empty-icon">${icon("transfers", 28)}</div><h2>No transfers yet</h2><p>Uploads and downloads will appear here.</p></div>`;
  }
  return `
    <div class="transfer-list">
      ${state.transfers
        .map(
          (t) => `
        <div class="transfer-item glass">
          <div class="transfer-top">
            <span>${escapeHtml(t.name)}</span>
            <span style="color:var(--text-muted)">${t.status} &middot; ${Math.round(t.progress)}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${t.progress}%"></div></div>
          ${t.share_url ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-copy-url="${escapeHtml(t.share_url)}">Copy share link</button>` : ""}
          ${t.error ? `<div class="auth-error">${escapeHtml(t.error)}</div>` : ""}
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderInboxContent(): string {
  return `<div class="embed-placeholder glass"><div class="display-h">Receive Inbox</div><p>Your receive inboxes load here. Select one in the sidebar or create a new inbox (Pro+).</p></div>`;
}

function renderToolsContent(): string {
  return `<div class="embed-placeholder glass"><div class="display-h">FileShot Tools</div><p>Select a tool from the sidebar.</p></div>`;
}

function renderChatContent(): string {
  return `<div class="embed-placeholder glass"><div class="display-h">Encrypted Chat</div><p>Chat loads in the panel beside this sidebar.</p></div>`;
}

function renderSettingsContent(): string {
  const s = state.settings!;
  if (state.settingsView === "general") {
    return `
      <div class="setting-row"><div><strong>Minimize to tray</strong><p>Hide window to tray instead of closing.</p></div>
        <div class="toggle ${s.minimize_to_tray ? "on" : ""}" data-toggle="minimize_to_tray"></div></div>
      <div class="setting-row"><div><strong>Start minimized</strong><p>Launch minimized to tray.</p></div>
        <div class="toggle ${s.start_minimized ? "on" : ""}" data-toggle="start_minimized"></div></div>
      <div class="setting-row"><div><strong>Chat notifications</strong><p>Enable chat notifications.</p></div>
        <div class="toggle ${s.chat_notifications ? "on" : ""}" data-toggle="chat_notifications"></div></div>
    `;
  }
  if (state.settingsView === "account") {
    return `
      <div class="setting-row"><div><strong>Email</strong><p>${escapeHtml(state.session?.email || "")}</p></div></div>
      <div class="setting-row"><div><strong>Plan</strong><p>${escapeHtml(tierLabel())}</p></div></div>
      <div class="setting-row"><div><strong>Storage</strong><p>${escapeHtml(storageLabel())}</p></div></div>
      ${isFreeTier() ? `<button class="btn btn-primary" data-upgrade="pro" type="button" style="margin-top:12px">Upgrade to Pro</button>` : currentTier() === "pro" ? `<button class="btn btn-ghost" data-upgrade="creator" type="button" style="margin-top:12px">Upgrade to Creator</button>` : ""}
      <div style="margin-top:16px"><label>Billing interval</label>
        <select id="billingIntervalSel" class="filter-select" style="margin-top:6px">
          <option value="month" ${state.billingInterval === "month" ? "selected" : ""}>Monthly</option>
          <option value="year" ${state.billingInterval === "year" ? "selected" : ""}>Annual (save)</option>
        </select></div>
      <button class="btn btn-ghost" data-open="https://fileshot.io/account-dashboard.html" style="margin-top:12px">Open web dashboard</button>
      <button class="btn btn-ghost" style="margin-left:8px;margin-top:12px" id="logoutBtn">Sign out</button>
    `;
  }
  if (state.settingsView === "security") {
    return `
      <p style="color:var(--t2);margin-bottom:16px;font-size:13px;line-height:1.5">Export encryption keys for backup. Import keys saved in your browser so copy-link and download work for web uploads.</p>
      <button class="btn btn-primary" id="exportKeysBtn">Export master keys</button>
      <div style="margin-top:24px">
        <div class="form-group"><label>Import keys from browser</label>
          <p style="font-size:12px;color:var(--t3);margin:6px 0 8px">On fileshot.io, open DevTools console and run:<br><code style="font-size:11px">JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=&gt;k.startsWith('zk_key_')).map(([k,v])=&gt;[k.slice(7),v])))</code></p>
          <textarea id="importKeysJson" rows="5" placeholder='{"fileId":"hexkey",...}' style="width:100%;font-family:monospace;font-size:12px"></textarea>
        </div>
        <button class="btn btn-ghost" id="importKeysBtn">Import keys</button>
      </div>
      <div style="margin-top:24px">
        <div class="form-group"><label>Current password</label><input type="password" id="curPw" /></div>
        <div class="form-group"><label>New password</label><input type="password" id="newPw" /></div>
        <button class="btn btn-ghost" id="changePwBtn">Change password</button>
      </div>
    `;
  }
  if (state.settingsView === "billing") {
    return `<p style="margin-bottom:12px">Storage: ${escapeHtml(storageLabel())}</p>
      <p style="margin-bottom:12px">Plan: ${escapeHtml(tierLabel())}</p>
      ${isFreeTier() ? `<button class="btn btn-primary" data-upgrade="pro" type="button">Upgrade to Pro</button>` : ""}
      ${currentTier() === "pro" ? `<button class="btn btn-ghost" data-upgrade="creator" type="button" style="margin-left:8px">Upgrade to Creator</button>` : ""}
      <button class="btn btn-ghost" data-open="https://fileshot.io/pricing.html" style="margin-left:8px">Pricing page</button>`;
  }
  const keys = state.apiKeys as Array<{ name?: string; id?: string }>;
  return keys.length
    ? `<table class="list-table"><thead><tr><th>Key</th></tr></thead><tbody>${keys.map((k) => `<tr><td>${escapeHtml(k.name || k.id || "Key")}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty-state"><p>No API keys. Creator tier required.</p><button class="btn btn-ghost" data-open="https://fileshot.io/account-dashboard.html#api-keys">Manage on web</button></div>`;
}

function mainContent(): string {
  switch (state.section) {
    case "files":
      return renderFilesContent();
    case "transfers":
      return renderTransfersContent();
    case "inbox":
      return renderInboxContent();
    case "chat":
      return renderChatContent();
    case "tools":
      return renderToolsContent();
    case "settings":
      return renderSettingsContent();
    default:
      return "";
  }
}

function mainHeader(): string {
  const showSearch = state.section === "files";
  const showUpload = state.section === "files";
  return `
    <div class="main-header glass">
      <div class="main-title">${sidebarTitle()}${state.section === "files" ? ` / ${state.filesView.replace("drive", "Cloud Drive")}` : ""}</div>
      ${showSearch ? `<div class="search-wrap glass">${icon("search", 16)}<input class="search-input" id="searchInput" placeholder="Search files..." value="${escapeHtml(state.search)}" /></div>` : ""}
      ${showUpload ? `<button class="btn btn-primary" id="uploadBtn">${icon("plus", 16)} Upload</button>` : ""}
    </div>
  `;
}

function renderApp() {
  const pct = usagePct();
  appEl.innerHTML = `
    ${titlebar()}
    <div class="shell">
      <nav class="icon-rail glass">
        <button class="rail-btn ${state.section === "files" ? "active" : ""}" data-section="files" title="Files">${icon("files", 20)}</button>
        <button class="rail-btn ${state.section === "transfers" ? "active" : ""}" data-section="transfers" title="Transfers">${icon("transfers", 20)}</button>
        <button class="rail-btn ${state.section === "inbox" ? "active" : ""}" data-section="inbox" title="Receive Inbox">${icon("mail", 20)}</button>
        <button class="rail-btn ${state.section === "chat" ? "active" : ""}" data-section="chat" title="Chat">${icon("chat", 20)}</button>
        <button class="rail-btn ${state.section === "tools" ? "active" : ""}" data-section="tools" title="Tools">${icon("tools", 20)}</button>
        <div class="rail-spacer"></div>
        <button class="rail-btn ${state.section === "settings" ? "active" : ""}" data-section="settings" title="Settings">${icon("settings", 20)}</button>
      </nav>
      <aside class="sidebar glass">
        <div class="sidebar-header display-h">${sidebarTitle()}</div>
        <div class="sidebar-nav">${sidebarNavItems()}</div>
        ${sidebarAccount()}
        <div class="sidebar-footer">
          <div class="storage-label">${storageLabel()}</div>
          <div class="storage-bar"><div class="storage-fill" style="width:${pct}%"></div></div>
        </div>
      </aside>
      <main class="main">
        ${mainHeader()}
        <div class="main-content ${state.contentAnim ? "content-enter" : ""}">${mainContent()}</div>
      </main>
    </div>
    ${state.shareUrl ? `<div class="share-panel glass" id="sharePanel"><strong>Share link ready</strong><input class="share-url" readonly value="${escapeHtml(state.shareUrl)}" /><button class="btn btn-primary btn-sm" id="copyShareBtn">Copy link</button><button class="btn btn-ghost btn-sm" id="dismissShare">Dismiss</button></div>` : ""}
  `;
  bindAppEvents();
  void loadZkeThumbs();
}

async function loadZkeThumbs() {
  if (state.section !== "files") return;
  for (const f of filteredFiles()) {
    if (!f.isZeroKnowledge || !state.keyringIds.has(f.fileId)) continue;
    const card = document.querySelector(`[data-file-id="${f.fileId}"] .file-thumb`);
    if (!card || card.classList.contains("has-thumb")) continue;
    try {
      const path = await api.previewThumb(f.fileId, true);
      if (!path) continue;
      card.classList.add("has-thumb", "media");
      card.innerHTML = `<img src="${convertFileSrc(path)}" alt="" loading="lazy" />`;
    } catch {
      /* preview optional */
    }
  }
}

function render() {
  if (!state.session?.token) {
    appEl.innerHTML = renderAuth();
    bindAuthEvents();
    return;
  }
  state.contentAnim = true;
  renderApp();
  requestAnimationFrame(() => {
    state.contentAnim = false;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

async function refreshData() {
  try {
    const [filesRes, usageRes, favorites, activity, transfers, settings, keyIds, foldersRes] = await Promise.all([
      api.filesList(),
      api.filesUsage(),
      api.favoritesList(),
      api.activityList(),
      api.transfersList(),
      api.settingsGet(),
      api.keyringIds(),
      api.foldersList().catch(() => ({ folders: [] })),
    ]);
    const files = (filesRes as { files?: unknown[] }).files || [];
    state.files = files.map((f) => normalizeFile(f as Record<string, unknown>));
    state.usage = normalizeUsage(usageRes as Record<string, unknown>, state.session?.tier);
    if (state.session && state.usage.tier) {
      state.session.tier = state.usage.tier;
    }
    state.favorites = favorites;
    state.activity = activity;
    state.transfers = transfers;
    state.settings = settings;
    state.keyringIds = new Set(keyIds);
    const rawFolders = (foldersRes as { folders?: Array<{ id?: string; folder_id?: string; name?: string }> }).folders || [];
    state.folders = rawFolders.map((f) => ({
      id: String(f.id ?? f.folder_id ?? ""),
      name: String(f.name ?? "Folder"),
    })).filter((f) => f.id);
    log(`refreshData: ${state.files.length} files, usage=${state.usage.usage}, tier=${state.usage.tier}`);
  } catch (e) {
    log(`refreshData error: ${e}`);
    console.error(e);
  }
}

async function syncProfile() {
  try {
    const [me, sub] = await Promise.all([
      api.authMe(),
      api.paymentsSubscription().catch(() => null),
    ]);
    const user = (me as { user?: Record<string, unknown> }).user;
    if (user) {
      state.userProfile = user;
      if (user.email) state.session!.email = String(user.email);
      const tier = effectiveTierFromUser(user);
      state.session!.tier = tier;
      if (state.usage) state.usage.tier = tier;
    }
    if (sub && state.userProfile) {
      state.userProfile.subscription_details = sub;
    }
    if (!state.session?.csrf_token) {
      await api.authRefreshCsrf();
      state.session = await api.authGetSession();
    }
  } catch (e) {
    log(`syncProfile error: ${e}`);
  }
}

async function startUpgrade(tier: string) {
  try {
    await api.authRefreshCsrf();
    const res = await api.paymentsCheckout(tier, state.billingInterval);
    const url = res.url;
    if (!url) throw new Error("No checkout URL returned");
    log(`upgrade checkout: ${tier} ${state.billingInterval}`);
    openUrl(url);
    setTimeout(() => {
      syncProfile().then(() => refreshData().then(render));
    }, 8000);
  } catch (e) {
    state.error = String(e);
    log(`upgrade error: ${e}`);
    alert(String(e));
  }
}

async function loadSectionData() {
  if (state.section === "inbox") {
    try {
      const res = await api.inboxList();
      state.inbox = (res as { inboxes?: unknown[] }).inboxes || [];
      if (isProOrAbove()) {
        await api.embedOpen("https://fileshot.io/inbox.html?embed=1");
      } else {
        api.embedClose();
      }
    } catch {
      state.inbox = [];
    }
  } else if (state.section === "chat") {
    try {
      await api.embedOpen("https://fileshot.io/chat.html?embed=1");
    } catch (e) {
      log(`chatOpen error: ${e}`);
    }
  } else if (state.section === "tools") {
    const path = state.toolsView === "virus-scanner" ? "virus-scanner" : state.toolsView;
    try {
      await api.embedOpen(`https://fileshot.io/tools/${path}?embed=1`);
    } catch (e) {
      log(`tools embed error: ${e}`);
    }
  } else {
    api.embedClose().catch(() => {});
  }
  if (state.settingsView === "apikeys") {
    try {
      const res = await api.apiKeysList();
      state.apiKeys = (res as { keys?: unknown[] }).keys || [];
    } catch {
      state.apiKeys = [];
    }
  }
}

async function doUpload(paths?: string[]) {
  const selected = paths ?? (await api.pickFiles());
  if (!selected.length) return;
  log(`upload start: ${selected.length} file(s)`);
  state.section = "transfers";
  render();
  try {
    const urls = await api.uploadPaths(selected);
    if (urls.length) {
      state.shareUrl = urls[urls.length - 1];
      log(`upload done: ${urls[urls.length - 1]}`);
    }
    await refreshData();
    render();
  } catch (e) {
    log(`upload error: ${e}`);
    state.error = String(e);
    render();
  }
}

function bindAuthEvents() {
  document.querySelectorAll("[data-auth-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      state.authTab = (el as HTMLElement).dataset.authTab as "login" | "register";
      state.error = "";
      render();
    });
  });
  document.getElementById("authForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.error = "";
    state.loading = true;
    const fd = new FormData(e.target as HTMLFormElement);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    try {
      if (state.authTab === "login") await api.authLogin(email, password);
      else await api.authRegister(email, password);
      state.session = await api.authGetSession();
      await syncProfile();
      await refreshData();
      render();
    } catch (err) {
      state.error = String(err);
      log(`auth error: ${err}`);
      render();
    }
  });
  document.querySelectorAll("[data-oauth]").forEach((el) => {
    el.addEventListener("click", async () => {
      const p = (el as HTMLElement).dataset.oauth as "google" | "github";
      state.error = "";
      try {
        await api.authOauth(p);
        state.session = await api.authGetSession();
        await syncProfile();
        await refreshData();
        render();
      } catch (err) {
        state.error = String(err);
        render();
      }
    });
  });
  bindCommonEvents();
}

function bindAppEvents() {
  document.querySelectorAll("[data-section]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.section = (el as HTMLElement).dataset.section as Section;
      await loadSectionData();
      render();
    });
  });
  document.querySelectorAll("[data-tools-view]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.toolsView = (el as HTMLElement).dataset.toolsView as ToolsView;
      await loadSectionData();
      render();
    });
  });
  document.getElementById("newInboxBtn")?.addEventListener("click", async () => {
    const title = prompt("Inbox name:");
    if (!title?.trim()) return;
    try {
      await api.inboxCreate(title.trim());
      await loadSectionData();
      render();
    } catch (e) {
      alert(String(e));
    }
  });
  document.querySelectorAll("[data-inbox-open]").forEach((el) => {
    el.addEventListener("click", () => {
      const url = (el as HTMLElement).dataset.inboxOpen;
      if (url) openUrl(url);
    });
  });
  document.getElementById("toolbarSearch")?.addEventListener("input", (e) => {
    state.search = (e.target as HTMLInputElement).value;
    render();
  });
  document.getElementById("fileFilterSel")?.addEventListener("change", (e) => {
    state.fileFilter = (e.target as HTMLSelectElement).value as FileFilter;
    render();
  });
  document.getElementById("sortBySel")?.addEventListener("change", (e) => {
    state.sortBy = (e.target as HTMLSelectElement).value as SortBy;
    render();
  });
  document.getElementById("billingIntervalSel")?.addEventListener("change", (e) => {
    state.billingInterval = (e.target as HTMLSelectElement).value as "month" | "year";
  });
  document.getElementById("selectAllCb")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const files = filteredFiles();
    state.selectedIds = on ? new Set(files.map((f) => f.fileId)) : new Set();
    render();
  });
  document.querySelectorAll(".file-cb").forEach((el) => {
    el.addEventListener("change", (e) => {
      const id = (el as HTMLElement).dataset.id!;
      const on = (e.target as HTMLInputElement).checked;
      if (on) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      render();
    });
  });
  document.getElementById("clearSelection")?.addEventListener("click", () => {
    state.selectedIds.clear();
    render();
  });
  document.querySelectorAll("[data-bulk]").forEach((el) => {
    el.addEventListener("click", async () => {
      const action = (el as HTMLElement).dataset.bulk!;
      const ids = [...state.selectedIds];
      if (!ids.length) return;
      if (action === "delete" && !confirm(`Delete ${ids.length} file(s)?`)) return;
      for (const id of ids) {
        const file = state.files.find((f) => f.fileId === id);
        if (action === "delete") await api.filesDelete(id);
        else if (action === "star") state.favorites = await api.favoritesToggle(id);
        else if (action === "copy" && file) {
          const url = await api.fileShareUrl(file.fileId, file.customLink);
          await navigator.clipboard.writeText(url);
        } else if (action === "download" && file) {
          const path = await api.pickSavePath(file.fileName);
          if (path) await api.downloadFile(id, path);
        }
      }
      state.selectedIds.clear();
      await refreshData();
      render();
    });
  });
  document.querySelectorAll("[data-files-view]").forEach((el) => {
    el.addEventListener("click", () => {
      state.filesView = (el as HTMLElement).dataset.filesView as FilesView;
      render();
    });
  });
  document.querySelectorAll("[data-settings-view]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.settingsView = (el as HTMLElement).dataset.settingsView as SettingsView;
      await loadSectionData();
      render();
    });
  });
  document.getElementById("uploadBtn")?.addEventListener("click", () => doUpload());
  document.getElementById("searchInput")?.addEventListener("input", (e) => {
    state.search = (e.target as HTMLInputElement).value;
    render();
  });
  const bindDrop = (el: HTMLElement | null) => {
    if (!el) return;
    el.addEventListener("click", () => {
      if (el.id === "dropzone") doUpload();
    });
    el.addEventListener("keydown", (e) => {
      if (el.id === "dropzone" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        doUpload();
      }
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("dragover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("dragover");
      const files = Array.from(e.dataTransfer?.files || []);
      const paths = files.map((f) => (f as File & { path?: string }).path).filter(Boolean) as string[];
      if (paths.length) await doUpload(paths);
    });
  };
  bindDrop(document.getElementById("dropzone"));
  if (state.section === "files") bindDrop(document.querySelector(".main-content"));
  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = (el as HTMLElement).dataset.id!;
      const action = (el as HTMLElement).dataset.action!;
      const file = state.files.find((f) => f.fileId === id);
      if (action === "copy" && file) {
        const url = await api.fileShareUrl(file.fileId, file.customLink);
        await navigator.clipboard.writeText(url);
        state.shareUrl = url;
        render();
      } else if (action === "open" && file) {
        const url = await api.fileShareUrl(file.fileId, file.customLink);
        openUrl(url);
      } else if (action === "download" && file) {
        const path = await api.pickSavePath(file.fileName);
        if (path) {
          await api.downloadFile(id, path);
          await refreshData();
          render();
        }
      } else if (action === "delete") {
        if (confirm("Delete this file permanently?")) {
          await api.filesDelete(id);
          await refreshData();
          render();
        }
      } else if (action === "star") {
        state.favorites = await api.favoritesToggle(id);
        render();
      }
    });
  });
  document.querySelectorAll("[data-copy-url]").forEach((el) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText((el as HTMLElement).dataset.copyUrl!);
    });
  });
  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", async () => {
      const key = (el as HTMLElement).dataset.toggle as keyof AppSettings;
      if (!state.settings) return;
      state.settings[key] = !state.settings[key];
      await api.settingsSet(state.settings);
      render();
    });
  });
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await api.authLogout();
    state.session = null;
    render();
  });
  document.getElementById("exportKeysBtn")?.addEventListener("click", async () => {
    const json = await api.exportKeyring();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fileshot-keys-backup.json";
    a.click();
  });
  document.getElementById("importKeysBtn")?.addEventListener("click", async () => {
    const raw = (document.getElementById("importKeysJson") as HTMLTextAreaElement)?.value?.trim();
    if (!raw) {
      alert("Paste the JSON from your browser first.");
      return;
    }
    try {
      const n = await api.importKeyring(raw);
      await refreshData();
      alert(`Imported ${n} key(s). Copy-link and download should work for those files.`);
      render();
    } catch (e) {
      alert(String(e));
    }
  });
  document.getElementById("changePwBtn")?.addEventListener("click", async () => {
    const cur = (document.getElementById("curPw") as HTMLInputElement).value;
    const neu = (document.getElementById("newPw") as HTMLInputElement).value;
    try {
      await api.userChangePassword(cur, neu);
      alert("Password updated.");
    } catch (e) {
      alert(String(e));
    }
  });
  document.getElementById("copyShareBtn")?.addEventListener("click", () => {
    if (state.shareUrl) navigator.clipboard.writeText(state.shareUrl);
  });
  document.querySelectorAll("[data-upgrade]").forEach((el) => {
    el.addEventListener("click", () => {
      startUpgrade((el as HTMLElement).dataset.upgrade || "pro");
    });
  });
  document.querySelector(".sidebar-account-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    state.section = "settings";
    state.settingsView = "account";
    await loadSectionData();
    render();
  });
  document.getElementById("dismissShare")?.addEventListener("click", () => {
    state.shareUrl = null;
    render();
  });
  bindCommonEvents();
}

function bindCommonEvents() {
  document.querySelectorAll("[data-win]").forEach((el) => {
    el.addEventListener("click", () => {
      const a = (el as HTMLElement).dataset.win;
      if (a === "min") api.windowMinimize();
      else if (a === "max") api.windowToggleMaximize();
      else if (a === "close") api.windowClose();
    });
  });
  document.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl((el as HTMLElement).dataset.open!);
    });
  });
}

async function boot() {
  state.session = await api.authGetSession();
  if (state.session?.token) {
    try {
      await syncProfile();
      await api.authMe();
      await refreshData();
      state.settings = await api.settingsGet();
      log("boot ok");
    } catch (e) {
      log(`boot auth failed: ${e}`);
      state.session = null;
      await api.authLogout();
    }
  }
  render();

  await api.onTransfersUpdated((items) => {
    state.transfers = items;
    if (state.session?.token) render();
  });
  await api.onTrayQuickUpload(() => doUpload());
}

boot();
