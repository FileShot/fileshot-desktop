import { formatBytes, type UsageInfo } from "./invoke";
import { formatUsageLabel, usagePercent } from "./files";
import { icon } from "./icons";
import { tierDisplayName, normalizeTierName } from "./tier";
import type { AppSettings } from "./invoke";

export type SettingsView = "general" | "account" | "security" | "plans" | "subscription" | "apikeys";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function settingRow(title: string, desc: string, action: string, opts?: { danger?: boolean }): string {
  return `<div class="setting-row glass ${opts?.danger ? "setting-row-danger" : ""}">
    <div class="setting-row-text"><strong>${esc(title)}</strong>${desc ? `<p>${esc(desc)}</p>` : ""}</div>
    <div class="setting-row-action">${action}</div>
  </div>`;
}

export function toggleHtml(key: keyof AppSettings, on: boolean): string {
  return `<div class="toggle ${on ? "on" : ""}" data-toggle="${key}" role="switch" aria-checked="${on}"></div>`;
}

export function storageVisualization(usage: UsageInfo | null, fileCount: number): string {
  if (!usage) {
    return `<div class="storage-viz glass"><p class="storage-viz-muted">Loading storage…</p></div>`;
  }
  const pct = usagePercent(usage);
  const used = usage.usage;
  const limit = usage.limit;
  const free = limit && limit > used ? limit - used : 0;
  const unlimited = limit === null || limit <= 0;

  return `<div class="storage-viz glass">
    <div class="storage-viz-head">
      <strong>Storage used</strong>
      <span>${esc(formatUsageLabel(usage, formatBytes))}</span>
    </div>
    <div class="storage-viz-bar" aria-hidden="true">
      <div class="storage-viz-fill" style="width:${unlimited ? Math.min(100, pct || 4) : pct}%"></div>
    </div>
    <div class="storage-viz-legend">
      <span><i class="dot dot-files"></i> Files ${formatBytes(used)}</span>
      <span><i class="dot dot-count"></i> ${fileCount} item${fileCount === 1 ? "" : "s"}</span>
      ${unlimited ? `<span><i class="dot dot-free"></i> Unlimited plan</span>` : `<span><i class="dot dot-free"></i> Free ${formatBytes(free)}</span>`}
    </div>
  </div>`;
}

