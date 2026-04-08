import type { StockData } from "../types";
import {
  filterRowsOnly,
  type DateRange,
} from "../utils/tableDataPipeline";

const DB_NAME = "qas_local_dataset_rows_v1";
const STORE = "chunks";
const CHUNK_SIZE = 8000;

type MetaRecord = { v: 1; totalRows: number; chunkCount: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function metaKey(datasetId: string) {
  return `${datasetId}:meta`;
}

function chunkKey(datasetId: string, index: number) {
  return `${datasetId}:c:${index}`;
}

/** 超过此行数的本地 Excel 导入写入 IndexedDB，React 中仅保留元数据 */
export const LOCAL_IDB_ROW_THRESHOLD = 5000;

export async function saveLocalDatasetRows(
  datasetId: string,
  rows: StockData[],
): Promise<boolean> {
  try {
    const db = await openDb();
    const chunkCount = Math.max(1, Math.ceil(rows.length / CHUNK_SIZE));
    const ok = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      const st = tx.objectStore(STORE);
      const meta: MetaRecord = { v: 1, totalRows: rows.length, chunkCount };
      st.put(meta, metaKey(datasetId));
      for (let i = 0; i < chunkCount; i++) {
        const start = i * CHUNK_SIZE;
        const slice = rows.slice(start, start + CHUNK_SIZE);
        st.put(slice, chunkKey(datasetId, i));
      }
    });
    return ok;
  } catch {
    return false;
  }
}

export async function loadLocalDatasetRows(datasetId: string): Promise<StockData[]> {
  const db = await openDb();
  try {
    const meta = await new Promise<MetaRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(metaKey(datasetId));
      req.onsuccess = () => resolve(req.result as MetaRecord | undefined);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {};
    });
    if (!meta || meta.chunkCount < 1) return [];

    const parts = await Promise.all(
      Array.from({ length: meta.chunkCount }, (_, i) =>
        new Promise<StockData[]>((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(chunkKey(datasetId, i));
          req.onsuccess = () => resolve((req.result as StockData[]) ?? []);
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => {};
        }),
      ),
    );
    return parts.flat();
  } finally {
    db.close();
  }
}

/** 按选择顺序合并多个本地 IDB 数据集（用于多选合并视图） */
export async function loadMergedLocalRows(datasetIds: string[]): Promise<StockData[]> {
  if (datasetIds.length === 0) return [];
  const parts = await Promise.all(datasetIds.map((id) => loadLocalDatasetRows(id)));
  return parts.flat();
}

function getMetaRead(
  db: IDBDatabase,
  datasetId: string,
): Promise<MetaRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(metaKey(datasetId));
    req.onsuccess = () => resolve(req.result as MetaRecord | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {};
  });
}

function getChunkRead(
  db: IDBDatabase,
  datasetId: string,
  index: number,
): Promise<StockData[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(chunkKey(datasetId, index));
    req.onsuccess = () => resolve((req.result as StockData[]) ?? []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {};
  });
}

export type LocalIdbStreamParams = {
  dateField: string | null;
  dateRange: DateRange;
  stockCodeField: string | null;
  selectedStocks: string[];
  /** 下拉名称列；可为 null */
  nameField: string | null;
};

/**
 * 单次顺序读 IDB：峰值内存约「一块 + 筛选结果」，并生成全表 distinct 股票选项。
 * 筛选与 DataTable 的 filterRowsOnly 一致；排序在组件内对结果再调 sortRowsOnly。
 */
export async function streamLocalIdbForDataTable(
  datasetIds: string[],
  params: LocalIdbStreamParams,
): Promise<{
  filteredRows: StockData[];
  stockOptions: { code: string; name: string }[];
}> {
  if (datasetIds.length === 0) {
    return { filteredRows: [], stockOptions: [] };
  }

  const { stockCodeField, nameField } = params;
  const map = new Map<string, string>();
  const out: StockData[] = [];

  const db = await openDb();
  try {
    for (const datasetId of datasetIds) {
      const meta = await getMetaRead(db, datasetId);
      if (!meta || meta.chunkCount < 1) continue;

      for (let i = 0; i < meta.chunkCount; i++) {
        const chunk = await getChunkRead(db, datasetId, i);
        if (stockCodeField) {
          for (const row of chunk) {
            const code = String(row[stockCodeField] ?? "");
            if (code && !map.has(code)) {
              const nm =
                nameField && row[nameField] != null
                  ? String(row[nameField])
                  : code;
              map.set(code, nm);
            }
          }
        }
        out.push(
          ...filterRowsOnly({
            rows: chunk,
            dateField: params.dateField,
            dateRange: params.dateRange,
            stockCodeField: params.stockCodeField,
            selectedStocks: params.selectedStocks,
          }),
        );
      }
    }
  } finally {
    db.close();
  }

  const stockOptions = Array.from(map.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code, "zh-CN"));

  return { filteredRows: out, stockOptions };
}

export async function deleteLocalDatasetRows(datasetId: string): Promise<void> {
  try {
    const db = await openDb();
    const meta = await new Promise<MetaRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(metaKey(datasetId));
      req.onsuccess = () => resolve(req.result as MetaRecord | undefined);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {};
    });
    if (!meta) {
      db.close();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      const st = tx.objectStore(STORE);
      st.delete(metaKey(datasetId));
      for (let i = 0; i < meta.chunkCount; i++) {
        st.delete(chunkKey(datasetId, i));
      }
    });
  } catch {
    /* ignore */
  }
}
