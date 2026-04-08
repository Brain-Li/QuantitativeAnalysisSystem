/**
 * 与 server 中 SQLite `datetime('now')` / DEFAULT 一致：值为 **UTC**，格式 `YYYY-MM-DD HH:MM:SS`，无 Z 后缀。
 * 按 UTC 解析后在用户浏览器本地时区展示，避免与墙上时钟差一整段时区。
 */
export function formatSqliteUtcForLocale(sqliteDatetime: string): string {
  const s = String(sqliteDatetime ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    const d = new Date(`${s.replace(" ", "T")}Z`);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    }
  }
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return fallback.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  return sqliteDatetime;
}
