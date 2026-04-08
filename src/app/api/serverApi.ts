import { apiUrl } from "./config";
import type { Dataset, StockData } from "../types";
import { readServerApiToken } from "./serverToken";
import type { StoredUserProfile } from "../auth/authStorage";

type ApiErr = { ok: false; error?: string; message?: string };

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export type LoginUserPayload = {
  username: string;
  displayName: string;
  role: "admin" | "user";
  forcePasswordChange: boolean;
};

/** 数据服务统一登录（与业务 API 共用 Bearer Token） */
export async function loginServerApi(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; token: string; user: LoginUserPayload }
  | { ok: false; message: string; error?: string }
> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal,
  });
  const data = (await parseJson(res)) as {
    ok?: boolean;
    token?: string;
    message?: string;
    error?: string;
    user?: {
      username: string;
      displayName?: string;
      role?: string;
      forcePasswordChange?: boolean;
    };
  };
  if (res.status === 403 && data.error === "ACCOUNT_DISABLED") {
    return { ok: false, message: data.message || "账号已被禁用，请联系管理员", error: "ACCOUNT_DISABLED" };
  }
  if (!res.ok || !data.ok || !data.token || !data.user) {
    const fromApi = typeof data.message === "string" && data.message.length > 0 ? data.message : "";
    let msg = fromApi;
    if (!msg) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        msg =
          "无法连接数据服务。请在本项目 server 目录执行 npm run dev（默认监听 8787），或使用根目录 npm run dev:all 同时启动前端与 API。";
      } else if (res.status >= 500) {
        msg =
          "数据服务未响应或异常（常见于 API 未启动）。请另开终端：cd server → npm run dev；或在项目根目录执行 npm run dev:all。";
      } else {
        msg = `登录失败（${res.status}）`;
      }
    }
    return { ok: false, message: msg, error: data.error };
  }
  const u = data.user;
  const user: LoginUserPayload = {
    username: u.username,
    displayName: typeof u.displayName === "string" ? u.displayName : "",
    role: u.role === "admin" ? "admin" : "user",
    forcePasswordChange: Boolean(u.forcePasswordChange),
  };
  return { ok: true, token: data.token, user };
}

export async function logoutServerApi(signal?: AbortSignal): Promise<void> {
  try {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      signal,
    });
  } catch {
    /* ignore */
  }
}

export async function fetchMeApi(signal?: AbortSignal): Promise<StoredUserProfile | null> {
  const res = await apiFetch("/api/auth/me", { signal });
  if (!res.ok) return null;
  const data = (await parseJson(res)) as {
    ok?: boolean;
    user?: {
      username: string;
      displayName?: string;
      role?: string;
      forcePasswordChange?: boolean;
    };
  };
  if (!data.ok || !data.user) return null;
  const u = data.user;
  return {
    username: u.username,
    displayName: typeof u.displayName === "string" ? u.displayName : "",
    role: u.role === "admin" ? "admin" : "user",
    forcePasswordChange: Boolean(u.forcePasswordChange),
  };
}

export async function changePasswordApi(
  oldPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPassword, newPassword }),
    signal,
  });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    return { ok: false, message: data.message || "修改失败" };
  }
  return { ok: true, message: data.message };
}

function authHeaders(): HeadersInit {
  const t = readServerApiToken();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string>),
    },
  });
  if (
    res.status === 401 &&
    !path.includes("/api/auth/login") &&
    readServerApiToken()
  ) {
    window.dispatchEvent(new CustomEvent("qas:auth-401"));
  }
  return res;
}

export type AdminUserRow = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  disabled: number;
  createdAt: string;
  /** 内置管理员（默认用户名 admin 或 ADMIN_USER），不可被禁用 */
  lockDisable?: boolean;
};

export async function adminCreateUser(
  body: {
    username: string;
    displayName: string;
    role: "admin" | "user";
    password?: string;
  },
  signal?: AbortSignal,
): Promise<{
  ok: true;
  id: number;
  initialPassword?: string;
}> {
  const res = await apiFetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await parseJson(res)) as {
    ok?: boolean;
    id?: number;
    initialPassword?: string;
    message?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "创建失败");
  }
  clearAdminListCaches();
  return { ok: true, id: data.id!, initialPassword: data.initialPassword };
}

