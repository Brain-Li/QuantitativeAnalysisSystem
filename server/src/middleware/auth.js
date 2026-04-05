import crypto from 'crypto';

/** 内存会话：token -> { username, exp } */
const sessions = new Map();

const TTL_MS = 8 * 60 * 60 * 1000;

export function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + TTL_MS;
  sessions.set(token, { username, exp });
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

export function authMiddleware(req, res, next) {
  if (process.env.DISABLE_AUTH === '1') {
    req.user = { username: process.env.ADMIN_USER || 'admin' };
    return next();
  }
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;
  const s = getSession(token);
  if (!s) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '请先登录' });
  }
  req.user = { username: s.username };
  req.token = token;
  next();
}
