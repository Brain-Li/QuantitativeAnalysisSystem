import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SALT_LEN = 16;
const KEY_LEN = 64;

/** 密码存储：scrypt + 随机盐，Base64 编码 */
export function hashPassword(plain) {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(String(plain), salt, KEY_LEN);
  return Buffer.concat([salt, hash]).toString('base64');
}

export function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  try {
    const buf = Buffer.from(stored, 'base64');
    if (buf.length < SALT_LEN + 16) return false;
    const salt = buf.subarray(0, SALT_LEN);
    const hash = buf.subarray(SALT_LEN);
    const h = scryptSync(String(plain), salt, KEY_LEN);
    return hash.length === h.length && timingSafeEqual(hash, h);
  } catch {
    return false;
  }
}

/** 新密码强度：≥8 位，含字母与数字（特殊符号可选） */
export function isStrongPassword(plain) {
  const s = String(plain);
  if (s.length < 8) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (!/\d/.test(s)) return false;
  return true;
}

export function randomInitialPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}