export async function adminUpdateUserDisplayName(
  userId: number,
  displayName: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
    signal,
  });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "保存失败");
  }
  clearAdminListCaches();
}

export async function adminResetPassword(userId: number, signal?: AbortSignal): Promise<string> {
  const res = await apiFetch(`/api/admin/users/${userId}/reset-password`, {
    method: "POST",
    signal,
  });
  const data = (await parseJson(res)) as { ok?: boolean; initialPassword?: string; message?: string };
  if (!res.ok || !data.ok || !data.initialPassword) {
    throw new Error(data.message || "重置失败");
  }
  clearAdminListCaches();
  return data.initialPassword;
}

export async function adminSetUserDisabled(
  userId: number,
  disabled: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${userId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disabled }),
    signal,
  });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "操作失败");
  }
  clearAdminListCaches();
}

export async function adminDeleteUser(userId: number, signal?: AbortSignal): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE", signal });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "删除失败");
  }
  clearAdminListCaches();
}

export type AuditLogRow = {
  id: number;
  username: string;
  action: string;
  detail: string;
  ip: string;
  createdAt: string;
};

export type ApiDatasetMeta = {
  id: string;
  name: string;
  filename?: string;
  importTime: string;
  dataCount: number;
  fields: string[];
};

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
    const chunk = data.data;
    for (let k = 0; k < chunk.length; k++) all.push(chunk[k]!);
    const total = data.total ?? all.length;
    if (all.length >= total || data.data.length === 0) break;
    page += 1;
  }
  return all;
}

/** 列表接口并发去重：登录与多模块同时拉取时共用一次 HTTP */
let listDatasetsInflight: Promise<ApiDatasetMeta[]> | null = null;

async function listDatasetsHttp(): Promise<ApiDatasetMeta[]> {
  const res = await apiFetch("/api/datasets");
  const data = (await parseJson(res)) as { ok?: boolean; datasets?: ApiDatasetMeta[] };
  if (!res.ok || !data.ok || !Array.isArray(data.datasets)) {
    throw new Error((data as ApiErr).message || "获取数据集列表失败");
  }
  return data.datasets;
}

export async function listDatasetsApi(signal?: AbortSignal): Promise<ApiDatasetMeta[]> {
  if (!listDatasetsInflight) {
    listDatasetsInflight = listDatasetsHttp().finally(() => {
      listDatasetsInflight = null;
    });
  }
  return withAbort(listDatasetsInflight, signal);
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

/** 仅元数据（行数据为空），用于已登录数据服务时避免全量拉取 */
export function datasetsFromMetasOnly(metas: ApiDatasetMeta[]): Dataset[] {
  return metas.map((m) => metaToDataset(m, []));
}

export async function loadFullDatasetsForMetas(
  metas: ApiDatasetMeta[],
  signal?: AbortSignal,
): Promise<Dataset[]> {
  if (metas.length === 0) return [];
  const rowsList = await Promise.all(
    metas.map((m) => fetchAllRowsApi(m.id, signal)),
  );
  return metas.map((m, i) => metaToDataset(m, rowsList[i]!));
}

export async function loadFullDatasetsFromServer(signal?: AbortSignal): Promise<Dataset[]> {
  const metas = await listDatasetsApi(signal);
  return loadFullDatasetsForMetas(metas, signal);
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
    partial?: boolean;
    cancelled?: boolean;
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
  if (!res.ok || !data.ok) {
    throw new Error(data.message || `上传失败 (${res.status})`);
  }
  // 服务端提前结束且无行写入时可能无 dataset，与取消导入一致处理
  if (data.cancelled && !data.dataset) {
    const err = new Error("已取消，部分可能已导入");
    err.name = "AbortError";
    throw err;
  }
  if (!data.dataset) {
    throw new Error(data.message || `上传失败 (${res.status})`);
  }
  const d = data.dataset;
  invalidateDatasetQueryCaches();
  return metaToDataset(
    {
      id: d.id,
      name: d.name,
      filename: d.filename,
      importTime: d.importTime,
      dataCount: d.dataCount,
      fields: d.fields,
    },
    [],
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
  invalidateDatasetQueryCaches();
}

export async function clearAllServerApi(): Promise<void> {
  const res = await apiFetch("/api/admin/clear-all", { method: "POST" });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message || "清空失败");
  }
  invalidateDatasetQueryCaches();
}

