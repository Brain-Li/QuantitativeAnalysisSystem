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
import { writeAuditLog, clientIp } from '../utils/audit.js';
import {
  getDistinctCodesFromCache,
  setDistinctCodesCache,
  invalidateDistinctCacheForDatasets,
} from '../utils/distinctCodesCache.js';

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

/**
 * 多数据集下 distinct 股票代码 + 名称（供筛选下拉，避免前端扫全表）
 * 须放在 /:id/rows 之前
 */
router.get('/distinct-codes', (req, res) => {
  const raw = req.query.datasetIds;
  if (raw == null || String(raw).trim() === '') {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '缺少 datasetIds' });
  }
  const datasetIds = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (datasetIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'datasetIds 不能为空' });
  }

  const db = getDb();
  const ph = datasetIds.map(() => '?').join(',');
  const exists = db
    .prepare(`SELECT COUNT(*) AS c FROM datasets WHERE id IN (${ph})`)
    .get(...datasetIds);
  if (exists.c !== datasetIds.length) {
    return res.status(400).json({ ok: false, error: 'INVALID_DATASETS', message: '部分数据集不存在' });
  }

  const cached = getDistinctCodesFromCache(datasetIds);
  if (cached) {
    return res.json({ ok: true, options: cached });
  }

  const rows = db
    .prepare(
      `SELECT code, MAX(name) AS name FROM stock_rows
       WHERE dataset_id IN (${ph})
       GROUP BY code
       ORDER BY code ASC`,
    )
    .all(...datasetIds);

  const options = rows.map((r) => ({
    code: r.code,
    name: r.name || r.code,
  }));

  setDistinctCodesCache(datasetIds, options);
  res.json({ ok: true, options });
});

/**
 * 多数据集合并分页（服务端筛选/排序，减轻浏览器全量 mergedData）
 * 须放在 /:id/rows 之前
 */
