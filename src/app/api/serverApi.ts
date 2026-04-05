import { apiUrl } from "./config";
import type { Dataset, StockData } from "../types";
import { readServerApiToken } from "./serverToken";

type ApiErr = { ok: false; error?: string; message?: string };

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export async function loginServerApi(username: string, password: string, signal?: AbortSignal): Promise<
  { ok: true; token: string } | { ok: false; message: string }
> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal,
  });
  const data = (await parseJson(res)) as { ok?: boolean; token?: string; message?: string };
  if (!res.ok || !data.ok || !data.token) {
    const msg = data.message || `登录接口失败 (${res.status})`;
    return { ok: false, message: msg };
  }
  return { ok: true, token: data.token };
}

function authHeaders(): HeadersInit {
  const t = readServerApiToken();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string>),
    },
  });
}

export type ApiDatasetMeta = {
  id: string;
  name: string;
  filename?: string;
  importTime: string;
  dataCount: number;
  fields: string[];
};

export async function listDatasetsApi(): Promise<ApiDatasetMeta[]> {
  const res = await apiFetch("/api/datasets");
  const data = (await parseJson(res)) as { ok?: boolean; datasets?: ApiDatasetMeta[] };
  if (!res.ok || !data.ok || !Array.isArray(data.datasets)) {
    throw new Error((data as ApiErr).message || "获取数据集列表失败");
  }
  return data.datasets;
}

export async function fetchAllRowsApi(datasetId: string, signal?: AbortSignal): Promise<StockData[]> {
  const pageSize = 10000;
  const all: StockData[] = [];
  let page = 1;
  for (;;) {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: "date",
      sortDir: "asc",
    });
    const res = await apiFetch(`/api/datasets/${encodeURIComponent(datasetId)}/rows?${q}`, { signal });
    const data = (await parseJson(res)) as {
      ok?: boolean;
      data?: StockData[];
      total?: number;
      page?: number;
      pageSize?: number;
    };
    if (!res.ok || !data.ok || !Array.isArray(data.data)) {
      throw new Error((data as ApiErr).message || "拉取数据失败");
    }
    all.push(...data.data);
    const total = data.total ?? all.length;
    if (all.length >= total || data.data.length === 0) break;
    page += 1;
  }
  return all;
}

export function metaToDataset(meta: ApiDatasetMeta, data: StockData[]): Dataset {
  return {
    id: meta.id,
    name: meta.name,
    importTime: new Date(meta.importTime),
    dataCount: meta.dataCount,
    fields: meta.fields,
    data,
  };
}

export async function loadFullDatasetsFromServer(signal?: AbortSignal): Promise<Dataset[]> {
  const metas = await listDatasetsApi();
  const out: Dataset[] = [];
  for (const m of metas) {
    const data = await fetchAllRowsApi(m.id, signal);
    out.push(metaToDataset(m, data));
  }
  return out;
}

export async function uploadExcelToServer(file: File, signal?: AbortSignal): Promise<Dataset> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(apiUrl("/api/datasets/upload"), {
    method: "POST",
    headers: authHeaders(),
    body: fd,
    signal,
  });
  const data = (await parseJson(res)) as {
    ok?: boolean;
    dataset?: {
      id: string;
      name: string;
      filename?: string;
      importTime: string;
      dataCount: number;
      fields: string[];
    };
    message?: string;
  };
  if (!res.ok || !data.ok || !data.dataset) {
    throw new Error(data.message || `上传失败 (${res.status})`);
  }
  const d = data.dataset;
  const rows = await fetchAllRowsApi(d.id, signal);
  return metaToDataset(
    {
      id: d.id,
      name: d.name,
      filename: d.filename,
      importTime: d.importTime,
      dataCount: d.dataCount,
      fields: d.fields,
    },
    rows
  );
}

export async function deleteDatasetApi(datasetId: string): Promise<void> {
  const res = await apiFetch(`/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE",
  });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "删除失败");
  }
}

export async function clearAllServerApi(): Promise<void> {
  const res = await apiFetch("/api/admin/clear-all", { method: "POST" });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "清空失败");
  }
}
