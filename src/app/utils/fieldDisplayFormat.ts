/**
 * 股票列表 / 趋势分析：字段与指标展示格式化（展示层；绑图、排序仍用原始值）。
 *
 * 规则与《docs/字段展示规则说明.md》条文一致，摘要如下：
 * 1 日期：日到日，去时分秒
 * 2 涨跌幅：新值=原始值/100，再以百分数展示两位小数，+红 -绿
 * 3 换手率：表头「换手率」；新值=原始值×100，再以百分数展示两位小数（实现上对极小/较大原始值见 formatTurnoverPercentDisplay）
 * 4 成交量：万单位，两位小数
 * 5 波动率：百分数，两位小数
 * 6 BETA / 7 相关性：两位小数
 * 8 macd_signal：三位小数
 * 其余字段：股票列表按原始值展示。趋势分析 Tooltip/纵轴刻度对未分类数值统一保留两位小数。
 * 纵轴 domain：`computeTrendYAxisDomain`；含 0 与否见 `trendYAxisShouldIncludeZero`（见《字段展示规则说明》趋势分析纵轴章节）。
 */

import type { StockData } from '../types';

export type FieldFormatKind =
  | 'date'
  | 'zhangdiefu'
  | 'turnover'
  | 'volume'
  | 'volatility'
  | 'beta'
  | 'correlation'
  | 'macd_signal'
  | 'slowkdj_signal'
  | 'zongfen'
  | 'plain';

function norm(field: string): string {
  return field.trim().toLowerCase().replace(/\s+/g, '');
}

/** 是否为「日期」类字段（具体到日、去时分秒） */
export function isDateLikeField(field: string): boolean {
  const f = norm(field);
  return (
    field.includes('日期') ||
    f.includes('date') ||
    field.includes('时间') ||
    f.includes('time')
  );
}

export function classifyField(field: string): FieldFormatKind {
  const f = norm(field);
  if (isDateLikeField(field)) return 'date';
  if (f.includes('slowkdj_signal') || f.includes('slowkdj')) return 'slowkdj_signal';
  if (f.includes('macd_signal') || f === 'macdsignal') return 'macd_signal';
  if (field.includes('总分')) return 'zongfen';
  if (field.includes('涨跌幅')) return 'zhangdiefu';
  if (field.includes('换手率')) return 'turnover';
  if (f === 'turnover') return 'turnover';
  if (field.includes('成交量') || f === 'volume') return 'volume';
  if (field.includes('波动率') || f === 'volatility') return 'volatility';
  if (f.includes('beta') || field.includes('BETA') || field.includes('贝塔')) return 'beta';
  if (field.includes('相关性') || f.includes('correlation')) return 'correlation';
  return 'plain';
}

/** 换手率类列：表头「换手率%」等改为「换手率」 */
export function getFieldDisplayHeader(field: string): string {
  if (classifyField(field) === 'turnover') return '换手率';
  return field.trim();
}

export function formatDateCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const s = String(value).trim();
  if (!s) return '-';
  if (s.includes(' ')) return s.split(/\s+/)[0];
  if (s.includes('T')) return s.split('T')[0];
  return s;
}

/** 未命中 1～8 类时的单元格/刻度文案：直接转字符串，即按原始值展示 */
function formatPlainRawDisplay(value: unknown): string {
  return String(value);
}

function numOrNaN(value: unknown): number {
  if (typeof value === 'number') return value;
  const s = String(value)
    .trim()
    .replace(/^-\s+/, '-')
    .replace(/\s+/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 换手率（条文：先原始值×100 得新值，再将新值以百分数形式展示，两位小数）。
 * 示例：0.001255 → 12.55%。
 *
 * 「以百分数形式」在实现上：若新值=原始值×100 后已可直接读作百分数（如 0.0584→5.84），则不再乘；
 * 若原始值很小（&lt;0.01）且新值仍小于 0.15，再×100 与示例一致；若新值≥0.15（如 0.008→0.80）则不再乘，避免 80%。
 */
export function formatTurnoverPercentDisplay(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 0.01) {
    return `${(n * 100).toFixed(2)}%`;
  }
  const newVal = n * 100;
  if (newVal === 0) return '0.00%';
  const pct = Math.abs(newVal) < 0.15 ? newVal * 100 : newVal;
  return `${pct.toFixed(2)}%`;
}

/**
 * 与 `formatTurnoverPercentDisplay` 同一口径的「百分号前的数值」，供筛选与展示对齐。
 */
export function turnoverComparablePercentPoints(raw: number): number {
  if (!Number.isFinite(raw)) return raw;
  const abs = Math.abs(raw);
  if (abs >= 0.01) return raw * 100;
  const newVal = raw * 100;
  if (newVal === 0) return 0;
  return Math.abs(newVal) < 0.15 ? newVal * 100 : newVal;
}

/**
 * 与 `formatFieldCellDisplay` 同一量纲的数值，供字段条件筛选与列表展示对齐。
 * - 涨跌幅：条文「新值=原始值/100」；常见 Excel 存 800 表示 8% 时，与界面「8.xx%」对齐用原始值/100；原始值≤100 时视为已与百分号前数字一致。
 * - 波动率：列表为 (原始值×100) 百分数，与输入「35」「35%」对齐。
 * - 换手率 / 成交量：同既有 `turnoverComparablePercentPoints`、万单位。
 */
export function getFilterComparableNumericValue(
  field: string,
  value: unknown,
): number | null {
  const n = numOrNaN(value);
  if (!Number.isFinite(n)) return null;
  const kind = classifyField(field);
  switch (kind) {
    case 'zhangdiefu': {
      const abs = Math.abs(n);
      if (abs > 100) return n / 100;
      return n;
    }
    case 'turnover':
      return turnoverComparablePercentPoints(n);
    case 'volume':
      return n / 10000;
    case 'volatility':
      return n * 100;
    default:
      return n;
  }
}

export interface CellDisplayResult {
  text: string;
  className?: string;
}

/**
 * 股票列表单元格：格式化 + 涨跌幅颜色
 */
export function formatFieldCellDisplay(field: string, value: unknown): CellDisplayResult {
  if (value === null || value === undefined || value === '') {
    return { text: '-' };
  }

  const kind = classifyField(field);
  const n = numOrNaN(value);

  switch (kind) {
    case 'date':
      return { text: formatDateCell(value) };
    case 'zhangdiefu': {
      if (!Number.isFinite(n)) return { text: String(value) };
      const newVal = n / 100;
      const asPercent = newVal * 100;
      const absStr = Math.abs(asPercent).toFixed(2);
      if (asPercent > 0) {
        return { text: `+${absStr}%`, className: 'text-red-600 font-medium' };
      }
      if (asPercent < 0) {
        return { text: `-${absStr}%`, className: 'text-green-600 font-medium' };
      }
      return { text: '0.00%' };
    }
    case 'turnover': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: formatTurnoverPercentDisplay(n) };
    }
    case 'volume': {
      if (!Number.isFinite(n)) return { text: String(value) };
      const wan = n / 10000;
      return { text: `${wan.toFixed(2)}万` };
    }
    case 'volatility': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: `${(n * 100).toFixed(2)}%` };
    }
    case 'beta': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: n.toFixed(2) };
    }
    case 'correlation': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: n.toFixed(2) };
    }
    case 'macd_signal': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: n.toFixed(3) };
    }
    case 'slowkdj_signal': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: n.toFixed(3) };
    }
    case 'zongfen': {
      if (!Number.isFinite(n)) return { text: String(value) };
      return { text: n.toFixed(1) };
    }
    default:
      return { text: formatPlainRawDisplay(value) };
  }
}