export type QueryMergedRowsBody = {
  datasetIds: string[];
  page: number;
  pageSize: number;
  dateFrom?: string;
  dateTo?: string;
  /** 不传或空表示不按代码筛选（全市场） */
  codes?: string[];
  sortField?: string | null;
  sortDirection?: "asc" | "desc" | null;
};

export type MergedRowsQueryResult = {
  total: number;
  page: number;
  pageSize: number;
  data: StockData[];
};

const DISTINCT_CODES_CACHE_TTL_MS = 120_000;
/** 略延长，减轻「趋势 ↔ 列表」等短时来回切换的重复等待 */
const QUERY_ROWS_CACHE_TTL_MS = 12_000;

const ADMIN_USERS_CACHE_TTL_MS = 45_000;
const ADMIN_AUDIT_CACHE_TTL_MS = 30_000;

type AdminAuditListResult = {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

const adminUsersCache = new Map<string, { users: AdminUserRow[]; expiresAt: number }>();
const adminUsersInflight = new Map<string, Promise<AdminUserRow[]>>();

const auditLogsCache = new Map<string, { result: AdminAuditListResult; expiresAt: number }>();
const auditLogsInflight = new Map<string, Promise<AdminAuditListResult>>();

const distinctCodesCache = new Map<
  string,
  { options: { code: string; name: string }[]; expiresAt: number }
>();
const distinctCodesInflight = new Map<string, Promise<{ code: string; name: string }[]>>();

const queryRowsCache = new Map<string, { result: MergedRowsQueryResult; expiresAt: number }>();
const queryRowsInflight = new Map<string, Promise<MergedRowsQueryResult>>();

function distinctCodesCacheKey(datasetIds: string[]): string {
  return [...datasetIds].sort().join("\u0001");
}

function queryMergedRowsCacheKey(body: QueryMergedRowsBody): string {
  return JSON.stringify({
    datasetIds: [...body.datasetIds].sort(),
    page: body.page,
    pageSize: body.pageSize,
    dateFrom: body.dateFrom ?? "",
    dateTo: body.dateTo ?? "",
    codes:
      body.codes && body.codes.length > 0 ? [...body.codes].sort().join("\u0001") : "",
    sortField: body.sortField ?? null,
    sortDirection: body.sortDirection ?? null,
  });
}

function cloneMergedRowsResult(r: MergedRowsQueryResult): MergedRowsQueryResult {
  return {
    total: r.total,
    page: r.page,
    pageSize: r.pageSize,
    data: r.data.slice(),
  };
}

function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort);
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function adminUsersCacheKey(): string {
  return "v1";
}

function auditLogsCacheKey(page: number, pageSize: number): string {
  return `${page}\u0001${pageSize}`;
}

function cloneAdminUsers(users: AdminUserRow[]): AdminUserRow[] {
  return users.map((u) => ({ ...u }));
}

function cloneAdminAuditResult(r: AdminAuditListResult): AdminAuditListResult {
  return {
    logs: r.logs.map((l) => ({ ...l })),
    total: r.total,
    page: r.page,
    pageSize: r.pageSize,
  };
}

/** 管理后台列表缓存失效（账号变更、审计日志变化时由各 API 内部调用） */
function clearAdminListCaches(): void {
  adminUsersCache.clear();
  adminUsersInflight.clear();
  auditLogsCache.clear();
  auditLogsInflight.clear();
}

async function adminListUsersHttp(): Promise<AdminUserRow[]> {
  const res = await apiFetch("/api/admin/users");
  const data = (await parseJson(res)) as { ok?: boolean; users?: AdminUserRow[]; message?: string };
  if (!res.ok || !data.ok || !Array.isArray(data.users)) {
    throw new Error(data.message || "获取账号列表失败");
  }
  return data.users;
}

