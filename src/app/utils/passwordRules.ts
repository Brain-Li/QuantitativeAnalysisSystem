/** 与后端一致：≥8 位，含字母与数字 */
export function isValidNewPassword(p: string): boolean {
  if (p.length < 8) return false;
  if (!/[A-Za-z]/.test(p)) return false;
  if (!/\d/.test(p)) return false;
  return true;
}

export function newPasswordHint(): string {
  return "至少 8 位，且同时包含字母与数字";
}