const PLAN_DEFS = [
  {
    id: "free",
    name: "Free",
    prices: { month: 0, year: 0 },
    storage: "50 GB total storage",
    highlight: false,
    features: [
      "Zero-knowledge encryption",
      "Password-protected links",
      "90-day file expiry",
      "Built-in tools suite",
      "No ads or tracking",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    prices: { month: 10, year: 96 },
    storage: "100 GB per file · unlimited expiry",
    highlight: true,
    features: [
      "Everything in Free",
      "Receive Inbox",
      "Custom download pages",
      "File versioning",
      "Priority processing",
      "Chat & notifications",
    ],
  },
  {
    id: "creator",
    name: "Creator",
    prices: { month: 24, year: 230 },
    storage: "300 GB per file · API access",
    highlight: false,
    features: [
      "Everything in Pro",
      "API keys & automation",
      "Paid file listings",
      "Affiliate earnings",
      "Custom slugs",
      "Advanced analytics",
    ],
  },
];

export function renderPlansGrid(interval: "month" | "year", currentTier: string): string {
  const tier = normalizeTierName(currentTier);
  const cards = PLAN_DEFS.map((p) => {
    const price = p.prices[interval];
    const priceLabel =
      price === 0 ? "Free" : interval === "year" ? `$${price}/yr` : `$${price}/mo`;
    const isCurrent = tier === p.id || (p.id === "free" && (tier === "free" || tier === "lite"));
    const cta =
      isCurrent
        ? `<button class="btn btn-ghost btn-sm plan-cta" type="button" disabled>Current plan</button>`
        : p.id === "free"
          ? `<button class="btn btn-ghost btn-sm plan-cta" type="button" disabled>Downgrade on web</button>`
          : `<button class="btn btn-primary btn-sm plan-cta" type="button" data-upgrade="${p.id}">Upgrade</button>`;

    return `<article class="plan-card glass ${p.highlight ? "plan-card-featured" : ""} ${isCurrent ? "plan-card-current" : ""}">
      <div class="plan-card-head">
        <h3>${esc(p.name)}</h3>
        <div class="plan-price">${priceLabel}</div>
        <p class="plan-storage">${esc(p.storage)}</p>
      </div>
      <ul class="plan-features">${p.features.map((f) => `<li>${icon("check", 14)} ${esc(f)}</li>`).join("")}</ul>
      ${cta}
    </article>`;
  }).join("");

  return `<div class="plans-wrap">
    <div class="billing-toggle" role="tablist">
      <button type="button" class="billing-opt ${interval === "month" ? "active" : ""}" data-billing="month">Monthly</button>
      <button type="button" class="billing-opt ${interval === "year" ? "active" : ""}" data-billing="year">Annually <span class="billing-save">Save ~20%</span></button>
    </div>
    <div class="plan-grid">${cards}</div>
  </div>`;
}

export function avatarInitial(email: string): string {
  const c = (email.trim()[0] || "U").toUpperCase();
  return c;
}

export function renderGeneralSettings(s: AppSettings, usage: UsageInfo | null, fileCount: number): string {
  return `${storageVisualization(usage, fileCount)}
    <div class="settings-group">
      <h3 class="settings-group-title">System</h3>
      ${settingRow("Autostart", "Launch FileShot when you sign in to your computer.", toggleHtml("autostart", s.autostart))}
      ${settingRow("Minimize to tray", "Hide the window to the system tray instead of closing.", toggleHtml("minimize_to_tray", s.minimize_to_tray))}
      ${settingRow("Start minimized", "Open in the background on launch.", toggleHtml("start_minimized", s.start_minimized))}
    </div>
    <div class="settings-group">
      <h3 class="settings-group-title">Appearance</h3>
      ${settingRow(
        "Theme",
        "Match your system or choose light or dark.",
        `<select class="filter-select" id="themeSel" data-setting="theme">
          <option value="system" ${s.theme === "system" ? "selected" : ""}>System</option>
          <option value="dark" ${s.theme === "dark" ? "selected" : ""}>Dark</option>
          <option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option>
        </select>`
      )}
    </div>`;
}

export function renderAccountSettings(opts: {
  email: string;
  tier: string;
  usage: UsageInfo | null;
  fileCount: number;
  fileBytes: number;
}): string {
  const initial = avatarInitial(opts.email);
  return `<div class="account-hero glass">
      <div class="account-avatar-lg">${esc(initial)}</div>
      <div>
        <div class="account-hero-email">${esc(opts.email)}</div>
        <div class="account-hero-tier">${esc(tierDisplayName(opts.tier))} plan</div>
      </div>
    </div>
    <div class="settings-group">
      <h3 class="settings-group-title">Profile</h3>
      ${settingRow("Email address", opts.email, `<button class="btn btn-ghost btn-sm" type="button" data-open="https://fileshot.io/account-dashboard.html">Change</button>`)}
      ${settingRow("Display name", "Set your public name on fileshot.io.", `<button class="btn btn-ghost btn-sm" type="button" data-open="https://fileshot.io/account-dashboard.html">Edit</button>`)}
    </div>
    <div class="settings-group">
      <h3 class="settings-group-title">Storage &amp; files</h3>
      ${storageVisualization(opts.usage, opts.fileCount)}
      ${settingRow(
        "All files",
        `${opts.fileCount} files · ${formatBytes(opts.fileBytes)} total`,
        `<button class="btn btn-ghost btn-sm danger-text" type="button" id="deleteAllFilesBtn">Delete all</button>`,
        { danger: true }
      )}
    </div>
    <div class="settings-group">
      <h3 class="settings-group-title">Account</h3>
      ${settingRow("Request account data", "Download a copy of your personal data (GDPR).", `<button class="btn btn-ghost btn-sm" type="button" data-open="https://fileshot.io/privacy.html#data-requests">Request</button>`)}
      ${settingRow("Delete account", "Permanently delete your account and all files.", `<button class="btn btn-ghost btn-sm danger-text" type="button" data-open="https://fileshot.io/account-dashboard.html">Request</button>`, { danger: true })}
      ${settingRow("Sign out", "End this session on this device.", `<button class="btn btn-ghost btn-sm" type="button" id="logoutBtn">Sign out</button>`)}
    </div>`;
}

export function renderSubscriptionSettings(tier: string, usage: UsageInfo | null): string {
  return `<div class="settings-group">
    <h3 class="settings-group-title">Current subscription</h3>
    ${settingRow("Plan", tierDisplayName(tier), `<button class="btn btn-ghost btn-sm" type="button" data-section-jump="plans">View plans</button>`)}
    ${settingRow("Storage", usage ? formatUsageLabel(usage, formatBytes) : "—", "")}
    ${settingRow("Billing portal", "Manage payment method and invoices.", `<button class="btn btn-ghost btn-sm" type="button" data-open="https://fileshot.io/account-dashboard.html#billing">Open</button>`)}
    ${settingRow("Refresh status", "Sync plan after a recent upgrade.", `<button class="btn btn-ghost btn-sm" type="button" id="refreshSubscriptionBtn">Refresh</button>`)}
  </div>`;
}