export async function adminListUsers(signal?: AbortSignal): Promise<AdminUserRow[]> {
  const key = adminUsersCacheKey();
  const now = Date.now();
  const hit = adminUsersCache.get(key);
  if (hit && hit.expiresAt > now) {
    return cloneAdminUsers(hit.users);
  }

  let inflight = adminUsersInflight.get(key);
  if (!inflight) {
    inflight = adminListUsersHttp()
      .then((users) => {
        adminUsersInflight.delete(key);
        adminUsersCache.set(key, {
          users: cloneAdminUsers(users),
          expiresAt: Date.now() + ADMIN_USERS_CACHE_TTL_MS,
        });
        return users;
      })
      .catch((e) => {
        adminUsersInflight.delete(key);
        throw e;
      });
    adminUsersInflight.set(key, inflight);
  }

  return withAbort(inflight, signal);
}

async function adminListAuditLogsHttp(params: {
  page: number;
  pageSize: number;
}): Promise<AdminAuditListResult> {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  const res = await apiFetch(`/api/admin/audit-logs?${q}`);
  const data = (await parseJson(res)) as {
    ok?: boolean;
    logs?: AuditLogRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    message?: string;
  };
  if (!res.ok || !data.ok || !Array.isArray(data.logs)) {
    throw new Error(data.message || "获取日志失败");
  }
  return {
    logs: data.logs,
    total: typeof data.total === "number" ? data.total : data.logs.length,
    page: typeof data.page === "number" ? data.page : params.page,
    pageSize: typeof data.pageSize === "number" ? data.pageSize : params.pageSize,
  };
}

export async function adminListAuditLogs(
  params: { page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<AdminAuditListResult> {
  const key = auditLogsCacheKey(params.page, params.pageSize);
  const now = Date.now();
  const hit = auditLogsCache.get(key);
  if (hit && hit.expiresAt > now) {
    return cloneAdminAuditResult(hit.result);
  }

  let inflight = auditLogsInflight.get(key);
  if (!inflight) {
    inflight = adminListAuditLogsHttp(params)
      .then((result) => {
        auditLogsInflight.delete(key);
        auditLogsCache.set(key, {
          result: cloneAdminAuditResult(result),
          expiresAt: Date.now() + ADMIN_AUDIT_CACHE_TTL_MS,
        });
        return result;
      })
      .catch((e) => {
        auditLogsInflight.delete(key);
        throw e;
      });
    auditLogsInflight.set(key, inflight);
  }

  return withAbort(inflight, signal);
}

/** 登录切换、删库、上传等后调用，避免沿用旧账号或旧数据的缓存（含管理后台列表） */
export function invalidateDatasetQueryCaches(): void {
  distinctCodesCache.clear();
  distinctCodesInflight.clear();
  queryRowsCache.clear();
  queryRowsInflight.clear();
  clearAdminListCaches();
}

/** 有数据服务 Token 且已选数据集时预拉股票代码，减轻进入趋势分析首屏等待 */
export function prefetchDistinctCodes(datasetIds: string[]): void {
  if (datasetIds.length === 0) return;
  void fetchDistinctCodesApi(datasetIds).catch(() => {});
}

/**
 * 预取股票列表首屏与管理后台首屏数据（与 DataTable 默认 pageSize=20、日志默认 10 条对齐）。
 * 使用与列表页一致的日期、选中股票记忆，提高首次从趋势/登录进入列表或后台的命中率。
 */
export function prefetchServerDataViews(args: {
  datasetIds: string[];
  dateFrom?: string;
  dateTo?: string;
  /** 与 DataTable：有选中且非全市场时传入 */
  codes?: string[];
  /** 仅管理员预拉账号列表与首页日志 */
  prefetchAdmin?: boolean;
}): void {
  const { datasetIds, dateFrom, dateTo, codes, prefetchAdmin } = args;
  if (datasetIds.length === 0) return;
  prefetchDistinctCodes(datasetIds);
  void queryMergedRowsApi({
    datasetIds,
    page: 1,
    pageSize: 20,
    dateFrom,
    dateTo,
    codes,
    sortField: null,
    sortDirection: null,
  }).catch(() => {});
  if (prefetchAdmin) {
    void adminListUsers().catch(() => {});
    void adminListAuditLogs({ page: 1, pageSize: 10 }).catch(() => {});
  }
}

async function fetchDistinctCodesHttp(
  datasetIds: string[],
): Promise<{ code: string; name: string }[]> {
  const q = new URLSearchParams();
  q.set("datasetIds", datasetIds.join(","));
  const res = await apiFetch(`/api/datasets/distinct-codes?${q}`);
  const data = (await parseJson(res)) as {
    ok?: boolean;
    options?: { code: string; name: string }[];
    message?: string;
  };
  if (!res.ok || !data.ok || !Array.isArray(data.options)) {
    throw new Error(data.message || "获取股票列表失败");
  }
  return data.options;
}

export async function fetchDistinctCodesApi(
  datasetIds: string[],
  signal?: AbortSignal,
): Promise<{ code: string; name: string }[]> {
  if (datasetIds.length === 0) return [];
  const key = distinctCodesCacheKey(datasetIds);
  const now = Date.now();
  const hit = distinctCodesCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.options.map((o) => ({ code: o.code, name: o.name }));
  }

  let inflight = distinctCodesInflight.get(key);
  if (!inflight) {
    inflight = fetchDistinctCodesHttp(datasetIds)
      .then((options) => {
        distinctCodesInflight.delete(key);
        distinctCodesCache.set(key, {
          options: options.map((o) => ({ code: o.code, name: o.name })),
          expiresAt: Date.now() + DISTINCT_CODES_CACHE_TTL_MS,
        });
        return options;
      })
      .catch((e) => {
        distinctCodesInflight.delete(key);
        throw e;
      });
    distinctCodesInflight.set(key, inflight);
  }

  const options = await withAbort(inflight, signal);
  return options.map((o) => ({ code: o.code, name: o.name }));
}

async function queryMergedRowsHttp(body: QueryMergedRowsBody): Promise<MergedRowsQueryResult> {
  const res = await apiFetch("/api/datasets/query-rows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      sortField: body.sortField ?? null,
      sortDirection: body.sortDirection ?? null,
    }),
  });
  const data = (await parseJson(res)) as {
    ok?: boolean;
    total?: number;
    page?: number;
    pageSize?: number;
    data?: StockData[];
    message?: string;
  };
  if (!res.ok || !data.ok || !Array.isArray(data.data)) {
    throw new Error((data as ApiErr).message || "查询数据失败");
  }
  return {
    total: data.total ?? data.data.length,
    page: data.page ?? 1,
    pageSize: data.pageSize ?? body.pageSize,
    data: data.data,
  };
}

