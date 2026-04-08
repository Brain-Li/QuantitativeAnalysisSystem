import { Router } from 'express';
import { getDb } from '../db.js';
import { createSession, revokeSession, authMiddleware } from '../middleware/auth.js';
import { hashPassword, verifyPassword, isStrongPassword } from '../utils/password.js';
import { writeAuditLog, clientIp } from '../utils/audit.js';

const router = Router();

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password != null ? String(req.body.password) : '';

  if (!username) {
    return res.status(400).json({ ok: false, error: 'INVALID', message: '缺少用户名' });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: 'INVALID', message: '请输入密码' });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, username, display_name, password_hash, role, disabled, force_password_change
       FROM users WHERE username = ? COLLATE NOCASE`,
    )
    .get(username);

  if (!row) {
    return res.status(401).json({ ok: false, error: 'ACCOUNT_NOT_FOUND', message: '用户名或密码错误' });
  }
  if (row.disabled) {
    return res.status(403).json({
      ok: false,
      error: 'ACCOUNT_DISABLED',
      message: '账号已被禁用，请联系管理员',
    });
  }
  if (!verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ ok: false, error: 'WRONG_PASSWORD', message: '用户名或密码错误' });
  }

  const token = createSession({
    userId: row.id,
    username: row.username,
    displayName: row.display_name || '',
    role: row.role,
    mustChangePassword: !!row.force_password_change,
  });

  const ip = clientIp(req);
  writeAuditLog({
    userId: row.id,
    username: row.username,
    action: '登录',
    detail: '用户登录成功',
    ip,
  });

  return res.json({
    ok: true,
    token,
    user: {
      username: row.username,
      displayName: row.display_name || '',
      role: row.role,
      forcePasswordChange: !!row.force_password_change,
    },
  });
});

router.post('/logout', authMiddleware, (req, res) => {
  const ip = clientIp(req);
  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '登出',
    detail: '用户主动登出',
    ip,
  });
  revokeSession(req.token);
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.displayName,
      role: req.user.role,
      forcePasswordChange: req.user.mustChangePassword,
    },
  });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const oldPassword = req.body?.oldPassword != null ? String(req.body.oldPassword) : '';
  const newPassword = req.body?.newPassword != null ? String(req.body.newPassword) : '';

  if (!oldPassword) {
    return res.status(400).json({ ok: false, message: '请输入原密码' });
  }
  if (!newPassword) {
    return res.status(400).json({ ok: false, message: '请输入新密码' });
  }
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({
      ok: false,
      message: '新密码至少 8 位，且需同时包含字母与数字',
    });
  }
  if (oldPassword === newPassword) {
    return res.status(400).json({ ok: false, message: '新密码不能与原密码相同' });
  }

  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !verifyPassword(oldPassword, row.password_hash)) {
    return res.status(400).json({ ok: false, message: '原密码不正确' });
  }

  const newHash = hashPassword(newPassword);
  db.prepare(
    'UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?',
  ).run(newHash, req.user.id);

  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '修改密码',
    detail: '用户修改登录密码',
    ip: clientIp(req),
  });

  revokeSession(req.token);
  res.json({ ok: true, message: '密码已更新，请重新登录' });
});

export default router;
