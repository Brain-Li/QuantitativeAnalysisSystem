import { getDb } from '../db.js';

export function writeAuditLog({ userId, username, action, detail, ip }) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_logs (user_id, username, action, detail, ip)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      userId ?? null,
      String(username || ''),
      String(action || ''),
      String(detail ?? ''),
      String(ip ?? ''),
    );
  } catch (e) {
    console.error('[audit]', e);
  }
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}
