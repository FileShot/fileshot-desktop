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
  filesList: () => invoke<Record<string, unknown>>("files_list"),
  filesUsage: () => invoke<Record<string, unknown>>("files_usage"),
  filesDelete: (fileId: string) => invoke<void>("files_delete", { fileId }),
  filesUpdate: (fileId: string, payload: Record<string, unknown>) =>
    invoke<Record<string, unknown>>("files_update", { fileId, payload }),
  foldersList: () => invoke<Record<string, unknown>>("folders_list"),
  foldersCreate: (name: string, parentId?: string) =>
    invoke<Record<string, unknown>>("folders_create", { name, parentId }),
  inboxList: () => invoke<Record<string, unknown>>("inbox_list"),
  chatRooms: () => invoke<Record<string, unknown>>("chat_rooms"),
  apiKeysList: () => invoke<Record<string, unknown>>("api_keys_list"),
  userChangePassword: (currentPassword: string, newPassword: string) =>
    invoke<Record<string, unknown>>("user_change_password", { currentPassword, newPassword }),
  user2faStatus: () => invoke<Record<string, unknown>>("user_2fa_status"),
  paymentsSubscription: () => invoke<Record<string, unknown>>("payments_subscription"),
  paymentsCheckout: (tier: string, interval?: string) =>
    invoke<{ url?: string; sessionId?: string }>("payments_checkout", { tier, interval }),
  inboxCreate: (title: string, description?: string) =>
    invoke<Record<string, unknown>>("inbox_create", { title, description }),
  inboxDelete: (requestId: string) => invoke<void>("inbox_delete", { requestId }),
  embedOpen: (url: string) => invoke<void>("embed_open", { url }),
  embedClose: () => invoke<void>("embed_close"),
  previewThumb: (fileId: string, isZeroKnowledge: boolean) =>
    invoke<string | null>("preview_thumb", { fileId, isZeroKnowledge }),
  fileShareUrl: (fileId: string, customLink?: string | null) =>
    invoke<string>("file_share_url", { fileId, customLink: customLink ?? null }),
  keyringHas: (fileId: string) => invoke<boolean>("keyring_has", { fileId }),
  keyringIds: () => invoke<string[]>("keyring_ids"),
  chatOpen: () => invoke<void>("chat_open"),
  chatClose: () => invoke<void>("chat_close"),
  uploadPaths: (paths: string[]) => invoke<string[]>("upload_paths", { paths }),
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
