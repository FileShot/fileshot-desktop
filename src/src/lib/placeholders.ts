import { extFromName, fileCategory } from "./files";

export interface PlaceholderTheme {
  slug: string;
  label: string;
  c1: string;
  c2: string;
  accent: string;
}

const KNOWN: Record<string, Omit<PlaceholderTheme, "slug">> = {
  toml: { label: "TOML", c1: "#4a3024", c2: "#7a4f38", accent: "#f0c4a0" },
  json: { label: "JSON", c1: "#3a4228", c2: "#5f6d3a", accent: "#e0f0a8" },
  lock: { label: "LOCK", c1: "#283642", c2: "#3f5568", accent: "#a8d4f0" },
  rs: { label: "RS", c1: "#4a2828", c2: "#8b3d32", accent: "#ffb4a0" },
  js: { label: "JS", c1: "#4a4420", c2: "#7a7028", accent: "#fff0a0" },
  ts: { label: "TS", c1: "#1e3a5f", c2: "#2d5a8f", accent: "#8ec8ff" },
  tsx: { label: "TSX", c1: "#1a3558", c2: "#2a5088", accent: "#7ab8ff" },
  jsx: { label: "JSX", c1: "#3d4a20", c2: "#5f7028", accent: "#e8f0a0" },
  py: { label: "PY", c1: "#2e4a38", c2: "#3d6b52", accent: "#b8f0d0" },
  go: { label: "GO", c1: "#2a4a52", c2: "#3d7a8a", accent: "#a0e8f8" },
  java: { label: "JAVA", c1: "#4a3020", c2: "#7a5030", accent: "#ffc8a0" },
  html: { label: "HTML", c1: "#4a2828", c2: "#7a4038", accent: "#ffb0a0" },
  css: { label: "CSS", c1: "#283a4a", c2: "#3a5a7a", accent: "#a0d0ff" },
  md: { label: "MD", c1: "#3a3a3a", c2: "#5a5a5a", accent: "#e8e8e8" },
  txt: { label: "TXT", c1: "#343434", c2: "#505050", accent: "#d0d0d0" },
  log: { label: "LOG", c1: "#2e3428", c2: "#4a5440", accent: "#c8e0b0" },
  csv: { label: "CSV", c1: "#2a4a30", c2: "#3d7048", accent: "#b0f0c0" },
  pdf: { label: "PDF", c1: "#4a2020", c2: "#7a3030", accent: "#ff9090" },
  zip: { label: "ZIP", c1: "#3a3420", c2: "#5a5030", accent: "#f0e0a0" },
  rar: { label: "RAR", c1: "#3a2828", c2: "#5a4040", accent: "#e8b0b0" },
  "7z": { label: "7Z", c1: "#2a3a28", c2: "#405040", accent: "#b8e8b0" },
  tar: { label: "TAR", c1: "#342e28", c2: "#504840", accent: "#e0d0c0" },
  gz: { label: "GZ", c1: "#28342e", c2: "#405048", accent: "#b0e0c8" },
  mp3: { label: "MP3", c1: "#3a204a", c2: "#5a3070", accent: "#e0b0ff" },
  wav: { label: "WAV", c1: "#2a284a", c2: "#403870", accent: "#c8b0ff" },
  mp4: { label: "MP4", c1: "#28284a", c2: "#404070", accent: "#b0b0ff" },
  mov: { label: "MOV", c1: "#2a304a", c2: "#404870", accent: "#b8c8ff" },
  webm: { label: "WEBM", c1: "#2a3a4a", c2: "#405870", accent: "#b0d8ff" },
  png: { label: "PNG", c1: "#283a4a", c2: "#405a70", accent: "#a8d8ff" },
  jpg: { label: "JPG", c1: "#4a3428", c2: "#705040", accent: "#ffc8a8" },
  jpeg: { label: "JPEG", c1: "#4a3028", c2: "#704838", accent: "#ffc0a0" },
  gif: { label: "GIF", c1: "#3a284a", c2: "#584070", accent: "#d8b0ff" },
  svg: { label: "SVG", c1: "#284a3a", c2: "#407058", accent: "#a8ffd8" },
  webp: { label: "WEBP", c1: "#2a4a42", c2: "#407060", accent: "#a8f0d8" },
  yaml: { label: "YAML", c1: "#3a3040", c2: "#5a4860", accent: "#e8c8f0" },
  yml: { label: "YML", c1: "#383040", c2: "#584860", accent: "#e0c0f0" },
  xml: { label: "XML", c1: "#3a3428", c2: "#5a5040", accent: "#f0e0c0" },
  sql: { label: "SQL", c1: "#283a48", c2: "#405a68", accent: "#a8e0f8" },
  sh: { label: "SH", c1: "#2a3428", c2: "#405040", accent: "#c0e8b8" },
  ps1: { label: "PS1", c1: "#283a50", c2: "#405a78", accent: "#a8d0ff" },
  ini: { label: "INI", c1: "#343428", c2: "#505040", accent: "#e0e0c0" },
  cfg: { label: "CFG", c1: "#343430", c2: "#505048", accent: "#d8d8d0" },
  env: { label: "ENV", c1: "#2a4028", c2: "#406040", accent: "#b8f0b0" },
  wasm: { label: "WASM", c1: "#3a2848", c2: "#5a4070", accent: "#d8b8ff" },
  exe: { label: "EXE", c1: "#2a3040", c2: "#404860", accent: "#b8c8e8" },
  dmg: { label: "DMG", c1: "#3a3038", c2: "#5a4858", accent: "#e8c8e0" },
  deb: { label: "DEB", c1: "#283848", c2: "#405868", accent: "#a8d0f0" },
  rpm: { label: "RPM", c1: "#4a2828", c2: "#704040", accent: "#ffb0b0" },
  docx: { label: "DOCX", c1: "#283a58", c2: "#405a88", accent: "#a8c8ff" },
  xlsx: { label: "XLSX", c1: "#284a30", c2: "#407048", accent: "#a8f0b8" },
  pptx: { label: "PPTX", c1: "#4a3028", c2: "#704838", accent: "#ffc8a8" },
};

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function placeholderTheme(ext: string, fileName: string, mimeType?: string): PlaceholderTheme {
  const e = (ext || "file").toLowerCase();
  if (KNOWN[e]) {
    return { slug: e, ...KNOWN[e] };
  }
  const cat = fileCategory(fileName, mimeType);
  const catLabels: Record<string, string> = {
    image: "IMG",
    video: "VID",
    audio: "AUD",
    pdf: "PDF",
    archive: "ARC",
    code: e ? e.slice(0, 4).toUpperCase() : "CODE",
    text: "TXT",
    file: e ? e.slice(0, 4).toUpperCase() : "FILE",
  };
  const hue = hashHue(e || cat);
  return {
    slug: e || cat,
    label: catLabels[cat] || (e ? e.slice(0, 4).toUpperCase() : "FILE"),
    c1: `hsl(${hue} 28% 18%)`,
    c2: `hsl(${hue} 38% 28%)`,
    accent: `hsl(${hue} 65% 72%)`,
  };
}

export function canPreviewMedia(fileName: string, mimeType?: string): boolean {
  const cat = fileCategory(fileName, mimeType);
  return cat === "image" || cat === "video";
}