export async function queryMergedRowsApi(
  body: QueryMergedRowsBody,
  signal?: AbortSignal,
): Promise<MergedRowsQueryResult> {
  const key = queryMergedRowsCacheKey(body);
  const now = Date.now();
  const hit = queryRowsCache.get(key);
  if (hit && hit.expiresAt > now) {
    return cloneMergedRowsResult(hit.result);
  }

  let inflight = queryRowsInflight.get(key);
  if (!inflight) {
    inflight = queryMergedRowsHttp(body)
      .then((result) => {
        queryRowsInflight.delete(key);
        queryRowsCache.set(key, {
          result: cloneMergedRowsResult(result),
          expiresAt: Date.now() + QUERY_ROWS_CACHE_TTL_MS,
        });
        return result;
      })
      .catch((e) => {
        queryRowsInflight.delete(key);
        throw e;
      });
    queryRowsInflight.set(key, inflight);
  }

  const result = await withAbort(inflight, signal);
  return cloneMergedRowsResult(result);
}

/** 按筛选条件分页拉齐全部行（用于趋势分析等按需场景） */
export async function fetchAllMergedRowsForFilters(
  params: {
    datasetIds: string[];
    dateFrom?: string;
    dateTo?: string;
    codes?: string[];
    sortField?: string | null;
    sortDirection?: "asc" | "desc" | null;
  },
  signal?: AbortSignal,
): Promise<StockData[]> {
  const pageSize = 10000;
  let page = 1;
  const all: StockData[] = [];
  for (;;) {
    const r = await queryMergedRowsApi({ ...params, page, pageSize }, signal);
    all.push(...r.data);
    if (all.length >= r.total || r.data.length === 0) break;
    page += 1;
  }
  return all;
}
