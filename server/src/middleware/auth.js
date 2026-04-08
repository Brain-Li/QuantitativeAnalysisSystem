import crypto from 'crypto';
import { getDb } from '../db.js';

/** 内存会话：token -> { userId, username, displayName, role, mustChangePassword, exp } */
const sessions = new Map();

const TTL_MS = 8 * 60 * 60 * 1000;

export function createSession(payload) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + TTL_MS;
  sessions.set(token, {
    userId: payload.userId,
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
    mustChangePassword: !!payload.mustChangePassword,
    exp,
  });
  pruneSessions();
  return token;
}

function pruneSessions() {
  const now = Date.now();
  for (const [t, v] of sessions) {
    if (v.exp < now) sessions.delete(t);
  }
}

export function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) {
    if (s) sessions.delete(token);
    return null;
  }
  return s;
}

export function revokeSession(token) {
  if (token) sessions.delete(token);
}

/** 删除用户或改密后，吊销该用户在内存中的全部会话 */
export function revokeSessionsByUserId(userId) {
  const toDelete = [];
  for (const [t, v] of sessions) {
    if (v.userId === userId) toDelete.push(t);
  }
  for (const t of toDelete) sessions.delete(t);
}

/** 管理员修改用户姓名后，同步内存会话中的展示名（含被改用户本人） */
export function updateDisplayNameInSessions(userId, displayName) {
  for (const v of sessions.values()) {
    if (v.userId === userId) {
      v.displayName = displayName;
    }
  }
}

export function authMiddleware(req, res, next) {
  if (process.env.DISABLE_AUTH === '1') {
    req.user = {
      id: 0,
      username: process.env.ADMIN_USER || 'admin',
      displayName: '管理员',
      role: 'admin',
      mustChangePassword: false,
    };
    req.token = null;
    return next();
  }
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;
  const s = getSession(token);
  if (!s) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '请先登录' });
  }
  const row = getDb()
    .prepare('SELECT disabled FROM users WHERE id = ?')
    .get(s.userId);
  if (!row) {
    revokeSession(token);
    return res.status(401).json({
      ok: false,
      error: 'ACCOUNT_GONE',
      message: '账号已失效，请重新登录',
    });
  }
  if (row.disabled) {
    revokeSession(token);
    return res.status(401).json({
      ok: false,
      error: 'ACCOUNT_DISABLED',
      message: '账号已被禁用，请联系管理员',
    });
  }
  req.user = {
    id: s.userId,
    username: s.username,
    displayName: s.displayName,
    role: s.role,
    mustChangePassword: !!s.mustChangePassword,
  };
  req.token = token;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '需要管理员权限' });
  }
  next();
}
