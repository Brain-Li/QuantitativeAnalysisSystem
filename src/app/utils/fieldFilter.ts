import type { StockData } from "../types";
import { classifyField, getFilterComparableNumericValue } from "./fieldDisplayFormat";

export type FieldFilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "empty";

/** 全部 = AND；任一 = OR */
export type FieldFilterLogic = "all" | "any";

export interface FieldFilterCondition {
  id: string;
  field: string;
  op: FieldFilterOp;
  value: string;
  /** 介于：上限 */
  value2?: string;
}

export function createEmptyFieldCondition(): FieldFilterCondition {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    field: "",
    op: "eq",
    value: "",
    value2: "",
  };
}

export function parseFilterNumber(input: string): number | null {
  const t = input.trim().replace(/%/g, "").replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 是否显式写了 %（用于与 0~1 小数存贮的百分率对齐） */
function parseFilterNumberWithPercent(input: string): {
  n: number | null;
  explicitPercent: boolean;
} {
  const explicitPercent = /%/.test(input);
  const n = parseFilterNumber(input);
  return { n, explicitPercent };
}

/**
 * 单元格数值是否像「小数比例」（如波动率存 0.35 表示 35%）。
 * 涨跌幅原始值即列表上的百分点数字（如 0.92 表示 0.92%），不得按 0~1 比例处理。
 */
function isCellFractionLike(n: number): boolean {
  return n > 0 && n <= 1;
}

/**
 * 将筛选输入与单元格统一到同一量纲（见 `getFilterComparableNumericValue`）。
 * - 涨跌幅 / 换手率 / 成交量 / 波动率：与列表展示一致，输入数字与百分号与界面同口径。
 * - 其它：输入带 % 且原始单元格为 0~1 小数时，将百分数转为小数再与可比值比。
 */
function normalizeFilterTarget(
  field: string,
  target: number,
  explicitPercent: boolean,
  rawCell: number,
): number {
  const kind = classifyField(field);
  if (
    kind === "zhangdiefu" ||
    kind === "turnover" ||
    kind === "volume" ||
    kind === "volatility"
  ) {
    return target;
  }
  if (!explicitPercent) return target;
  if (isCellFractionLike(rawCell)) return target / 100;
  return target;
}

function filterComparableCellValue(row: StockData, field: string): number | null {
  return getFilterComparableNumericValue(field, row[field]);
}

function cellNumber(row: StockData, field: string): number | null {
  const v = row[field];
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return parseFilterNumber(String(v));
}

function cellString(row: StockData, field: string): string {
  const v = row[field];
  if (v === null || v === undefined) return "";
  return String(v);
}

function isEmptyCell(row: StockData, field: string): boolean {
  const v = row[field];
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

export function rowMatchesCondition(row: StockData, c: FieldFilterCondition): boolean {
  if (!c.field) return true;

  switch (c.op) {
    case "empty":
      return isEmptyCell(row, c.field);
    case "contains": {
      const hay = cellString(row, c.field).toLowerCase();
      const needle = c.value.trim().toLowerCase();
      if (!needle) return true;
      return hay.includes(needle);
    }
    case "between": {
      const raw = cellNumber(row, c.field);
      if (raw === null) return false;
      const n = filterComparableCellValue(row, c.field);
      if (n === null) return false;
      const loP = parseFilterNumberWithPercent(c.value);
      const hiP = parseFilterNumberWithPercent(c.value2 ?? "");
      if (loP.n === null || hiP.n === null) return true;
      const loN = normalizeFilterTarget(
        c.field,
        loP.n,
        loP.explicitPercent,
        raw,
      );
      const hiN = normalizeFilterTarget(
        c.field,
        hiP.n,
        hiP.explicitPercent,
        raw,
      );
      const a = Math.min(loN, hiN);
      const b = Math.max(loN, hiN);
      return n >= a && n <= b;
    }
    case "eq":
    case "neq": {
      const raw = cellNumber(row, c.field);
      const n = filterComparableCellValue(row, c.field);
      const tp = parseFilterNumberWithPercent(c.value);
      if (tp.n !== null && n !== null && raw !== null) {
        const t = normalizeFilterTarget(c.field, tp.n, tp.explicitPercent, raw);
        return c.op === "eq" ? n === t : n !== t;
      }
      const s = cellString(row, c.field);
      const t = c.value.trim();
      return c.op === "eq" ? s === t : s !== t;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const raw = cellNumber(row, c.field);
      const n = filterComparableCellValue(row, c.field);
      const tp = parseFilterNumberWithPercent(c.value);
      if (n === null || raw === null || tp.n === null) return false;
      const target = normalizeFilterTarget(
        c.field,
        tp.n,
        tp.explicitPercent,
        raw,
      );
      switch (c.op) {
        case "gt":
          return n > target;
        case "gte":
          return n >= target;
        case "lt":
          return n < target;
        case "lte":
          return n <= target;
        default:
          return true;
      }
    }
    default:
      return true;
  }
}

/** 仅保留有效条件（有字段、操作符，且值满足操作要求） */
export function normalizeActiveConditions(
  list: FieldFilterCondition[],
): FieldFilterCondition[] {
  return list.filter((c) => {
    if (!c.field || !c.op) return false;
    if (c.op === "empty") return true;
    if (c.op === "between") {
      return (
        c.value.trim() !== "" && (c.value2?.trim() ?? "") !== ""
      );
    }
    if (c.op === "contains" || c.op === "eq" || c.op === "neq") {
      return c.value.trim() !== "";
    }
    return c.value.trim() !== "";
  });
}

export function applyFieldConditions(
  rows: StockData[],
  conditions: FieldFilterCondition[],
  logic: FieldFilterLogic,
): StockData[] {
  const active = normalizeActiveConditions(conditions);
  if (active.length === 0) return rows;

  return rows.filter((row) => {
    const matches = active.map((c) => rowMatchesCondition(row, c));
    return logic === "all" ? matches.every(Boolean) : matches.some(Boolean);
  });
}
