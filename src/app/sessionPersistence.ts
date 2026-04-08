/**
 * 本地存储键与「退出登录」时的会话级重置（字段配置等视图偏好不清理）。
 * 规则见 docs/状态记忆与重置规则.md
 */

export const STORAGE_KEY_SELECTED_DATASET_IDS = "qas_selected_dataset_ids_v1";
export const STORAGE_KEY_FIELD_CONFIGS = "datatable_field_configs_v1";
export const STORAGE_KEY_DATATABLE_DATE_RANGE = "datatable_date_range_v3";
export const STORAGE_KEY_DATATABLE_SELECTED_STOCKS = "datatable_selected_stocks_v3";
export const STORAGE_KEY_DATATABLE_FIELD_FILTERS = "datatable_field_filters_v1";
export const STORAGE_KEY_TREND_STATE = "trend_analysis_state_v1";
export const STORAGE_KEY_LEGACY_TREND_DATE = "trend_analysis_date_range_v1";

/** 与 DataTable 初始状态一致，供登录后 / 空闲时预取 query-rows */
export type DataTableDateRange = { start: string; end: string };

function isYmdOrEmpty(s: string): boolean {
  if (s === "") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function loadDataTableDateRangeFromStorage(): DataTableDateRange | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATATABLE_DATE_RANGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { start, end } = parsed as { start?: unknown; end?: unknown };
    if (typeof start !== "string" || typeof end !== "string") return null;
    if (!isYmdOrEmpty(start) || !isYmdOrEmpty(end)) return null;
    return { start, end };
  } catch {
    return null;
  }
}

export function loadDataTableSelectedStocksFromStorage(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATATABLE_SELECTED_STOCKS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

export function loadSelectedDatasetIdsFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_DATASET_IDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function saveSelectedDatasetIdsToStorage(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SELECTED_DATASET_IDS, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/**
 * 退出登录：会话结束，清理与「单次分析」相关的持久化；
 * 不修改字段配置（视图偏好）、不清理数据服务 Token（由 auth 处理）。
 */
export function applyLogoutPersistenceRules(): void {
  try {
    saveSelectedDatasetIdsToStorage([]);
    localStorage.removeItem(STORAGE_KEY_DATATABLE_DATE_RANGE);
    localStorage.removeItem(STORAGE_KEY_DATATABLE_SELECTED_STOCKS);
    localStorage.removeItem(STORAGE_KEY_DATATABLE_FIELD_FILTERS);
    localStorage.removeItem(STORAGE_KEY_TREND_STATE);
    localStorage.removeItem(STORAGE_KEY_LEGACY_TREND_DATE);
  } catch {
    /* ignore */
  }
}
