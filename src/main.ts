import "./styles/tokens.css";
import "./styles/app.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  formatUsageLabel,
  normalizeFile,
  normalizeUsage,
  renderThumb,
  usagePercent,
  fileCategory,
  placeholderInnerHtml,
  placeholderTheme,
  extFromName,
  type UsageInfo,
} from "./lib/files";
import { icon, type IconName } from "./lib/icons";
import { renderFileContextMenu } from "./lib/context-menu";
import {
  renderUploadOptionsPanel,
  readUploadOptionsFromDom,
  type PendingUpload,
  type UploadSubmitOptions,
} from "./lib/upload-flow";
import { hideChatRoom, filterHiddenChats } from "./lib/hidden-chats";
import titlebarLogo from "./assets/fileshot-icon.png";
import {
  type SettingsView,
  renderGeneralSettings,
  renderAccountSettings,
  renderSubscriptionSettings,
  renderPlansGrid,
  avatarInitial,
  settingRow,
  toggleHtml,
} from "./lib/settings-ui";
import { showToast, showPrompt, showConfirm } from "./lib/ui-overlay";
import { log } from "./lib/log";
import {
  effectiveTierFromUser,
  isPremiumTier,
  tierDisplayName,
  normalizeTierName,
  bestTier,
  maxExpirationDays,
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
  bulkStatus: string | null;
  contextMenu: import("./lib/context-menu").ContextMenuState | null;
  activeChatRoom: string | null;
  activeInboxPath: string | null;
  activeFolderId: string | null;
  versionsPanel: {
    fileId: string;
    fileName: string;
    versions: Array<{ versionNumber?: number; fileName?: string; fileSize?: number; isLatest?: boolean }>;
  } | null;
  accountPanelOpen: boolean;
  pendingUpload: PendingUpload | null;
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
  bulkStatus: null,
  contextMenu: null,
  activeChatRoom: null,
  activeInboxPath: null,
  activeFolderId: null,
  versionsPanel: null,
  accountPanelOpen: false,
  pendingUpload: null,
};

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

function totalFileBytes(): number {
  return state.files.reduce((sum, f) => sum + f.fileSize, 0);
}

const appEl = document.getElementById("app")!;

