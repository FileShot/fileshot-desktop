import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SessionState {
  token: string | null;
  csrf_token: string | null;
  email: string | null;
  user_id: number | null;
  tier: string | null;
}

export interface AppSettings {
  autostart: boolean;
  minimize_to_tray: boolean;
  start_minimized: boolean;
  chat_notifications: boolean;
  notification_sound: boolean;
  theme: string;
  master_key_enabled?: boolean;
  master_key?: string | null;
}

export interface UploadOptions {
  expiration_days?: number | null;
  max_downloads?: number | null;
  password?: string | null;
  custom_link?: string | null;
  use_master_key?: boolean | null;
}

export interface TransferItem {
  id: string;
  name: string;
  path: string;
  status: string;
  progress: number;
  bytes_done: number;
  bytes_total: number;
  share_url: string | null;
  error: string | null;
}

export interface FileItem {
  fileId: string;
  fileName: string;
  fileSize: number;
  downloadCount: number;
  maxDownloads: number | null;
  expiresAt: number;
  createdAt: number;
  customLink: string | null;
  isZeroKnowledge: boolean;
  mimeType: string;
  hasWrappedKey: boolean;
  folderId: string | null;
  expired: boolean;
}

export interface UsageInfo {
  usage: number;
  limit: number | null;
  tier: string;
}

export interface EmbedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const api = {
  authLogin: (email: string, password: string) =>
    invoke<Record<string, unknown>>("auth_login", { email, password }),
  authRegister: (email: string, password: string) =>
    invoke<Record<string, unknown>>("auth_register", { email, password }),
  authExchangeCode: (code: string) =>
    invoke<Record<string, unknown>>("auth_exchange_code", { code }),
  authOauth: (provider: "google" | "github") =>
    invoke<Record<string, unknown>>("auth_oauth", { provider }),
  authGetSession: () => invoke<SessionState>("auth_get_session"),
  authLogout: () => invoke<void>("auth_logout"),
  authMe: () => invoke<Record<string, unknown>>("auth_me"),
  authRefreshCsrf: () => invoke<void>("auth_refresh_csrf"),
  authSyncSession: () => invoke<SessionState>("auth_sync_session"),
  filesList: () => invoke<Record<string, unknown>>("files_list"),
  filesUsage: () => invoke<Record<string, unknown>>("files_usage"),
  filesDelete: (fileId: string) => invoke<void>("files_delete", { fileId }),
  filesUpdate: (fileId: string, payload: Record<string, unknown>) =>
    invoke<Record<string, unknown>>("files_update", { fileId, payload }),
  filesMove: (fileIds: string[], folderId: string | null) =>
    invoke<Record<string, unknown>>("files_move", { fileIds, folderId }),
  filesVersions: (fileId: string) =>
    invoke<Record<string, unknown>>("files_versions", { fileId }),
  foldersList: () => invoke<Record<string, unknown>>("folders_list"),
  foldersCreate: (name: string, parentId?: string) =>
    invoke<Record<string, unknown>>("folders_create", { name, parentId }),
  inboxList: () => invoke<Record<string, unknown>>("inbox_list"),
  chatRooms: () => invoke<Record<string, unknown>>("chat_rooms"),
  chatDelete: (roomId: string) => invoke<void>("chat_delete", { roomId }),
  apiKeysList: () => invoke<Record<string, unknown>>("api_keys_list"),
  userChangePassword: (currentPassword: string, newPassword: string) =>
    invoke<Record<string, unknown>>("user_change_password", { currentPassword, newPassword }),
  user2faStatus: () => invoke<Record<string, unknown>>("user_2fa_status"),
  paymentsSubscription: () => invoke<Record<string, unknown>>("payments_subscription"),
  paymentsCheckout: (tier: string, interval?: string) =>
    invoke<{ url?: string; sessionId?: string }>("payments_checkout", { tier, interval }),
  paymentsConfirmCheckout: (sessionId: string) =>
    invoke<{
      success?: boolean;
      pending?: boolean;
      applied?: boolean;
      tier?: string;
      user?: Record<string, unknown>;
    }>("payments_confirm_checkout", { sessionId }),
  inboxCreate: (title: string, description?: string) =>
    invoke<Record<string, unknown>>("inbox_create", { title, description }),
  inboxDelete: (requestId: string) => invoke<void>("inbox_delete", { requestId }),
  embedOpen: (url: string, bounds: EmbedBounds) =>
    invoke<void>("embed_open", { url, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
  embedMove: (url: string, bounds: EmbedBounds) =>
    invoke<void>("embed_move", { url, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
  embedClose: () => invoke<void>("embed_close"),
  embedResize: (bounds: EmbedBounds) =>
    invoke<void>("embed_resize", { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
  previewThumb: (fileId: string, isZeroKnowledge: boolean) =>
    invoke<string | null>("preview_thumb", { fileId, isZeroKnowledge }),
  fileShareUrl: (fileId: string, customLink?: string | null) =>
    invoke<string>("file_share_url", { fileId, customLink: customLink ?? null }),
  keyringHas: (fileId: string) => invoke<boolean>("keyring_has", { fileId }),
  keyringIds: () => invoke<string[]>("keyring_ids"),
  chatOpen: () => invoke<void>("chat_open"),
  chatClose: () => invoke<void>("chat_close"),
  uploadPaths: (paths: string[], options?: UploadOptions | null) =>
    invoke<string[]>("upload_paths", { paths, options: options ?? null }),
  downloadFile: (fileId: string, savePath: string) =>
    invoke<void>("download_file_cmd", { fileId, savePath }),
  transfersList: () => invoke<TransferItem[]>("transfers_list"),
  activityList: () => invoke<Array<{ id: string; kind: string; name: string; at: number; file_id?: string }>>("activity_list"),
  favoritesList: () => invoke<string[]>("favorites_list"),
  favoritesToggle: (fileId: string) => invoke<string[]>("favorites_toggle", { fileId }),
  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (settings: AppSettings) => invoke<void>("settings_set", { settings }),
  pickFiles: () => invoke<string[]>("pick_files"),
  pickSavePath: (defaultName: string) => invoke<string | null>("pick_save_path", { defaultName }),
  windowMinimize: () => invoke<void>("window_minimize"),
  windowToggleMaximize: () => invoke<void>("window_toggle_maximize"),
  windowClose: () => invoke<void>("window_close"),
  exportKeyring: () => invoke<string>("export_keyring"),
  importKeyring: (payload: string) => invoke<number>("import_keyring", { payload }),
  onTransfersUpdated: (cb: (items: TransferItem[]) => void) =>
    listen<TransferItem[]>("transfers-updated", (e) => cb(e.payload)),
  onTrayQuickUpload: (cb: () => void) =>
    listen("tray-quick-upload", () => cb()),
};

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
