/**
 * 将 JSON 筛选条件安全转为 SQLite WHERE 子句（json_extract(payload_json, ...)）
 * filters: [{ "field": "总分", "op": "gte", "value": 10 }, ...]
 */

const ALLOWED_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like']);

const FIELD_RE = /^[\u4e00-\u9fff\w.%+\-·（）()\s]{1,128}$/;

export function validateFieldName(field) {
  if (typeof field !== 'string' || !FIELD_RE.test(field.trim())) {
    return null;
  }
  return field.trim();
}

function jsonPath(field) {
  return '$."' + field.replace(/"/g, '""') + '"';
}

/**
 * @returns {{ sql: string, params: unknown[] }}
 */
export function buildFilterClause(filters) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return { sql: '', params: [] };
  }

  const parts = [];
  const params = [];

  for (const f of filters) {
    if (!f || typeof f !== 'object') continue;
    const field = validateFieldName(String(f.field || ''));
    const op = String(f.op || '').toLowerCase();
    if (!field || !ALLOWED_OPS.has(op)) continue;

    const path = jsonPath(field);
    let val = f.value;

    if (op === 'like') {
      val = val == null ? '' : String(val);
    } else if (op !== 'eq' && op !== 'ne') {
      val = Number(val);
      if (Number.isNaN(val)) continue;
    }

    const jx = 'json_extract(payload_json, ?)';

    switch (op) {
      case 'eq':
        parts.push(`(${jx} = ?)`);
        params.push(path, val);
        break;
      case 'ne':
        parts.push(`(COALESCE(${jx}, '') != ?)`);
        params.push(path, val);
        break;
      case 'gt':
        parts.push(`(CAST(${jx} AS REAL) > ?)`);
        params.push(path, val);
        break;
      case 'gte':
        parts.push(`(CAST(${jx} AS REAL) >= ?)`);
        params.push(path, val);
        break;
      case 'lt':
        parts.push(`(CAST(${jx} AS REAL) < ?)`);
        params.push(path, val);
        break;
      case 'lte':
        parts.push(`(CAST(${jx} AS REAL) <= ?)`);
        params.push(path, val);
        break;
      case 'like':
        parts.push(`(CAST(${jx} AS TEXT) LIKE ?)`);
        params.push(path, val);
        break;
      default:
        break;
    }
  }

  if (parts.length === 0) return { sql: '', params: [] };

  return { sql: ` AND (${parts.join(' AND ')})`, params };
}
