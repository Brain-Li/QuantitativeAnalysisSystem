import type { Dataset } from "../types";
import type { ApiDatasetMeta } from "./serverApi";

/** v2：仅存元数据，不持久化行级数据，避免 IndexedDB 膨胀 */
const DB_NAME = "qas_datasets_cache_v2";
const STORE = "snapshot";
const KEY = "full";

type SerializedDataset = Omit<Dataset, "importTime"> & { importTime: string };

type SnapshotV1 = {
  v: 1;
  savedAt: number;
  datasets: SerializedDataset[];
};

let dbInstance: IDBDatabase | null = null;
let dbOpening: Promise<IDBDatabase> | null = null;

function attachDbLifetime(db: IDBDatabase): void {
  db.onversionchange = () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    dbInstance = null;
  };
}

/** 单连接复用，避免每次读写都 open/close 带来的延迟 */
function getDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (!dbOpening) {
    dbOpening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => {
        dbOpening = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        attachDbLifetime(db);
        dbInstance = db;
        dbOpening = null;
        resolve(db);
      };
    });
  }
  return dbOpening;
}

/** 与当前列表接口返回的元数据一致时才认为缓存可用 */
export function cacheMatchesMetas(
  datasets: Dataset[],
  metas: ApiDatasetMeta[],
): boolean {
  if (datasets.length !== metas.length) return false;
  const byId = new Map(metas.map((m) => [m.id, m]));
  for (const d of datasets) {
    const m = byId.get(d.id);
    if (!m) return false;
    if (m.dataCount !== d.dataCount || m.name !== d.name) return false;
  }
  return true;
}

export async function loadDatasetsCache(): Promise<Dataset[] | null> {
  try {
    const db = await getDb();
    const raw = await new Promise<SnapshotV1 | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as SnapshotV1 | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!raw || raw.v !== 1 || !Array.isArray(raw.datasets)) return null;
    return raw.datasets.map((d) => ({
      ...d,
      importTime: new Date(d.importTime),
      data: [],
    }));
  } catch {
    return null;
  }
}

/** @returns 是否写入成功（配额不足、隐私模式等会返回 false） */
export async function saveDatasetsCache(datasets: Dataset[]): Promise<boolean> {
  try {
    const payload: SnapshotV1 = {
      v: 1,
      savedAt: Date.now(),
      datasets: datasets.map((d) => ({
        ...d,
        data: [],
        importTime: d.importTime.toISOString(),
      })),
    };
    const db = await getDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(STORE).put(payload, KEY);
    });
  } catch {
    return false;
  }
}

export async function clearDatasetsCache(): Promise<void> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
