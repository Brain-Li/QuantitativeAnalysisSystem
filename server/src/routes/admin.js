import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

/** 清空所有数据集与行（保留表结构） */
router.post('/clear-all', (req, res) => {
  const db = getDb();
  db.exec(`DELETE FROM stock_rows; DELETE FROM datasets;`);
  res.json({ ok: true, message: '已清空全部数据' });
});

export default router;
