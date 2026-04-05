/** 空字符串表示与前端同源（开发时由 Vite 代理到 server） */
export function apiBase(): string {
  const b = import.meta.env.VITE_API_BASE;
  if (typeof b === "string" && b.length > 0) {
    return b.replace(/\/$/, "");
  }
  return "";
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = apiBase();
  return base ? `${base}${p}` : p;
}
