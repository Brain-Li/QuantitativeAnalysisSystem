import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { hashPassword } from './utils/password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance = null;

/**
 * 使用 Node.js 内置 node:sqlite（DatabaseSync），无需 better-sqlite3 原生编译。
 * 要求：Node.js >= 22.13（或已内置 node:sqlite 的版本）。
 */
export function getDb() {
  if (dbInstance) return dbInstance;

  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA cache_size = -64000;');
  db.exec('PRAGMA temp_store = MEMORY;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      fields_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS stock_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      date_str TEXT NOT NULL DEFAULT '',
      volatility REAL,
      payload_json TEXT NOT NULL,
      UNIQUE (dataset_id, code, date_str),
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stock_dataset_date ON stock_rows(dataset_id, date_str);
    /** 多数据集 distinct code、code IN 筛选等：按 (dataset_id, code) 收敛扫描，与含 date 的唯一键互补 */
    CREATE INDEX IF NOT EXISTS idx_stock_dataset_code ON stock_rows(dataset_id, code);
    CREATE INDEX IF NOT EXISTS idx_stock_dataset_name ON stock_rows(dataset_id, name);
    CREATE INDEX IF NOT EXISTS idx_stock_dataset_volatility ON stock_rows(dataset_id, volatility);
    CREATE INDEX IF NOT EXISTS idx_stock_payload_zhangdiefu ON stock_rows(
      dataset_id,
      json_extract(payload_json, '$.涨跌幅')
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
      force_password_change INTEGER NOT NULL DEFAULT 0 CHECK(force_password_change IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  seedDefaultAdminIfEmpty(db);
  ensureProtectedAdminEnabled(db);

  dbInstance = db;
  // 异步更新统计信息，帮助 COUNT / ORDER BY 等选择更优计划（不阻塞首次 getDb）
  setImmediate(() => {
    try {
      if (dbInstance) dbInstance.exec('ANALYZE stock_rows;');
    } catch {
      /* ignore */
    }
  });

  return db;
}

function seedDefaultAdminIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c > 0) return;
  const initialPw = (process.env.INITIAL_ADMIN_PASSWORD || '').trim();
  if (!initialPw) {
    console.warn(
      '[quant-analysis-api] 数据库中尚无用户，但未设置 INITIAL_ADMIN_PASSWORD，已跳过默认管理员创建。请复制 server/.env.example 为 .env 并设置强密码后重启。',
    );
    return;
  }
  const adminUser = process.env.ADMIN_USER || 'admin';
  const hash = hashPassword(initialPw);
  db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, disabled, force_password_change)
     VALUES (?, ?, ?, 'admin', 0, 0)`,
  ).run(adminUser, '管理员', hash);
}

/** 内置管理员账号不可长期保持禁用：每次启动数据库连接时恢复为启用 */
function ensureProtectedAdminEnabled(db) {
  const name = process.env.ADMIN_USER || 'admin';
  db.prepare(`UPDATE users SET disabled = 0 WHERE username = ? COLLATE NOCASE`).run(name);
}

/** 与 better-sqlite3 类似的 transaction 包装 */
export function runTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    throw e;
  }
}
