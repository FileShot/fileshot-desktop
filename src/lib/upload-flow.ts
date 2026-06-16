import { formatBytes } from "./invoke";
import { icon } from "./icons";
import { isCreatorTier, isPremiumTier, maxExpirationDays } from "./tier";

export interface PendingUpload {
  paths: string[];
  names: string[];
  totalBytes: number;
  expirationDays: number;
  maxDownloads: string;
  passwordEnabled: boolean;
  password: string;
  customLink: string;
}

export interface UploadSubmitOptions {
  expirationDays: number;
  maxDownloads: number | null;
  password: string | null;
  customLink: string | null;
  useMasterKey: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function renderUploadOptionsPanel(pending: PendingUpload, tier: string, masterKeyEnabled = false): string {
  const pro = isPremiumTier(tier);
  const creator = isCreatorTier(tier);
  const maxExp = maxExpirationDays(tier);
  const fileLabel =
    pending.names.length === 1
      ? pending.names[0]
      : `${pending.names.length} files · ${formatBytes(pending.totalBytes)}`;

  return `<div class="upload-options glass" id="uploadOptionsPanel">
    <div class="upload-options-head">
      <div>
        <strong>Ready to upload</strong>
        <p class="upload-options-sub">${esc(fileLabel)}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="uploadOptionsCancel">Cancel</button>
    </div>
    <div class="upload-options-grid">
      <label class="upload-opt">
        <span>Expiration (days)${maxExp ? ` · max ${maxExp}` : ""}</span>
        <input type="number" id="uploadExpDays" min="1" max="${maxExp ?? 3650}" value="${Math.min(pending.expirationDays, maxExp ?? pending.expirationDays)}" />
      </label>
      <label class="upload-opt">
        <span>Max downloads</span>
        <input type="number" id="uploadMaxDl" min="1" placeholder="Unlimited" value="${esc(pending.maxDownloads)}" />
      </label>
      <div class="upload-opt upload-opt-wide">
        <div class="upload-opt-row">
          <span>Password protect ${pro ? "" : `<span class="pro-pill">PRO</span>`}</span>
          <label class="sw-mini"><input type="checkbox" id="uploadPwEnabled" ${pending.passwordEnabled ? "checked" : ""} ${pro ? "" : "disabled"} /><span></span></label>
        </div>
        <input type="password" id="uploadPassword" placeholder="${pro ? (masterKeyEnabled ? "Using saved master key" : "Leave off to put key in link") : "Upgrade to Pro"}" value="${esc(pending.password)}" ${pro && pending.passwordEnabled && !masterKeyEnabled ? "" : "disabled"} />
        ${masterKeyEnabled && pending.passwordEnabled ? `<p class="upload-opt-hint">Using your saved master key from Settings.</p>` : `<p class="upload-opt-hint">Off = zero-knowledge link with key in URL (same as the website).</p>`}
      </div>
      <label class="upload-opt upload-opt-wide ${creator ? "" : "upload-opt-locked"}">
        <span>Custom link slug ${creator ? "" : `<span class="pro-pill">CREATOR</span>`}</span>
        <input type="text" id="uploadCustomLink" placeholder="e.g. my-album" value="${esc(pending.customLink)}" ${creator ? "" : "disabled"} />
      </label>
    </div>
    <div class="upload-options-actions">
      <button type="button" class="btn btn-ghost" id="uploadChangeFiles">Change files</button>
      <button type="button" class="btn btn-primary" id="uploadStartBtn">${icon("upload", 16)} Encrypt &amp; upload</button>
    </div>
  </div>`;
}

export function readUploadOptionsFromDom(
  pending: PendingUpload,
  tier: string,
  useMasterKey: boolean
): UploadSubmitOptions | null {
  const pro = isPremiumTier(tier);
  const creator = isCreatorTier(tier);
  const expEl = document.getElementById("uploadExpDays") as HTMLInputElement | null;
  const maxEl = document.getElementById("uploadMaxDl") as HTMLInputElement | null;
  const pwEnabled = (document.getElementById("uploadPwEnabled") as HTMLInputElement | null)?.checked;
  const pwEl = document.getElementById("uploadPassword") as HTMLInputElement | null;
  const linkEl = document.getElementById("uploadCustomLink") as HTMLInputElement | null;

  const expirationDays = Math.max(
    1,
    Math.min(
      maxExpirationDays(tier) ?? 3650,
      parseInt(expEl?.value || String(pending.expirationDays), 10) || 180
    )
  );
  const maxRaw = maxEl?.value.trim();
  const maxDownloads = maxRaw ? Math.max(1, parseInt(maxRaw, 10) || 0) : null;
  const password =
    pro && pwEnabled && !useMasterKey ? pwEl?.value.trim() || null : null;
  const customLink = creator ? linkEl?.value.trim() || null : null;

  return {
    expirationDays,
    maxDownloads,
    password,
    customLink,
    useMasterKey: !!(pro && pwEnabled && useMasterKey),
  };
}
