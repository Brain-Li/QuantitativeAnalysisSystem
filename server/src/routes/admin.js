import { Router } from 'express';
import { getDb } from '../db.js';
import {
  authMiddleware,
  requireAdmin,
  revokeSessionsByUserId,
  updateDisplayNameInSessions,
} from '../middleware/auth.js';
import { hashPassword, randomInitialPassword, isStrongPassword } from '../utils/password.js';
import { writeAuditLog, clientIp } from '../utils/audit.js';
import { isProtectedAdminUsername } from '../utils/protectedAdmin.js';
import { invalidateDistinctCacheAll } from '../utils/distinctCodesCache.js';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

/** 清空所有数据集与行（保留表结构） */
router.post('/clear-all', (req, res) => {
  const db = getDb();
  db.exec(`DELETE FROM stock_rows; DELETE FROM datasets;`);
  invalidateDistinctCacheAll();
  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '清空数据',
    detail: '管理员执行清空全部数据集',
    ip: clientIp(req),
  });
  res.json({ ok: true, message: '已清空全部数据' });
});

router.get('/users', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, username, display_name AS displayName, role, disabled, created_at AS createdAt
       FROM users ORDER BY id ASC`,
    )
    .all();
  const users = rows.map((u) => ({
    ...u,
    lockDisable: u.role === 'admin' && isProtectedAdminUsername(u.username),
  }));
  res.json({ ok: true, users });
});

router.post('/users', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const displayName = String(req.body?.displayName ?? '').trim();
  const role = String(req.body?.role || 'user');
  let password = req.body?.password != null ? String(req.body.password) : '';

  if (!username) {
    return res.status(400).json({ ok: false, message: '请输入用户名' });
  }
  if (username.length > 64) {
    return res.status(400).json({ ok: false, message: '用户名过长' });
  }
  if (!displayName) {
    return res.status(400).json({ ok: false, message: '请输入姓名' });
  }
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ ok: false, message: '角色无效' });
  }

  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (exists) {
    return res.status(400).json({ ok: false, message: '用户名已存在' });
  }

  let generated = false;
  if (!password) {
    password = randomInitialPassword();
    generated = true;
  } else if (!isStrongPassword(password)) {
    return res.status(400).json({
      ok: false,
      message: '密码至少 8 位，且需同时包含字母与数字',
    });
  }

  const pwHash = hashPassword(password);
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, role, disabled, force_password_change)
       VALUES (?, ?, ?, ?, 0, 0)`,
    )
    .run(username, displayName, pwHash, role);

  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '新建账号',
    detail: `创建用户 ${username}（${role}）`,
    ip: clientIp(req),
  });

  res.json({
    ok: true,
    id: Number(info.lastInsertRowid),
    username,
    displayName,
    role,
    ...(generated ? { initialPassword: password } : {}),
  });
});

router.post('/users/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, message: '无效的用户' });
  }
  const db = getDb();
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ ok: false, message: '用户不存在' });
  }

  const defaultPw =
    process.env.DEFAULT_RESET_PASSWORD && isStrongPassword(process.env.DEFAULT_RESET_PASSWORD)
      ? process.env.DEFAULT_RESET_PASSWORD
      : randomInitialPassword();

  const pwHash = hashPassword(defaultPw);
  db.prepare(
    'UPDATE users SET password_hash = ?, force_password_change = 1 WHERE id = ?',
  ).run(pwHash, id);

  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '重置密码',
    detail: `重置用户 ${row.username} 的密码`,
    ip: clientIp(req),
  });

  res.json({
    ok: true,
    message: '已重置，用户需使用新密码重新登录并建议尽快修改密码',
    initialPassword: defaultPw,
  });
});

router.patch('/users/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const disabled = Boolean(req.body?.disabled);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, message: '无效的用户' });
  }

  const db = getDb();
  const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ ok: false, message: '用户不存在' });
  }
  if (disabled && isProtectedAdminUsername(row.username)) {
    return res.status(400).json({ ok: false, message: '不能禁用系统内置管理员账号' });
  }
  if (row.role === 'admin' && disabled) {
    const admins = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0`)
      .get();
    if (admins.c <= 1) {
      return res.status(400).json({ ok: false, message: '不能禁用最后一个管理员' });
    }
  }

  db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);

  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: disabled ? '禁用账号' : '启用账号',
    detail: `${disabled ? '禁用' : '启用'}用户 ${row.username}`,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const displayName = String(req.body?.displayName ?? '').trim();
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, message: '无效的用户' });
  }
  if (!displayName) {
    return res.status(400).json({ ok: false, message: '请输入姓名' });
  }
  if (displayName.length > 128) {
    return res.status(400).json({ ok: false, message: '姓名过长' });
  }

  const db = getDb();
  const row = db
    .prepare('SELECT id, username, display_name AS displayName FROM users WHERE id = ?')
    .get(id);
  if (!row) {
    return res.status(404).json({ ok: false, message: '用户不存在' });
  }
  if (row.displayName === displayName) {
    return res.json({ ok: true, displayName });
  }

  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
  updateDisplayNameInSessions(id, displayName);

  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '修改姓名',
    detail: `将用户 ${row.username} 的姓名由「${row.displayName}」改为「${displayName}」`,
    ip: clientIp(req),
  });

  res.json({ ok: true, displayName });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, message: '无效的用户' });
  }
  if (id === req.user.id) {
    return res.status(400).json({ ok: false, message: '不能删除当前登录账号' });
  }

  const db = getDb();
  const row = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ ok: false, message: '用户不存在' });
  }

  if (row.role === 'admin' && !row.disabled) {
    const enabled = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0`)
      .get();
    if (enabled.c <= 1) {
      return res.status(400).json({ ok: false, message: '不能删除最后一个未禁用的管理员' });
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  revokeSessionsByUserId(id);

  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '删除账号',
    detail: `删除用户 ${row.username}（${row.role}）`,
    ip: clientIp(req),
  });

  res.json({ ok: true, message: '已删除该账号' });
});

router.get('/audit-logs', (req, res) => {
  const db = getDb();
  const totalRow = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get();
  const total = Number(totalRow.c) || 0;

  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT id, username, action, detail, ip, created_at AS createdAt
       FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(pageSize, offset);

  res.json({ ok: true, logs: rows, total, page, pageSize });
});

export default router;