router.post('/query-rows', (req, res) => {
  const body = req.body || {};
  const datasetIds = Array.isArray(body.datasetIds)
    ? body.datasetIds.filter((id) => typeof id === 'string' && id.trim())
    : [];
  if (datasetIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'datasetIds 不能为空' });
  }

  let page = parseInt(String(body.page ?? '1'), 10);
  let pageSize = parseInt(String(body.pageSize ?? '20'), 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;
  pageSize = Math.min(pageSize, 10000);

  const dateFrom = body.dateFrom != null ? String(body.dateFrom).trim() : '';
  const dateTo = body.dateTo != null ? String(body.dateTo).trim() : '';
  const codes = Array.isArray(body.codes)
    ? body.codes.filter((c) => typeof c === 'string' && c.trim())
    : [];
  const sortField =
    body.sortField != null && String(body.sortField).trim() !== ''
      ? String(body.sortField).trim()
      : '';
  const sortDirRaw = String(body.sortDirection || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const db = getDb();
  const ph = datasetIds.map(() => '?').join(',');
  const exists = db
    .prepare(`SELECT COUNT(*) AS c FROM datasets WHERE id IN (${ph})`)
    .get(...datasetIds);
  if (exists.c !== datasetIds.length) {
    return res.status(400).json({ ok: false, error: 'INVALID_DATASETS', message: '部分数据集不存在' });
  }

  const where = [`dataset_id IN (${ph})`];
  const params = [...datasetIds];

  if (dateFrom) {
    where.push('date_str >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('date_str <= ?');
    params.push(dateTo);
  }
  if (codes.length > 0) {
    const cph = codes.map(() => '?').join(',');
    where.push(`code IN (${cph})`);
    params.push(...codes);
  }

  const whereSql = where.join(' AND ');

  // 与前端股票列表默认一致：日期降序 → 总分降序 → 代码升序（无列头排序时）
  let orderSql =
    'date_str DESC, CAST(json_extract(payload_json, \'$.总分\') AS REAL) DESC, code ASC';
  let orderParams = [];
  if (sortField) {
    const sf = sortField;
    if (/日期|交易日期/i.test(sf) || sf.toLowerCase() === 'date') {
      orderSql = `date_str ${sortDirRaw}, code ASC`;
    } else if (/代码|证券代码|股票代码/i.test(sf) || sf.toLowerCase() === 'code') {
      orderSql = `code ${sortDirRaw}, date_str ASC`;
    } else if (/名称|证券简称/i.test(sf) || sf.toLowerCase() === 'name') {
      orderSql = `name COLLATE NOCASE ${sortDirRaw}, date_str ASC`;
    } else if (/波动|volatility/i.test(sf)) {
      orderSql = `volatility ${sortDirRaw}, date_str ASC, code ASC`;
    } else if (/涨跌幅/.test(sf)) {
      orderSql = `CAST(json_extract(payload_json, '$.涨跌幅') AS REAL) ${sortDirRaw}, date_str ASC, code ASC`;
    } else if (/^[\u4e00-\u9fa5a-zA-Z0-9_\-.]+$/.test(sf)) {
      // Excel/JSON 常把数字存成字符串，直接 ORDER BY 会按字典序（如降序时 9.9 排在 10.5 前）
      orderSql = `CAST(json_extract(payload_json, '$.' || json_quote(?)) AS REAL) ${sortDirRaw}, date_str ASC, code ASC`;
      orderParams = [sf];
    }
  }

  const countSql = `SELECT COUNT(*) AS total FROM stock_rows WHERE ${whereSql}`;
  const total = db.prepare(countSql).get(...params).total;

  const offset = (page - 1) * pageSize;
  const listSql = `
    SELECT payload_json FROM stock_rows
    WHERE ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `;
  const listParams = [...params, ...orderParams, pageSize, offset];
  const listRows = db.prepare(listSql).all(...listParams);

  const data = listRows.map((r) => JSON.parse(r.payload_json));

  res.json({
    ok: true,
    total,
    page,
    pageSize,
    data,
  });
});

/** Excel 上传并入库（须放在 /:id 之前） */
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: 'NO_FILE', message: '请使用 multipart 字段名 file 上传 Excel' });
  }

  // 仅依赖 aborted：勿用 req.on('close')（请求体读完也会触发）、勿用 req.destroyed /
  // req.socket.destroyed 作“已断开”判断（经代理/本地联调时易误判，导致不 res.json、前端一直转圈）。
  let clientAborted = false;
  const onAborted = () => {
    clientAborted = true;
  };
  req.on('aborted', onAborted);
  const cleanupListener = () => {
    req.off('aborted', onAborted);
  };

  const tStart = Date.now();
  let parsed;
  try {
    parsed = parseExcelBuffer(req.file.buffer);
  } catch (e) {
    cleanupListener();
    return res.status(400).json({ ok: false, error: 'PARSE_ERROR', message: e.message || 'Excel 解析失败' });
  }
  const parseMs = Date.now() - tStart;

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
  /** 较大批次减少 COMMIT 次数；过大则单次事务时间过长 */
  const batchSize = 1000;
  let importStoppedEarly = false;

  try {
    const tInsert = Date.now();
    for (let i = 0; i < dataRows.length; i += batchSize) {
      if (clientAborted) {
        importStoppedEarly = true;
        break;
      }
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
    const insertMs = Date.now() - tInsert;

    const tCount = Date.now();
    const actualCount = db
      .prepare(`SELECT COUNT(*) AS c FROM stock_rows WHERE dataset_id = ?`)
      .get(datasetId).c;
    const countMs = Date.now() - tCount;

    db.prepare(`UPDATE datasets SET row_count = ? WHERE id = ?`).run(actualCount, datasetId);

    const totalMs = Date.now() - tStart;
    console.log(
      `[datasets/upload] ${filename} excelRows=${dataRows.length} parseMs=${parseMs} insertMs=${insertMs} countMs=${countMs} totalMs=${totalMs} dbRows=${actualCount}`,
    );

    if (importStoppedEarly && actualCount === 0) {
      try {
        db.prepare(`DELETE FROM datasets WHERE id = ?`).run(datasetId);
      } catch (_) {}
    }

    cleanupListener();

    if (importStoppedEarly) {
      if (actualCount > 0) {
        writeAuditLog({
          userId: req.user.id,
          username: req.user.username,
          action: '导入数据集',
          detail: `部分导入「${name}」（${filename}），已写入 ${actualCount} 条，数据集 ID：${datasetId}`,
          ip: clientIp(req),
        });
      }
      if (!res.headersSent) {
        try {
          const body =
            actualCount > 0
              ? {
                  ok: true,
                  partial: true,
                  cancelled: true,
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
                }
              : { ok: true, partial: true, cancelled: true };
          res.json(body);
        } catch (_) {}
      }
      return;
    }

    writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      action: '导入数据集',
      detail: `导入「${name}」（${filename}），共 ${actualCount} 条，数据集 ID：${datasetId}`,
      ip: clientIp(req),
    });

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
    cleanupListener();
    console.error(e);
    try {
      db.prepare(`DELETE FROM datasets WHERE id = ?`).run(datasetId);
    } catch (_) {}
    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: 'IMPORT_FAILED',
        message: e.message || '入库失败',
      });
    }
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
  const datasetId = req.params.id;
  const meta = db.prepare(`SELECT name, filename FROM datasets WHERE id = ?`).get(datasetId);
  if (!meta) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '数据集不存在' });
  }
  db.prepare(`DELETE FROM datasets WHERE id = ?`).run(datasetId);
  invalidateDistinctCacheForDatasets([datasetId]);
  writeAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: '删除数据集',
    detail: `删除「${meta.name}」（${meta.filename}），数据集 ID：${datasetId}`,
    ip: clientIp(req),
  });
  res.json({ ok: true, deleted: true });
});

export default router;
