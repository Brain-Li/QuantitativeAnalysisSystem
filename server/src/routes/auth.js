import { Router } from 'express';
import crypto from 'crypto';
import { createSession } from '../middleware/auth.js';

const router = Router();

/** 与前端 authApi 演示一致：用户名 admin，密码 admin123 */
const DEMO_HASH =
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password != null ? String(req.body.password) : '';

  if (!username) {
    return res.status(400).json({ ok: false, error: 'INVALID', message: '缺少用户名' });
  }

  if (username !== (process.env.ADMIN_USER || 'admin')) {
    return res.status(401).json({ ok: false, error: 'ACCOUNT_NOT_FOUND', message: '用户名或密码错误' });
  }

  const hash = sha256Hex(password);
  if (hash !== DEMO_HASH) {
    return res.status(401).json({ ok: false, error: 'WRONG_PASSWORD', message: '用户名或密码错误' });
  }

  const token = createSession(username);
  return res.json({ ok: true, token });
});

export default router;
