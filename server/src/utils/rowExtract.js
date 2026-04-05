/**
 * 从任意 Excel 行对象中解析「代码 / 名称 / 日期 / 波动率」等高频索引字段。
 * 列名可增删改：通过关键字匹配，不写死完整 25 列。
 */

const CODE_KEYS = ['代码', 'code', 'CODE', '证券代码', '股票代码'];
const NAME_KEYS = ['名称', 'name', 'NAME', '股票名称', '证券简称'];
const DATE_KEYS = ['日期', 'date', 'DATE', '交易日期'];
const VOL_KEYS = ['波动率', 'volatility', 'VOLATILITY'];

function normalizeStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  return String(v).trim();
}

/** 在对象上按候选键名查找值 */
function pickByKeys(row, candidates) {
  const keys = Object.keys(row);
  for (const want of candidates) {
    if (row[want] !== undefined && row[want] !== null && row[want] !== '') {
      return normalizeStr(row[want]);
    }
  }
  for (const k of keys) {
    const nk = k.replace(/\s/g, '');
    for (const want of candidates) {
      if (nk === want || nk.includes(want)) {
        const v = row[k];
        if (v !== undefined && v !== null && v !== '') return normalizeStr(v);
      }
    }
  }
  return '';
}

/** 日期统一为 YYYY-MM-DD 便于去重与索引 */
export function normalizeDateStr(raw) {
  const s = normalizeStr(raw);
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

export function extractIndexedFields(row) {
  const code = pickByKeys(row, CODE_KEYS);
  let name = pickByKeys(row, NAME_KEYS);
  const dateRaw = pickByKeys(row, DATE_KEYS);
  const dateStr = normalizeDateStr(dateRaw);

  let volatility = null;
  for (const k of Object.keys(row)) {
    if (VOL_KEYS.some((vk) => k.includes(vk) || k.toLowerCase().includes('volatility'))) {
      const v = row[k];
      if (v === '' || v === null || v === undefined) continue;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
      if (!Number.isNaN(n)) {
        volatility = n;
        break;
      }
    }
  }

  return { code, name, dateStr, volatility };
}

/** 将一行转为可 JSON 存储的纯数据对象（日期转字符串） */
export function serializeRowForPayload(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (v === null || v === undefined) {
      out[k] = null;
    } else {
      out[k] = v;
    }
  }
  return out;
}
