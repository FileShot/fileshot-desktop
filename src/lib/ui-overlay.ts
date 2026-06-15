export type ToastKind = "info" | "success" | "error";

export interface PromptOptions {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

let toastRoot: HTMLElement | null = null;
let modalRoot: HTMLElement | null = null;

function ensureToastRoot(): HTMLElement {
  if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
  toastRoot = document.createElement("div");
  toastRoot.className = "fs-toast-stack";
  toastRoot.setAttribute("aria-live", "polite");
  document.body.appendChild(toastRoot);
  return toastRoot;
}

function ensureModalRoot(): HTMLElement {
  if (modalRoot && document.body.contains(modalRoot)) return modalRoot;
  modalRoot = document.createElement("div");
  modalRoot.className = "fs-modal-host hidden";
  document.body.appendChild(modalRoot);
  return modalRoot;
}

export function showToast(message: string, kind: ToastKind = "info", ms = 3200): void {
  const root = ensureToastRoot();
  const el = document.createElement("div");
  el.className = `fs-toast fs-toast-${kind}`;
  el.innerHTML = `<span class="fs-toast-msg">${escapeHtml(message)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  window.setTimeout(() => {
    el.classList.remove("show");
    window.setTimeout(() => el.remove(), 220);
  }, ms);
}

export function showPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const host = ensureModalRoot();
    host.classList.remove("hidden");
    host.innerHTML = `
      <div class="fs-modal-backdrop" data-fs-dismiss></div>
      <div class="fs-modal glass" role="dialog" aria-modal="true">
        <div class="fs-modal-head"><strong>${escapeHtml(opts.title)}</strong></div>
        <label class="fs-modal-label">${escapeHtml(opts.label)}</label>
        <input class="fs-modal-input" type="text" value="${escapeHtml(opts.defaultValue || "")}" placeholder="${escapeHtml(opts.placeholder || "")}" />
        <div class="fs-modal-actions">
          <button type="button" class="btn btn-ghost" data-fs-cancel>${escapeHtml(opts.cancelLabel || "Cancel")}</button>
          <button type="button" class="btn btn-primary" data-fs-ok>${escapeHtml(opts.confirmLabel || "Create")}</button>
        </div>
      </div>`;

    const input = host.querySelector(".fs-modal-input") as HTMLInputElement;
    const finish = (value: string | null) => {
      host.classList.add("hidden");
      host.innerHTML = "";
      resolve(value);
    };

    host.querySelector("[data-fs-cancel]")?.addEventListener("click", () => finish(null));
    host.querySelector("[data-fs-dismiss]")?.addEventListener("click", () => finish(null));
    host.querySelector("[data-fs-ok]")?.addEventListener("click", () => {
      const v = input.value.trim();
      finish(v || null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input.value.trim();
        finish(v || null);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
    input.focus();
    input.select();
  });
}

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = ensureModalRoot();
    host.classList.remove("hidden");
    host.innerHTML = `
      <div class="fs-modal-backdrop" data-fs-dismiss></div>
      <div class="fs-modal glass" role="dialog" aria-modal="true">
        <div class="fs-modal-head"><strong>${escapeHtml(opts.title)}</strong></div>
        <p class="fs-modal-msg">${escapeHtml(opts.message)}</p>
        <div class="fs-modal-actions">
          <button type="button" class="btn btn-ghost" data-fs-cancel>${escapeHtml(opts.cancelLabel || "Cancel")}</button>
          <button type="button" class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-fs-ok>${escapeHtml(opts.confirmLabel || "Confirm")}</button>
        </div>
      </div>`;

    const finish = (ok: boolean) => {
      host.classList.add("hidden");
      host.innerHTML = "";
      resolve(ok);
    };

    host.querySelector("[data-fs-cancel]")?.addEventListener("click", () => finish(false));
    host.querySelector("[data-fs-dismiss]")?.addEventListener("click", () => finish(false));
    host.querySelector("[data-fs-ok]")?.addEventListener("click", () => finish(true));
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
