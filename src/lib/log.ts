import { invoke } from "@tauri-apps/api/core";

export function log(line: string) {
  const msg = line.trim();
  if (!msg) return;
  console.log(`[FileShot] ${msg}`);
  invoke("app_log_write", { message: msg }).catch(() => {});
}
