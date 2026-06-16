import type { FileItem } from "./invoke";
import { icon } from "./icons";
import { canPreviewMedia, placeholderTheme } from "./placeholders";

const API = "https://api.fileshot.io/api";

export function extFromName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "code"
  | "text"
  | "file";

export function fileCategory(name: string, mimeType?: string): FileCategory {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = extFromName(name);
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v", "ogg"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "flac", "aac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return "archive";
  if (
    [
      "js",
      "ts",
      "tsx",
      "jsx",
      "py",
      "rs",
      "go",
      "java",
      "html",
      "css",
      "json",
      "sql",
      "toml",
      "yaml",
      "yml",
      "xml",
      "lock",
    ].includes(ext)
  )
    return "code";
  if (["txt", "md", "log", "csv"].includes(ext)) return "text";
  return "file";
}

export function previewUrl(fileId: string, token: string | null): string {
  const base = `${API}/files/preview/${encodeURIComponent(fileId)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function zkeBadge(): string {
  return `<span class="zke-badge" title="Zero-knowledge encrypted">${icon("lock", 12)}</span>`;
}

function keyBadge(): string {
  return `<span class="key-badge">Key saved</span>`;
}

export function placeholderInnerHtml(file: FileItem): string {
  const ext = extFromName(file.fileName);
  const theme = placeholderTheme(ext, file.fileName, file.mimeType);
  return `<span class="ph-ext">${theme.label}</span>`;
}

export function renderPlaceholder(file: FileItem, hasKey = false): string {
  const ext = extFromName(file.fileName);
  const theme = placeholderTheme(ext, file.fileName, file.mimeType);
  const zke = file.isZeroKnowledge;
  return `<div class="file-thumb placeholder ext-${theme.slug}" style="--ph-a:${theme.c1};--ph-b:${theme.c2};--ph-accent:${theme.accent}">
    <div class="file-thumb-placeholder">${placeholderInnerHtml(file)}</div>
    ${zke ? zkeBadge() : ""}${hasKey ? keyBadge() : ""}
  </div>`;
}

export function renderThumb(file: FileItem, token: string | null, hasKey = false): string {
  const cat = fileCategory(file.fileName, file.mimeType);
  const zke = file.isZeroKnowledge;
  const fallback = renderPlaceholder(file, hasKey);

  if (zke) {
    return fallback;
  }

  if (cat === "image" && canPreviewMedia(file.fileName, file.mimeType)) {
    const src = previewUrl(file.fileId, token);
    const theme = placeholderTheme(extFromName(file.fileName), file.fileName, file.mimeType);
    return `<div class="file-thumb media has-preview placeholder ext-${theme.slug}" style="--ph-a:${theme.c1};--ph-b:${theme.c2};--ph-accent:${theme.accent}">
      <img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.classList.add('broken')" />
      <div class="file-thumb-placeholder fallback-only">${placeholderInnerHtml(file)}</div>
    </div>`;
  }

  if (cat === "video" && canPreviewMedia(file.fileName, file.mimeType)) {
    const src = previewUrl(file.fileId, token);
    const theme = placeholderTheme(extFromName(file.fileName), file.fileName, file.mimeType);
    return `<div class="file-thumb media has-preview placeholder ext-${theme.slug}" style="--ph-a:${theme.c1};--ph-b:${theme.c2};--ph-accent:${theme.accent}">
      <video src="${src}" muted playsinline preload="metadata" onerror="this.classList.add('broken')" onloadeddata="try{this.currentTime=0.1}catch(e){}"></video>
      <div class="file-thumb-placeholder fallback-only">${placeholderInnerHtml(file)}</div>
    </div>`;
  }

  return fallback;
}

export function normalizeFile(raw: Record<string, unknown>): FileItem {
  return {
    fileId: String(raw.fileId ?? raw.file_id ?? ""),
    fileName: String(raw.fileName ?? raw.file_name ?? raw.original_name ?? "Untitled"),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    downloadCount: Number(raw.downloadCount ?? raw.download_count ?? 0),
    maxDownloads: (raw.maxDownloads ?? raw.max_downloads ?? null) as number | null,
    expiresAt: Number(raw.expiresAt ?? raw.expires_at ?? 0),
    createdAt: Number(raw.createdAt ?? raw.created_at ?? 0),
    customLink: (raw.customLink ?? raw.custom_link ?? null) as string | null,
    isZeroKnowledge: !!(raw.isZeroKnowledge ?? raw.is_zero_knowledge),
    mimeType: String(raw.mimeType ?? raw.mime_type ?? ""),
    hasWrappedKey: !!(raw.hasWrappedKey ?? raw.has_wrapped_key),
    folderId: (raw.folderId ?? raw.folder_id ?? null) as string | null,
    expired: !!(raw.expired ?? false),
  };
}

import { storageLimitForTier, normalizeTierName } from "./tier";

export interface UsageInfo {
  usage: number;
  limit: number | null;
  tier: string;
}

export function normalizeUsage(
  raw: Record<string, unknown>,
  fallbackTier?: string | null
): UsageInfo {
  const usage = Number(raw.usage ?? 0);
  const tier = normalizeTierName(String(raw.tier ?? fallbackTier ?? "free"));
  const rawLimit = raw.limit;
  let limit: number | null = null;
  if (rawLimit !== null && rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isNaN(n) && n > 0) limit = n;
  }
  if (limit === null) {
    limit = storageLimitForTier(tier);
  }
  return { usage, limit, tier };
}

export function formatUsageLabel(info: UsageInfo, formatBytes: (n: number) => string): string {
  const used = formatBytes(info.usage);
  if (info.limit === null || info.limit <= 0) {
    return `${used} used · Unlimited`;
  }
  return `${used} of ${formatBytes(info.limit)} used`;
}

export function usagePercent(info: UsageInfo): number {
  if (!info.limit || info.limit <= 0) return Math.min(100, info.usage > 0 ? 8 : 0);
  return Math.min(100, (info.usage / info.limit) * 100);
}

export { canPreviewMedia, placeholderTheme } from "./placeholders";