function logoImg(className: string, size = 18) {
  return `<img src="${titlebarLogo}" alt="" class="${className}" width="${size}" height="${size}" />`;
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
      .join("") + (state.folders.length ? `<div class="sidebar-divider">Folders</div>${state.folders.map((f) => `<div class="nav-item ${state.activeFolderId === f.id ? "active" : ""}" data-folder-id="${escapeHtml(f.id)}">${icon("file", 16)}<span>${escapeHtml(f.name)}</span></div>`).join("")}` : "");
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
    const items = state.inbox as Array<{ request_id?: string; title?: string; slug?: string; subdomain?: string }>;
    const manage = `<div class="nav-item ${!state.activeInboxPath ? "active" : ""}" data-inbox-path="/inbox.html?embed=1">${icon("mail", 18)}<span>Manage inboxes</span></div>`;
    const list = items
      .map((i) => {
        const slug = i.slug || i.request_id || "";
        const path = i.subdomain ? "" : `/receive/${slug}?embed=1`;
        const active = state.activeInboxPath === path;
        return path
          ? `<div class="nav-item ${active ? "active" : ""}" data-inbox-path="${escapeHtml(path)}">${icon("mail", 18)}<span>${escapeHtml(i.title || "Inbox")}</span></div>`
          : `<div class="nav-item" data-inbox-external="${escapeHtml(`https://${i.subdomain}.fileshot.io`)}">${icon("mail", 18)}<span>${escapeHtml(i.title || "Inbox")}</span></div>`;
      })
      .join("");
    return `${manage}${list}${isProOrAbove() ? `<button class="btn btn-primary btn-sm" id="newInboxBtn" style="margin:12px 8px">+ New inbox</button>` : `<p class="inbox-gate" style="padding:8px 12px;font-size:12px;color:var(--t3)">Receive Inbox requires Pro.</p><button class="btn btn-primary btn-sm upgrade-btn" data-upgrade="pro" style="margin:8px">Upgrade to Pro</button>`}`;
  }
  if (state.section === "chat") {
    const rooms = state.chatRooms as Array<{ roomId?: string; name?: string; messageCount?: number; isOwner?: boolean }>;
    const create = `<div class="nav-item ${!state.activeChatRoom ? "active" : ""}" data-chat-room="">${icon("chat", 18)}<span>All chats</span></div>`;
    const list = rooms
      .map((r) => {
        const rid = r.roomId || "";
        const active = state.activeChatRoom === rid;
        const owner = r.isOwner === true;
        const actionTitle = owner ? "Delete chat" : "Leave chat";
        return `<div class="nav-item-wrap">
          <div class="nav-item ${active ? "active" : ""}" data-chat-room="${escapeHtml(rid)}">${icon("chat", 18)}<span>${escapeHtml(r.name || rid || "Chat")}</span>${r.messageCount ? `<span class="nav-badge">${r.messageCount}</span>` : ""}</div>
          <button type="button" class="nav-item-action" data-chat-delete="${escapeHtml(rid)}" data-chat-owner="${owner ? "1" : "0"}" title="${actionTitle}">${icon("trash", 14)}</button>
        </div>`;
      })
      .join("");
    return `${create}${list || `<p style="padding:12px;font-size:12px;color:var(--t3)">No chats yet.</p>`}<button class="btn btn-ghost btn-sm" type="button" data-chat-room="" style="margin:8px">+ Create chat</button>`;
  }
  if (state.section === "settings") {
    const items: { id: SettingsView; label: string; ic: IconName; accent?: boolean }[] = [
      { id: "general", label: "General", ic: "settings" },
      { id: "account", label: "Account", ic: "file" },
      { id: "security", label: "Security", ic: "lock", accent: true },
      { id: "plans", label: "Plans", ic: "star" },
      { id: "subscription", label: "Subscription", ic: "cloud" },
      { id: "apikeys", label: "API Keys", ic: "link" },
    ];
    return items
      .map(
        (i) =>
          `<div class="nav-item ${state.settingsView === i.id ? "active" : ""} ${i.accent ? "nav-item-accent" : ""}" data-settings-view="${i.id}">${icon(i.ic, 18)}<span>${i.label}</span></div>`
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
  const initial = avatarInitial(email);
  return `
    <div class="sidebar-account glass">
      <button class="sidebar-account-btn" data-section="settings" data-settings-view="account" type="button">
        <div class="account-avatar">${escapeHtml(initial)}</div>
        <div class="account-meta">
          <div class="account-email">${escapeHtml(email)}</div>
          <div class="account-tier">${escapeHtml(tierLabel())} · ${escapeHtml(storageLabel())}</div>
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
  if (state.activeFolderId) {
    list = list.filter((f) => f.folderId === state.activeFolderId);
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
        <button class="btn btn-ghost btn-sm" data-bulk="copy" ${state.bulkStatus ? "disabled" : ""}>Copy links</button>
        <button class="btn btn-ghost btn-sm" data-bulk="download" ${state.bulkStatus ? "disabled" : ""}>Download</button>
        <button class="btn btn-ghost btn-sm" data-bulk="star" ${state.bulkStatus ? "disabled" : ""}>Star</button>
        <button class="btn btn-ghost btn-sm danger-text" data-bulk="delete" ${state.bulkStatus ? "disabled" : ""}>Delete</button>
        <button class="btn btn-ghost btn-sm" id="clearSelection" ${state.bulkStatus ? "disabled" : ""}>Clear</button></div>` : ""}
      ${state.bulkStatus ? `<div class="bulk-progress glass"><span>${escapeHtml(state.bulkStatus)}</span><div class="progress-bar"><div class="progress-fill" style="width:100%;animation:pulse 1s ease infinite"></div></div></div>` : ""}
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
  const showUpload = state.filesView === "drive";
  const uploadBlock = state.pendingUpload
    ? renderUploadOptionsPanel(
        state.pendingUpload,
        currentTier(),
        !!(state.settings?.master_key_enabled && isPremiumTier(currentTier()))
      )
    : uploadZoneHtml();
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
          ${renderThumb(f, state.session?.token ?? null, state.keyringIds.has(f.fileId))}
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
  return `${showUpload ? uploadBlock : ""}${showUpload && !state.pendingUpload ? filesToolbarHtml() : ""}${grid}`;
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

function embedSitePath(): string | null {
  if (state.section === "tools") {
    const tv = state.toolsView === "virus-scanner" ? "virus-scanner" : state.toolsView;
    return `/tools/${tv}.html?embed=1`;
  }
  if (state.section === "chat") {
    const roomQ = state.activeChatRoom ? `&room=${encodeURIComponent(state.activeChatRoom)}` : "";
    return `/chat.html?embed=1${roomQ}`;
  }
  if (state.section === "inbox") {
    if (!isProOrAbove()) return null;
    return state.activeInboxPath || "/inbox.html?embed=1";
  }
  return null;
}

function embedSiteUrl(): string | null {
  const path = embedSitePath();
  return path ? `https://fileshot.io${path}` : null;
}

let lastEmbedUrl: string | null = null;
let embedResizeObserver: ResizeObserver | null = null;

function measureEmbedBounds(): { x: number; y: number; width: number; height: number } | null {
  const host = document.getElementById("embedHost");
  if (!host) return null;
  const r = host.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function attachEmbedResizeObserver() {
  const host = document.getElementById("embedHost");
  if (!host) {
    embedResizeObserver?.disconnect();
    embedResizeObserver = null;
    return;
  }
  if (embedResizeObserver) return;
  embedResizeObserver = new ResizeObserver(() => {
    void syncEmbedPanel(false);
  });
  embedResizeObserver.observe(host);
}

async function syncEmbedPanel(forceMove = true) {
  const url = embedSiteUrl();
  if (!url) {
    if (lastEmbedUrl !== null) {
      await api.embedClose();
      lastEmbedUrl = null;
    }
    return;
  }

  attachEmbedResizeObserver();
  const bounds = measureEmbedBounds();
  if (!bounds) {
    requestAnimationFrame(() => void syncEmbedPanel(forceMove));
    return;
  }

  if (url === lastEmbedUrl && !forceMove) {
    try {
      await api.embedResize(bounds);
    } catch (e) {
      log(`embed resize failed: ${e}`);
    }
    return;
  }

  try {
    await api.embedMove(url, bounds);
    lastEmbedUrl = url;
  } catch (e) {
    log(`embed sync failed: ${e}`);
    showToast("Could not load embedded page. Check your connection.", "error");
  }
}

function renderEmbedHost(_title: string): string {
  return `<div class="chat-embed embed-host" id="embedHost" aria-label="Embedded content"></div>`;
}

function renderInboxContent(): string {
  if (!isProOrAbove()) {
    return `<div class="embed-placeholder glass"><div class="display-h">Receive Inbox</div><p>Receive Inbox requires Pro.</p><button class="btn btn-primary upgrade-btn" data-upgrade="pro" type="button" style="margin-top:12px">Upgrade to Pro</button></div>`;
  }
  const path = state.activeInboxPath || "/inbox.html?embed=1";
  return renderEmbedHost("Receive Inbox");
}

function renderToolsContent(): string {
  return renderEmbedHost("Tools");
}

function renderChatContent(): string {
  return renderEmbedHost("Chat");
}

function renderSettingsContent(): string {
  const s = state.settings!;
  if (state.settingsView === "general") {
    return `<div class="settings-panel">${renderGeneralSettings(s, state.usage, state.files.length)}</div>`;
  }
  if (state.settingsView === "account") {
    return `<div class="settings-panel">${renderAccountSettings({
      email: state.session?.email || "",
      tier: currentTier(),
      usage: state.usage,
      fileCount: state.files.length,
      fileBytes: totalFileBytes(),
    })}</div>`;
  }
  if (state.settingsView === "security") {
    const pro = isPremiumTier(currentTier());
    return `<div class="settings-panel">
      <div class="settings-group">
        <h3 class="settings-group-title">Encryption keys</h3>
        <p class="settings-lead">Export keys for backup. Import browser keys so copy-link and download work for web uploads.</p>
        <button class="btn btn-primary" id="exportKeysBtn">Export master keys</button>
      </div>
      <div class="settings-group">
        <h3 class="settings-group-title">Upload master key ${pro ? "" : `<span class="pro-pill">PRO</span>`}</h3>
        <p class="settings-lead">Use one password for all protected uploads from this app. Keys stay in your link when password is off (same as the website).</p>
        ${settingRow(
          "Enable master key",
          "When password protect is on during upload, use this key instead of typing each time.",
          toggleHtml("master_key_enabled", !!(s.master_key_enabled && pro))
        )}
        <div class="form-group" style="margin-top:12px">
          <label>Master key</label>
          <input type="password" id="masterKeyInput" placeholder="${pro ? "At least 4 characters" : "Pro required"}" value="${escapeHtml(s.master_key || "")}" ${pro ? "" : "disabled"} />
        </div>
        <button class="btn btn-ghost btn-sm" type="button" id="saveMasterKeyBtn" ${pro ? "" : "disabled"}>Save master key</button>
      </div>
      <div class="settings-group">
        <h3 class="settings-group-title">Import from browser</h3>
        <p class="settings-lead" style="font-size:12px">On fileshot.io DevTools console:<br><code style="font-size:11px">JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=&gt;k.startsWith('zk_key_')).map(([k,v])=&gt;[k.slice(7),v])))</code></p>
        <textarea id="importKeysJson" rows="5" placeholder='{"fileId":"hexkey",...}' class="settings-textarea"></textarea>
        <button class="btn btn-ghost" id="importKeysBtn" style="margin-top:8px">Import keys</button>
      </div>
      <div class="settings-group">
        <h3 class="settings-group-title">Password</h3>
        <div class="form-group"><label>Current password</label><input type="password" id="curPw" /></div>
        <div class="form-group"><label>New password</label><input type="password" id="newPw" /></div>
        <button class="btn btn-ghost" id="changePwBtn">Change password</button>
      </div>
    </div>`;
  }
  if (state.settingsView === "plans") {
    return `<div class="settings-panel settings-panel-wide">${renderPlansGrid(state.billingInterval, currentTier())}</div>`;
  }
  if (state.settingsView === "subscription") {
    return `<div class="settings-panel">${renderSubscriptionSettings(currentTier(), state.usage)}</div>`;
  }
  const keys = state.apiKeys as Array<{ name?: string; id?: string }>;
  return `<div class="settings-panel">${keys.length
    ? `<table class="list-table"><thead><tr><th>Key</th></tr></thead><tbody>${keys.map((k) => `<tr><td>${escapeHtml(k.name || k.id || "Key")}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty-state"><p>No API keys. Creator tier required.</p><button class="btn btn-ghost" data-open="https://fileshot.io/account-dashboard.html#api-keys">Manage on web</button></div>`}</div>`;
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

function renderAccountPanel(): string {
  if (!state.accountPanelOpen) return "";
  const email = state.session?.email || "Account";
  const initial = avatarInitial(email);
  const pct = usagePct();
  return `
    <div class="account-panel-backdrop" data-account-close></div>
    <div class="account-panel glass" role="dialog" aria-label="Account">
      <div class="account-panel-head">
        <div class="account-avatar-lg">${escapeHtml(initial)}</div>
        <div>
          <div class="account-hero-email">${escapeHtml(email)}</div>
          <div class="account-hero-tier">${escapeHtml(tierLabel())} plan</div>
        </div>
        <button type="button" class="ibtn" data-account-close aria-label="Close">&#10005;</button>
      </div>
      <div class="account-panel-stats">
        <div><span class="stat-label">Storage</span><strong>${escapeHtml(storageLabel())}</strong></div>
        <div><span class="stat-label">Files</span><strong>${state.files.length}</strong></div>
        <div><span class="stat-label">Transfers</span><strong>${state.transfers.length}</strong></div>
      </div>
      <div class="storage-bar account-panel-bar"><div class="storage-fill" style="width:${pct}%"></div></div>
      <div class="account-panel-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-account-jump="account">Account settings</button>
        <button type="button" class="btn btn-ghost btn-sm" data-account-jump="subscription">Subscription</button>
        <button type="button" class="btn btn-ghost btn-sm" data-account-jump="security">Security</button>
        <button type="button" class="btn btn-ghost btn-sm" data-open="https://fileshot.io/account-dashboard.html">Web dashboard</button>
        ${isFreeTier() ? `<button type="button" class="btn btn-primary btn-sm upgrade-btn" data-upgrade="pro">Upgrade to Pro</button>` : currentTier() === "pro" ? `<button type="button" class="btn btn-ghost btn-sm upgrade-btn" data-upgrade="creator">Upgrade to Creator</button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm danger-text" id="accountSignOutBtn">Sign out</button>
      </div>
    </div>`;
}

function renderVersionsPanel(): string {
  const p = state.versionsPanel;
  if (!p) return "";
  const rows =
    p.versions.length === 0
      ? `<p class="versions-empty">No version history for this file.</p>`
      : `<table class="list-table"><thead><tr><th>Ver</th><th>Name</th><th>Size</th></tr></thead><tbody>${p.versions
          .map(
            (v) =>
              `<tr><td>v${v.versionNumber ?? "?"}${v.isLatest ? " *" : ""}</td><td>${escapeHtml(v.fileName ?? "")}</td><td>${formatBytes(v.fileSize ?? 0)}</td></tr>`
          )
          .join("")}</tbody></table>`;
  return `<div class="modal-backdrop" data-versions-close></div>
    <div class="modal-panel glass" role="dialog">
      <div class="modal-head"><strong>Versions — ${escapeHtml(p.fileName)}</strong><button type="button" class="ibtn" data-versions-close aria-label="Close">&#10005;</button></div>
      ${rows}
      <button type="button" class="btn btn-ghost btn-sm" data-versions-close style="margin-top:12px">Close</button>
    </div>`;
}

function renderApp() {
  const pct = usagePct();
  const email = state.session?.email || "A";
  const avatar = avatarInitial(email);
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
        <button class="rail-btn rail-avatar ${state.accountPanelOpen ? "active" : ""}" id="accountRailBtn" title="Account" type="button"><span class="rail-avatar-letter">${escapeHtml(avatar)}</span></button>
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
    ${state.contextMenu ? renderFileContextMenu(state.contextMenu, { isFavorite: state.favorites.includes(state.contextMenu.fileId), folders: state.folders }) : ""}
    ${renderVersionsPanel()}
    ${renderAccountPanel()}
  `;
  bindAppEvents();
  void loadZkeThumbs();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => void syncEmbedPanel(true));
  });
}

async function loadZkeThumbs() {
  if (state.section !== "files") return;
  for (const f of filteredFiles()) {
    if (!f.isZeroKnowledge || !state.keyringIds.has(f.fileId)) continue;
    if (fileCategory(f.fileName, f.mimeType) !== "image") continue;
    const card = document.querySelector(`[data-file-id="${f.fileId}"] .file-thumb`);
    if (!card || card.classList.contains("zke-loaded")) continue;
    try {
      const path = await api.previewThumb(f.fileId, true);
      if (!path) continue;
      const theme = placeholderTheme(extFromName(f.fileName), f.fileName, f.mimeType);
      const inner = placeholderInnerHtml(f);
      card.classList.add("zke-loaded", "media", "has-preview", "placeholder", `ext-${theme.slug}`);
      card.setAttribute("style", `--ph-a:${theme.c1};--ph-b:${theme.c2};--ph-accent:${theme.accent}`);
      card.innerHTML = `<img src="${convertFileSrc(path)}" alt="" loading="lazy" onerror="this.classList.add('broken')" /><div class="file-thumb-placeholder fallback-only">${inner}</div>`;
    } catch {
      /* preview optional */
    }
  }
}

function closeContextMenu() {
  state.contextMenu = null;
}

async function handleContextAction(action: string, el: HTMLElement) {
  const menu = state.contextMenu;
  if (!menu) return;
  const file = state.files.find((f) => f.fileId === menu.fileId);
  if (!file) {
    closeContextMenu();
    render();
    return;
  }

  if (action === "close") {
    closeContextMenu();
    render();
    return;
  }
  if (action === "move-toggle") {
    state.contextMenu = { ...menu, submenu: menu.submenu === "move" ? undefined : "move" };
    render();
    return;
  }

  try {
    if (action === "download") {
      const path = await api.pickSavePath(file.fileName);
      if (path) await api.downloadFile(file.fileId, path);
    } else if (action === "public-link" || action === "share") {
      const url = await api.fileShareUrl(file.fileId, file.customLink);
      await navigator.clipboard.writeText(url);
      state.shareUrl = url;
    } else if (action === "favorite") {
      state.favorites = await api.favoritesToggle(file.fileId);
    } else if (action === "info") {
      const lines = [
        `Name: ${file.fileName}`,
        `ID: ${file.fileId}`,
        `Size: ${formatBytes(file.fileSize)}`,
        `Created: ${formatDate(file.createdAt)}`,
        `Downloads: ${file.downloadCount}${file.maxDownloads ? ` / ${file.maxDownloads}` : ""}`,
        file.isZeroKnowledge ? "Zero-knowledge encrypted" : "",
        file.customLink ? `Custom link: ${file.customLink}` : "",
      ].filter(Boolean);
      showToast(lines.join(" · "), "info", 5000);
    } else if (action === "move-folder") {
      const folderId = el.dataset.folderId || null;
      await api.filesMove([file.fileId], folderId);
      await refreshData();
    } else if (action === "copy-id") {
      await navigator.clipboard.writeText(file.fileId);
    } else if (action === "versions") {
      if (!isPremiumTier(currentTier())) {
        showToast("File versioning requires Pro.", "error");
        closeContextMenu();
        render();
        return;
      }
      const res = await api.filesVersions(file.fileId);
      const versions = (res as { versions?: Array<{ versionNumber?: number; fileName?: string; fileSize?: number; isLatest?: boolean }> }).versions || [];
      state.versionsPanel = { fileId: file.fileId, fileName: file.fileName, versions };
    } else if (action === "trash") {
      const ok = await showConfirm({
        title: "Move to trash",
        message: `Move "${file.fileName}" to trash?`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (ok) {
        await api.filesDelete(file.fileId);
        await refreshData();
        showToast("File deleted", "success");
      }
    }
  } catch (e) {
    showToast(String(e), "error");
    log(`context action ${action} error: ${e}`);
  }

  closeContextMenu();
  render();
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
    const usageRaw = usageRes as Record<string, unknown>;
    const profileTier = effectiveTierFromUser(state.userProfile);
    const usageTier = normalizeTierName(String(usageRaw.tier ?? "free"));
    const sessionTier = state.session?.tier ? normalizeTierName(state.session.tier) : "free";
    const tier = bestTier(profileTier, usageTier, sessionTier);
    state.usage = normalizeUsage({ ...usageRaw, tier }, tier);
    if (state.session) {
      state.session.tier = tier;
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
      const tier = bestTier(
        effectiveTierFromUser(user),
        sub && (sub as { tier?: string }).tier
          ? normalizeTierName(String((sub as { tier?: string }).tier))
          : null,
        state.session?.tier
      );
      state.session!.tier = tier;
      if (state.usage) state.usage.tier = tier;
      log(`syncProfile tier=${tier}`);
    }
    if (sub && state.userProfile) {
      state.userProfile.subscription_details = sub;
    }
    state.session = await api.authSyncSession();
    if (!state.session?.csrf_token) {
      await api.authRefreshCsrf();
      state.session = await api.authGetSession();
    }
  } catch (e) {
    log(`syncProfile error: ${e}`);
  }
}

async function onAppFocus() {
  if (!state.session?.token) return;
  log("app focus — refreshing profile");
  await syncProfile();
  await refreshData();
  render();
}

async function startUpgrade(tier: string) {
  try {
    await api.authRefreshCsrf();
    const res = await api.paymentsCheckout(tier, state.billingInterval);
    const url = res.url;
    if (!url) throw new Error("No checkout URL returned");
    log(`upgrade checkout: ${tier} ${state.billingInterval}`);
    openUrl(url);
  } catch (e) {
    state.error = String(e);
    log(`upgrade error: ${e}`);
    showToast(String(e), "error");
  }
}

async function loadSectionData() {
  if (state.section === "inbox") {
    try {
      const res = await api.inboxList();
      state.inbox = (res as { inboxes?: unknown[] }).inboxes || [];
    } catch {
      state.inbox = [];
    }
  }
  if (state.section === "chat") {
    try {
      const res = await api.chatRooms();
      const rooms = (res as { rooms?: unknown[] }).rooms || [];
      state.chatRooms = filterHiddenChats(rooms as Array<{ roomId?: string }>);
    } catch {
      state.chatRooms = [];
    }
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

async function queueUpload(paths?: string[]) {
  const selected = paths ?? (await api.pickFiles());
  if (!selected.length) return;
  const names = selected.map((p) => p.split(/[/\\]/).pop() || "file");
  const maxExp = maxExpirationDays(currentTier());
  state.pendingUpload = {
    paths: selected,
    names,
    totalBytes: 0,
    expirationDays: maxExp ?? 180,
    maxDownloads: "",
    passwordEnabled: false,
    password: "",
    customLink: "",
  };
  state.section = "files";
  state.filesView = "drive";
  render();
}

async function runUploadWithOptions(opts: UploadSubmitOptions) {
  if (!state.pendingUpload?.paths.length) return;
  const paths = state.pendingUpload.paths;
  state.pendingUpload = null;
  log(`upload start: ${paths.length} file(s)`);
  state.section = "transfers";
  render();
  try {
    const urls = await api.uploadPaths(paths, {
      expiration_days: opts.expirationDays,
      max_downloads: opts.maxDownloads,
      password: opts.password,
      custom_link: opts.customLink,
      use_master_key: opts.useMasterKey,
    });
    if (urls.length) {
      state.shareUrl = urls[urls.length - 1];
      log(`upload done: ${urls[urls.length - 1]}`);
    } else {
      showToast("Upload failed — see Transfers for details.", "error");
    }
    await refreshData();
    render();
  } catch (e) {
    log(`upload error: ${e}`);
    state.error = String(e);
    render();
  }
}

async function doUpload(paths?: string[]) {
  await queueUpload(paths);
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
      const next = (el as HTMLElement).dataset.section as Section;
      if (state.section !== next) {
        lastEmbedUrl = null;
        void api.embedClose();
        if (next !== "inbox") state.activeInboxPath = null;
        if (next !== "chat") state.activeChatRoom = null;
      }
      state.section = next;
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
    const title = await showPrompt({
      title: "New inbox",
      label: "Inbox name",
      placeholder: "e.g. Client uploads",
      confirmLabel: "Create",
    });
    if (!title) return;
    try {
      await api.inboxCreate(title);
      showToast("Inbox created", "success");
      await loadSectionData();
      render();
    } catch (e) {
      showToast(String(e), "error");
    }
  });
  document.querySelectorAll("[data-inbox-path]").forEach((el) => {
    el.addEventListener("click", () => {
      const path = (el as HTMLElement).dataset.inboxPath || null;
      state.activeInboxPath = path;
      render();
    });
  });
  document.querySelectorAll("[data-inbox-external]").forEach((el) => {
    el.addEventListener("click", () => {
      const url = (el as HTMLElement).dataset.inboxExternal;
      if (url) openUrl(url);
    });
  });
  document.querySelectorAll("[data-chat-room]").forEach((el) => {
    el.addEventListener("click", () => {
      const room = (el as HTMLElement).dataset.chatRoom || null;
      state.activeChatRoom = room || null;
      render();
    });
  });
  document.querySelectorAll("[data-chat-delete]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const roomId = (el as HTMLElement).dataset.chatDelete;
      if (!roomId) return;
      hideChatRoom(roomId);
      state.chatRooms = (state.chatRooms as Array<{ roomId?: string }>).filter((r) => r.roomId !== roomId);
      if (state.activeChatRoom === roomId) {
        state.activeChatRoom = null;
        lastEmbedUrl = null;
        void api.embedClose();
      }
      render();
    });
  });
  document.querySelectorAll("[data-billing]").forEach((el) => {
    el.addEventListener("click", () => {
      state.billingInterval = (el as HTMLElement).dataset.billing as "month" | "year";
      render();
    });
  });
  document.querySelectorAll("[data-section-jump]").forEach((el) => {
    el.addEventListener("click", () => {
      state.section = "settings";
      state.settingsView = (el as HTMLElement).dataset.sectionJump as SettingsView;
      render();
    });
  });
  document.getElementById("themeSel")?.addEventListener("change", async (e) => {
    if (!state.settings) return;
    const theme = (e.target as HTMLSelectElement).value;
    state.settings.theme = theme;
    applyTheme(theme);
    await api.settingsSet(state.settings);
  });
  document.getElementById("deleteAllFilesBtn")?.addEventListener("click", async () => {
    if (!state.files.length) return;
    const ids = state.files.map((f) => f.fileId);
    const ok = await showConfirm({
      title: "Delete all files",
      message: `Delete all ${ids.length} files permanently? This cannot be undone.`,
      confirmLabel: "Delete all",
      danger: true,
    });
    if (!ok) return;
    state.bulkStatus = `Deleting 0/${ids.length}…`;
    render();
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      state.bulkStatus = `Deleting ${i + 1}/${ids.length}…`;
      render();
      try {
        await api.filesDelete(id);
      } catch {
        failed++;
      }
    }
    state.bulkStatus = null;
    await refreshData();
    render();
    if (failed) showToast(`Failed to delete ${failed} file(s).`, "error");
    else showToast("All files deleted", "success");
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
  document.querySelectorAll(".file-card").forEach((card) => {
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const ev = e as MouseEvent;
      const id = (card as HTMLElement).dataset.fileId!;
      state.contextMenu = { fileId: id, x: ev.clientX, y: ev.clientY };
      render();
    });
  });
  document.querySelectorAll("[data-ctx]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleContextAction((el as HTMLElement).dataset.ctx!, el as HTMLElement);
    });
  });
  if (state.contextMenu) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeContextMenu();
        render();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
  }
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
      if (!ids.length || state.bulkStatus) return;
      if (action === "delete") {
        const ok = await showConfirm({
          title: "Delete files",
          message: `Delete ${ids.length} file(s)?`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
      }

      const label =
        action === "delete"
          ? "Deleting"
          : action === "download"
            ? "Downloading"
            : action === "copy"
              ? "Copying links"
              : "Updating";
      const failures: string[] = [];
      state.bulkStatus = `${label} 0/${ids.length}…`;
      render();

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const file = state.files.find((f) => f.fileId === id);
        state.bulkStatus = `${label} ${i + 1}/${ids.length}…`;
        render();
        try {
          if (action === "delete") {
            await api.filesDelete(id);
            log(`bulk delete ok: ${id}`);
          } else if (action === "star") {
            state.favorites = await api.favoritesToggle(id);
          } else if (action === "copy" && file) {
            const url = await api.fileShareUrl(file.fileId, file.customLink);
            await navigator.clipboard.writeText(url);
          } else if (action === "download" && file) {
            const path = await api.pickSavePath(file.fileName);
            if (path) await api.downloadFile(id, path);
          }
        } catch (e) {
          failures.push(id);
          log(`bulk ${action} failed ${id}: ${e}`);
        }
      }

      state.selectedIds.clear();
      state.bulkStatus = null;
      await refreshData();
      render();
      if (failures.length) {
        showToast(`${action} failed for ${failures.length} file(s).`, "error");
      } else if (action === "delete") {
        showToast("Files deleted", "success");
      }
    });
  });
  document.querySelectorAll("[data-files-view]").forEach((el) => {
    el.addEventListener("click", () => {
      state.filesView = (el as HTMLElement).dataset.filesView as FilesView;
      state.activeFolderId = null;
      render();
    });
  });
  document.querySelectorAll("[data-folder-id]").forEach((el) => {
    el.addEventListener("click", () => {
      state.activeFolderId = (el as HTMLElement).dataset.folderId || null;
      state.filesView = "drive";
      render();
    });
  });
  document.querySelectorAll("[data-versions-close]").forEach((el) => {
    el.addEventListener("click", () => {
      state.versionsPanel = null;
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
  document.getElementById("uploadBtn")?.addEventListener("click", () => void queueUpload());
  document.getElementById("uploadOptionsCancel")?.addEventListener("click", () => {
    state.pendingUpload = null;
    render();
  });
  document.getElementById("uploadChangeFiles")?.addEventListener("click", () => void queueUpload());
  document.getElementById("uploadStartBtn")?.addEventListener("click", () => {
    if (!state.pendingUpload) return;
    const opts = readUploadOptionsFromDom(
      state.pendingUpload,
      currentTier(),
      !!(state.settings?.master_key_enabled && isPremiumTier(currentTier()))
    );
    if (!opts) return;
    void runUploadWithOptions(opts);
  });
  document.getElementById("uploadPwEnabled")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const pw = document.getElementById("uploadPassword") as HTMLInputElement | null;
    if (pw) pw.disabled = !on || !isPremiumTier(currentTier());
  });
  document.getElementById("searchInput")?.addEventListener("input", (e) => {
    state.search = (e.target as HTMLInputElement).value;
    render();
  });
  const bindDrop = (el: HTMLElement | null) => {
    if (!el) return;
    el.addEventListener("click", () => {
      if (el.id === "dropzone") void queueUpload();
    });
    el.addEventListener("keydown", (e) => {
      if (el.id === "dropzone" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        void queueUpload();
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
      if (paths.length) void queueUpload(paths);
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
        const ok = await showConfirm({
          title: "Delete file",
          message: "Delete this file permanently?",
          confirmLabel: "Delete",
          danger: true,
        });
        if (ok) {
          await api.filesDelete(id);
          await refreshData();
          showToast("File deleted", "success");
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
      if (!state.settings) return;
      const key = (el as HTMLElement).dataset.toggle as
        | "autostart"
        | "minimize_to_tray"
        | "start_minimized"
        | "master_key_enabled";
      if (key === "master_key_enabled" && !isPremiumTier(currentTier())) {
        showToast("Master key requires Pro.", "error");
        return;
      }
      state.settings[key] = !state.settings[key];
      await api.settingsSet(state.settings);
      render();
    });
  });
  document.getElementById("refreshSubscriptionBtn")?.addEventListener("click", async () => {
    await onAppFocus();
    showToast(
      isPremiumTier(currentTier()) ? `Subscription active: ${tierLabel()}` : "Still showing Free — try again in a moment if you just paid.",
      isPremiumTier(currentTier()) ? "success" : "info"
    );
  });
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await api.embedClose();
    await api.authLogout();
    state.session = null;
    render();
  });
  document.getElementById("saveMasterKeyBtn")?.addEventListener("click", async () => {
    if (!state.settings || !isPremiumTier(currentTier())) return;
    const val = (document.getElementById("masterKeyInput") as HTMLInputElement | null)?.value.trim() || "";
    if (val && val.length < 4) {
      showToast("Master key must be at least 4 characters.", "error");
      return;
    }
    state.settings.master_key = val || null;
    await api.settingsSet(state.settings);
    showToast("Master key saved.", "success");
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
      showToast("Paste the JSON from your browser first.", "error");
      return;
    }
    try {
      const n = await api.importKeyring(raw);
      await refreshData();
      showToast(`Imported ${n} key(s).`, "success");
      render();
    } catch (e) {
      showToast(String(e), "error");
    }
  });
  document.getElementById("changePwBtn")?.addEventListener("click", async () => {
    const cur = (document.getElementById("curPw") as HTMLInputElement).value;
    const neu = (document.getElementById("newPw") as HTMLInputElement).value;
    try {
      await api.userChangePassword(cur, neu);
      showToast("Password updated.", "success");
    } catch (e) {
      showToast(String(e), "error");
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
  document.getElementById("accountRailBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.accountPanelOpen = !state.accountPanelOpen;
    render();
  });
  document.querySelectorAll("[data-account-close]").forEach((el) => {
    el.addEventListener("click", () => {
      state.accountPanelOpen = false;
      render();
    });
  });
  document.querySelectorAll("[data-account-jump]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.accountPanelOpen = false;
      state.section = "settings";
      state.settingsView = (el as HTMLElement).dataset.accountJump as SettingsView;
      await loadSectionData();
      render();
    });
  });
  document.getElementById("accountSignOutBtn")?.addEventListener("click", async () => {
    state.accountPanelOpen = false;
    await api.embedClose();
    await api.authLogout();
    state.session = null;
    render();
  });
  document.querySelector(".sidebar-account-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    state.accountPanelOpen = !state.accountPanelOpen;
    render();
  });
  document.getElementById("dismissShare")?.addEventListener("click", () => {
    state.shareUrl = null;
    render();
  });
  bindCommonEvents();
}

function bindCommonEvents() {
  document.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl((el as HTMLElement).dataset.open!);
    });
  });
}

let windowChromeBound = false;
function bindWindowChrome() {
  if (windowChromeBound) return;
  windowChromeBound = true;
  document.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.("[data-win]") as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.win;
      if (action === "min") void api.windowMinimize();
      else if (action === "max") void api.windowToggleMaximize();
      else if (action === "close") void api.windowClose();
    },
    true
  );
}

async function boot() {
  bindWindowChrome();
  state.session = await api.authGetSession();
  if (state.session?.token) {
    try {
      await syncProfile();
      await api.authMe();
      await refreshData();
      state.settings = await api.settingsGet();
      state.settings.notification_sound = state.settings.notification_sound ?? true;
      state.settings.theme = state.settings.theme || "system";
      applyTheme(state.settings.theme);
      void api.embedClose();
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
  await listen<{ path?: string; error?: string }>("upload-error", (e) => {
    const err = e.payload?.error || "Upload failed";
    log(`upload error event: ${err}`);
    showToast(String(err), "error");
  });

  window.addEventListener("focus", () => {
    void onAppFocus();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void onAppFocus();
  });
  try {
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) void onAppFocus();
    });
    getCurrentWindow().onResized(() => {
      void syncEmbedPanel(false);
    });
  } catch (e) {
    log(`window focus hook: ${e}`);
  }
}

boot();
