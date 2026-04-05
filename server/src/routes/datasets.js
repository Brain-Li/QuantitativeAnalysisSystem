import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { getDb, runTransaction } from '../db.js';
import { parseExcelBuffer } from '../utils/excelParse.js';
import {
  extractIndexedFields,
  serializeRowForPayload,
} from '../utils/rowExtract.js';
import { buildFilterClause } from '../utils/queryFilters.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

router.use(authMiddleware);

/** 列出数据集 */
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, filename, created_at AS importTime, row_count AS dataCount, fields_json AS fieldsJson
       FROM datasets ORDER BY created_at DESC`
    )
    .all();
  const datasets = rows.map((r) => ({
    id: r.id,
    name: r.name,
    filename: r.filename,
    importTime: r.importTime,
    dataCount: r.dataCount,
    fields: JSON.parse(r.fieldsJson || '[]'),
  }));
  res.json({ ok: true, datasets });
});

/** Excel 上传并入库（须放在 /:id 之前） */
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: 'NO_FILE', message: '请使用 multipart 字段名 file 上传 Excel' });
  }

  let parsed;
  try {
    parsed = parseExcelBuffer(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'PARSE_ERROR', message: e.message || 'Excel 解析失败' });
  }

  const { fields, rows: dataRows } = parsed;
  const datasetId = randomUUID();
  const filename = req.file.originalname || 'upload.xlsx';
  const name = filename;
  const createdAt = new Date().toISOString();

  const db = getDb();
  const insertDs = db.prepare(
    `INSERT INTO datasets (id, name, filename, created_at, row_count, fields_json)
     VALUES (?, ?, ?, ?, 0, ?)`
  );
  insertDs.run(datasetId, name, filename, createdAt, JSON.stringify(fields));

  const upsertRow = db.prepare(`
    INSERT INTO stock_rows (dataset_id, code, name, date_str, volatility, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(dataset_id, code, date_str) DO UPDATE SET
      name = excluded.name,
      volatility = excluded.volatility,
      payload_json = excluded.payload_json
  `);

  let inserted = 0;
  let skipped = 0;
  const batchSize = 400;

  try {
    for (let i = 0; i < dataRows.length; i += batchSize) {
      const chunk = dataRows.slice(i, i + batchSize);
      runTransaction(db, () => {
        for (const raw of chunk) {
          const payloadObj = serializeRowForPayload(raw);
          const { code, name: n, dateStr, volatility } = extractIndexedFields(raw);
          if (!code || !dateStr) {
            skipped++;
            continue;
          }
          const payload_json = JSON.stringify(payloadObj);
          upsertRow.run(datasetId, code, n || '', dateStr, volatility, payload_json);
          inserted++;
        }
      });
    }

    const actualCount = db
      .prepare(`SELECT COUNT(*) AS c FROM stock_rows WHERE dataset_id = ?`)
      .get(datasetId).c;

    db.prepare(`UPDATE datasets SET row_count = ? WHERE id = ?`).run(actualCount, datasetId);

    res.json({
      ok: true,
      dataset: {
        id: datasetId,
        name,
        filename,
        importTime: createdAt,
        dataCount: actualCount,
        fields,
        inserted,
        skipped,
      },
    });
  } catch (e) {
    console.error(e);
    try {
      db.prepare(`DELETE FROM datasets WHERE id = ?`).run(datasetId);
    } catch (_) {}
    return res.status(500).json({
      ok: false,
      error: 'IMPORT_FAILED',
      message: e.message || '入库失败',
    });
  }
});

/** 分页查询行数据（与前端 StockData[] 结构兼容：每行为扁平对象） */
router.get('/:id/rows', (req, res) => {
  const datasetId = req.params.id;
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM datasets WHERE id = ?`).get(datasetId);
  if (!exists) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '数据集不存在' });
  }

  let page = parseInt(String(req.query.page || '1'), 10);
  let pageSize = parseInt(String(req.query.pageSize || '100'), 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 100;
  pageSize = Math.min(pageSize, 10000);

  const code = req.query.code != null ? String(req.query.code).trim() : '';
  const dateFrom = req.query.dateFrom != null ? String(req.query.dateFrom).trim() : '';
  const dateTo = req.query.dateTo != null ? String(req.query.dateTo).trim() : '';

  let filters = [];
  if (req.query.filters) {
    try {
      filters = JSON.parse(String(req.query.filters));
    } catch {
      return res.status(400).json({ ok: false, error: 'BAD_FILTERS', message: 'filters 须为 JSON 数组' });
    }
  }

  const { sql: filterSql, params: filterParams } = buildFilterClause(filters);

  const where = [`dataset_id = ?`];
  const params = [datasetId];

  if (code) {
    where.push(`code = ?`);
    params.push(code);
  }
  if (dateFrom) {
    where.push(`date_str >= ?`);
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push(`date_str <= ?`);
    params.push(dateTo);
  }

  const whereSql = where.join(' AND ') + filterSql;
  params.push(...filterParams);

  let orderCol = 'date_str';
  const sortBy = String(req.query.sortBy || 'date').toLowerCase();
  if (sortBy === 'code') orderCol = 'code';
  else if (sortBy === 'volatility' || sortBy === 'vol') orderCol = 'volatility';
  else if (sortBy === 'name') orderCol = 'name';
  const sortDir = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const countSql = `SELECT COUNT(*) AS total FROM stock_rows WHERE ${whereSql}`;
  const total = db.prepare(countSql).get(...params).total;

  const offset = (page - 1) * pageSize;
  const listSql = `
    SELECT payload_json FROM stock_rows
    WHERE ${whereSql}
    ORDER BY ${orderCol} ${sortDir}, code ASC
    LIMIT ? OFFSET ?
  `;
  const listParams = [...params, pageSize, offset];
  const rows = db.prepare(listSql).all(...listParams);

  const data = rows.map((r) => JSON.parse(r.payload_json));

  res.json({
    ok: true,
    total,
    page,
    pageSize,
    data,
  });
});

/** 单条元数据（须放在 /:id/rows 之后、避免误匹配） */
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, filename, created_at AS importTime, row_count AS dataCount, fields_json AS fieldsJson
       FROM datasets WHERE id = ?`
    )
    .get(req.params.id);
  if (!row) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '数据集不存在' });
  }
  res.json({
    ok: true,
    dataset: {
      id: row.id,
      name: row.name,
      filename: row.filename,
      importTime: row.importTime,
      dataCount: row.dataCount,
      fields: JSON.parse(row.fieldsJson || '[]'),
    },
  });
});

/** 删除数据集 */
router.delete('/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare(`DELETE FROM datasets WHERE id = ?`).run(req.params.id);
  if (r.changes === 0) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '数据集不存在' });
  }
  res.json({ ok: true, deleted: true });
});

export default router;
