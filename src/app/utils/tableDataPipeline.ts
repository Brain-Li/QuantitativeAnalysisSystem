import type { StockData } from "../types";
import { formatDate } from "../components/DateRangePickerButton";
import {
  applyFieldConditions,
  type FieldFilterCondition,
  type FieldFilterLogic,
} from "./fieldFilter";

export type DateRange = { start: string; end: string };

/** 与 DataTable 中日期解析行为对齐，供 Worker / 主线程共用 */
export function parseToDateStr(value: string | number | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return formatDate(value);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, "-");
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }
  const num = Number(str);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(d.getTime())) return formatDate(d);
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return formatDate(d);
  return null;
}

/** 仅日期 + 股票筛选（与 filterSortStockRows 前半段一致），供 IDB 流式扫描逐块调用 */
export function filterRowsOnly(params: {
  rows: StockData[];
  dateField: string | null;
  dateRange: DateRange;
  stockCodeField: string | null;
  selectedStocks: string[];
}): StockData[] {
  const { rows, dateField, dateRange, stockCodeField, selectedStocks } = params;

  let out = rows;
  if (dateField && (dateRange.start || dateRange.end)) {
    out = out.filter((row) => {
      const raw = row[dateField];
      const ds = parseToDateStr(raw as string | number | Date | null);
      if (!ds) return true;
      if (dateRange.start && ds < dateRange.start) return false;
      if (dateRange.end && ds > dateRange.end) return false;
      return true;
    });
  }

  if (stockCodeField && selectedStocks.length > 0) {
    out = out.filter((row) => {
      const stockCode = row[stockCodeField]
        ? String(row[stockCodeField])
        : "";
      return selectedStocks.includes(stockCode);
    });
  }

  return out;
}

/** 排序用：与字段筛选类似的宽松数值解析，避免 "10.5" 与 "9.9" 因非纯数字串落到字典序 */
function sortFieldComparableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value)
    .trim()
    .replace(/^-\s+/, "-")
    .replace(/%/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function sortRowsOnly(
  rows: StockData[],
  sortField: string | null,
  sortDirection: "asc" | "desc" | null,
): StockData[] {
  if (!sortField || !sortDirection) return rows;
  const dir = sortDirection;
  return [...rows].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const an = sortFieldComparableNumber(av);
    const bn = sortFieldComparableNumber(bv);
    if (an !== null && bn !== null) {
      return dir === "asc" ? an - bn : bn - an;
    }
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    const as = av === null || av === undefined ? "" : String(av);
    const bs = bv === null || bv === undefined ? "" : String(bv);
    const cmp = as.localeCompare(bs, "zh-CN");
    return dir === "asc" ? cmp : -cmp;
  });
}

/** 表头列表中匹配「总分」列（与 classifyField 条文一致） */
export function detectTotalScoreField(fields: string[]): string | null {
  const f = fields.find((x) => x.includes("总分"));
  return f ?? null;
}

/**
 * 股票列表默认排序：日期降序（组间）→ 总分降序（组内）→ 代码升序（稳定）。
 * 缺列时跳过该键，仅用其余键排序。
 */
export function applyDefaultStockListSort(
  rows: StockData[],
  dateField: string | null,
  scoreField: string | null,
  codeField: string | null,
): StockData[] {
  if (rows.length <= 1) return rows;
  const df = dateField ?? "";
  const sf = scoreField ?? "";
  const cf = codeField ?? "";

  return [...rows].sort((a, b) => {
    if (df) {
      const da =
        parseToDateStr(a[df] as string | number | Date | null) ?? "";
      const db =
        parseToDateStr(b[df] as string | number | Date | null) ?? "";
      const dateCmp = db.localeCompare(da);
      if (dateCmp !== 0) return dateCmp;
    }
    if (sf) {
      const na = sortFieldComparableNumber(a[sf]);
      const nb = sortFieldComparableNumber(b[sf]);
      if (na !== null && nb !== null && na !== nb) {
        return nb - na;
      }
      if (na !== null && nb === null) return -1;
      if (na === null && nb !== null) return 1;
    }
    if (cf) {
      return String(a[cf] ?? "").localeCompare(
        String(b[cf] ?? ""),
        "zh-CN",
      );
    }
    return 0;
  });
}

/** 与 DataTable 一致的日期筛选 + 股票代码筛选 + 自定义字段筛选 + 排序（供主线程与 Worker 共用） */
export function filterSortStockRows(params: {
  rows: StockData[];
  dateField: string | null;
  dateRange: DateRange;
  stockCodeField: string | null;
  selectedStocks: string[];
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
  /** 未点列头排序时：按日期降序、总分降序；由 DataTable 传入 `detectTotalScoreField(allFields)` */
  totalScoreField?: string | null;
  fieldConditions?: FieldFilterCondition[];
  fieldLogic?: FieldFilterLogic;
}): StockData[] {
  const {
    rows,
    dateField,
    dateRange,
    stockCodeField,
    selectedStocks,
    sortField,
    sortDirection,
    totalScoreField,
    fieldConditions,
    fieldLogic,
  } = params;

  const afterDateStock = filterRowsOnly({
    rows,
    dateField,
    dateRange,
    stockCodeField,
    selectedStocks,
  });
  const afterField = applyFieldConditions(
    afterDateStock,
    fieldConditions ?? [],
    fieldLogic ?? "all",
  );
  if (sortField && sortDirection) {
    return sortRowsOnly(afterField, sortField, sortDirection);
  }
  return applyDefaultStockListSort(
    afterField,
    dateField,
    totalScoreField ?? null,
    stockCodeField,
  );
}
