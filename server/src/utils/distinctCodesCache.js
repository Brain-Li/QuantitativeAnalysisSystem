/**
 * distinct-codes 接口的内存结果缓存（方案 A）。
 * 任一数据集行数据或数据集删除后须失效，否则会返回过期股票列表。
 */

const cache = new Map();
const MAX_ENTRIES = 64;

function sortedKey(datasetIds) {
  return [...datasetIds].sort().join('\x01');
}

/**
 * @param {string[]} datasetIds
 * @returns {{ code: string, name: string }[] | null}
 */
export function getDistinctCodesFromCache(datasetIds) {
  const key = sortedKey(datasetIds);
  const hit = cache.get(key);
  return hit ? hit.map((o) => ({ ...o })) : null;
}

/**
 * @param {string[]} datasetIds
 * @param {{ code: string, name: string }[]} options
 */
export function setDistinctCodesCache(datasetIds, options) {
  const key = sortedKey(datasetIds);
  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(
    key,
    options.map((o) => ({ code: o.code, name: o.name })),
  );
}

/** 任一涉及的数据集变更时，删除所有包含这些 id 的缓存项 */
export function invalidateDistinctCacheForDatasets(ids) {
  if (!ids?.length) return;
  const set = new Set(ids);
  for (const k of [...cache.keys()]) {
    const parts = k.split('\x01');
    if (parts.some((id) => set.has(id))) cache.delete(k);
  }
}

export function invalidateDistinctCacheAll() {
  cache.clear();
}
