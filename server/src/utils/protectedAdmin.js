/** 与 db 种子一致：内置管理员用户名（可经环境变量 ADMIN_USER 覆盖） */
export function getProtectedAdminUsername() {
  return String(process.env.ADMIN_USER || 'admin').trim().toLowerCase();
}

export function isProtectedAdminUsername(username) {
  if (username == null || typeof username !== 'string') return false;
  return username.trim().toLowerCase() === getProtectedAdminUsername();
}
