import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

    CREATE INDEX IF NOT EXISTS idx_stock_dataset_code ON stock_rows(dataset_id, code);
    CREATE INDEX IF NOT EXISTS idx_stock_dataset_date ON stock_rows(dataset_id, date_str);
    CREATE INDEX IF NOT EXISTS idx_stock_dataset_name ON stock_rows(dataset_id, name);
    CREATE INDEX IF NOT EXISTS idx_stock_dataset_vol ON stock_rows(dataset_id, volatility);
  `);

  dbInstance = db;
  return db;
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