/**
 * 趋势分析：Tooltip 与纵轴刻度文案（不经由列表「plain=原始字符串」路径，避免纵轴刻度出现过多小数位）。
 * 未命中 1～8 类的数值：统一两位小数；非数值仍 `String(value)`。
 */
export function formatMetricValueForChart(field: string, value: unknown): string {
  const kind = classifyField(field);
  if (kind === 'plain') {
    const n = numOrNaN(value);
    if (Number.isFinite(n)) return n.toFixed(2);
    return formatPlainRawDisplay(value);
  }
  const r = formatFieldCellDisplay(field, value);
  return r.text;
}

export function isZhangDieFuField(field: string): boolean {
  return classifyField(field) === 'zhangdiefu';
}

export function zhangDieFuStyle(value: unknown): { color: string } | undefined {
  const n = numOrNaN(value);
  if (!Number.isFinite(n)) return undefined;
  const asPercent = (n / 100) * 100;
  if (asPercent > 0) return { color: '#dc2626' };
  if (asPercent < 0) return { color: '#16a34a' };
  return undefined;
}

/** 涨跌幅纵轴：科创板/创业板 ±20%，主板 ±10%（与 Excel 存数口径一致，domain 为原始值刻度） */
export function getZhangDieFuYDomainByStockCode(stockCode: string): [number, number] {
  const c = String(stockCode ?? '').trim();
  if (c.startsWith('688') || c.startsWith('300')) {
    return [-20, 20];
  }
  if (c.startsWith('60') || c.startsWith('00')) {
    return [-10, 10];
  }
  return [-10, 10];
}

const OHLC_ZH_SUBSTR = ['开盘', '最高', '最低', '收盘'] as const;

/**
 * 趋势分析纵轴是否**强制含 0**、并绘制 y=0 参考线。
 * 开盘/最高/最低/收盘：仅按数据 padding，**不含 0 轴**，以免价格走势被压扁。
 */
export function trendYAxisShouldIncludeZero(metric: string): boolean {
  if (classifyField(metric) === 'zhangdiefu') return true;

  const f = norm(metric).replace(/_/g, '');

  for (const s of OHLC_ZH_SUBSTR) {
    if (metric.includes(s)) return false;
  }
  if (f === 'open' || f === 'high' || f === 'low' || f === 'close') return false;

  return true;
}

function computePaddedMinMaxForKey(rows: StockData[], key: string): [number, number] | undefined {
  if (rows.length === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const v = Number(row[key]);
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    let lo = min - pad;
    const hi = max + pad;
    if (min >= 0) lo = Math.max(0, lo);
    return [lo, hi];
  }
  const pad = (max - min) * 0.12;
  let lo = min - pad;
  const hi = max + pad;
  if (min >= 0) lo = Math.max(0, lo);
  return [lo, hi];
}

/**
 * 趋势分析纵轴：涨跌幅按股票代码固定区间；其余指标在 padding 后按 `trendYAxisShouldIncludeZero` 决定是否**含 0**。
 */
export function computeTrendYAxisDomain(
  rows: StockData[],
  metric: string,
  stockCode: string
): [number, number] | undefined {
  const kind = classifyField(metric);
  if (kind === 'zhangdiefu') {
    return getZhangDieFuYDomainByStockCode(stockCode);
  }
  const padded = computePaddedMinMaxForKey(rows, metric);
  if (!padded) return undefined;
  let [lo, hi] = padded;
  if (trendYAxisShouldIncludeZero(metric)) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  return [lo, hi];
}
