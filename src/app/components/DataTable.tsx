import {
  useMemo,
  useState,
  useEffect,
  startTransition,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './ui/table';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { FieldSelector } from './FieldSelector';
import { StockFilter } from './StockFilter';
import { StockFieldFilterPopover } from './StockFieldFilterPopover';
import {
  DateRangePickerButton,
  type DateRange,
  getLast3DaysRange,
  normalizeDateRangeForApply,
  detectDateField,
} from './DateRangePickerButton';
import {
  Database,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import type { StockData, FieldConfig } from '../types';
import { formatFieldCellDisplay, getFieldDisplayHeader } from '../utils/fieldDisplayFormat';
import {
  applyDefaultStockListSort,
  detectTotalScoreField,
  filterSortStockRows,
} from '../utils/tableDataPipeline';
import {
  createEmptyFieldCondition,
  normalizeActiveConditions,
  type FieldFilterCondition,
  type FieldFilterLogic,
  type FieldFilterOp,
} from '../utils/fieldFilter';
import {
  fetchAllMergedRowsForFilters,
  fetchDistinctCodesApi,
  queryMergedRowsApi,
} from '../api/serverApi';
import { streamLocalIdbForDataTable } from '../api/localDatasetIdb';
import { cn } from './ui/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  STORAGE_KEY_DATATABLE_DATE_RANGE as STORAGE_KEY_DATE_RANGE,
  STORAGE_KEY_DATATABLE_FIELD_FILTERS as STORAGE_KEY_FIELD_FILTERS,
  STORAGE_KEY_DATATABLE_SELECTED_STOCKS as STORAGE_KEY_SELECTED_STOCKS,
  loadDataTableDateRangeFromStorage,
  loadDataTableSelectedStocksFromStorage,
} from '../sessionPersistence';

function dateRangeIsLast3Days(d: DateRange): boolean {
  const r = getLast3DaysRange();
  return d.start === r.start && d.end === r.end;
}

/** 与列表/服务端一致：未选或已选满全部代码视为「全选」 */
function stockSelectionIsAll(optionCodes: string[], selected: string[]): boolean {
  if (optionCodes.length === 0) return true;
  if (selected.length === 0) return true;
  if (selected.length !== optionCodes.length) return false;
  const sel = new Set(selected);
  return optionCodes.every((c) => sel.has(c));
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
/** 合并 query-rows 依赖的短时抖动（股票列表与选中代码连续更新），减少多余请求与 DevTools 中 canceled */
const SERVER_QUERY_DEBOUNCE_MS = 48;
/** 当前页行数超过此值时用虚拟列表，减轻 DOM 节点数 */
const VIRTUAL_ROW_THRESHOLD = 36;
/** 本地模式下超过此行数时用 Web Worker 做筛选排序，减轻主线程卡顿 */
const WORKER_MIN_ROWS = 4000;

/** 无有效字段筛选时复用同一引用，避免 normalize 每次 new [] 触发多余请求 */
const EMPTY_ACTIVE_FIELD_CONDITIONS: FieldFilterCondition[] = [];

const VALID_FIELD_OPS = new Set<FieldFilterOp>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'empty',
]);

function loadFieldFiltersFromStorage(): {
  conditions: FieldFilterCondition[];
  logic: FieldFilterLogic;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FIELD_FILTERS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { conditions, logic } = parsed as {
      conditions?: unknown;
      logic?: unknown;
    };
    if (logic !== 'all' && logic !== 'any') return null;
    if (!Array.isArray(conditions)) return null;
    if (conditions.length === 0) {
      return { conditions: [], logic };
    }
    const out: FieldFilterCondition[] = [];
    for (const c of conditions) {
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      if (
        typeof o.id !== 'string' ||
        typeof o.field !== 'string' ||
        typeof o.op !== 'string' ||
        typeof o.value !== 'string'
      ) {
        continue;
      }
      if (!VALID_FIELD_OPS.has(o.op as FieldFilterOp)) continue;
      out.push({
        id: o.id,
        field: o.field,
        op: o.op as FieldFilterOp,
        value: o.value,
        value2: typeof o.value2 === 'string' ? o.value2 : '',
      });
    }
    if (out.length === 0) return null;
    return { conditions: out, logic };
  } catch {
    return null;
  }
}

function getInitialFieldFilters(): {
  conditions: FieldFilterCondition[];
  logic: FieldFilterLogic;
} {
  return (
    loadFieldFiltersFromStorage() ?? {
      conditions: [createEmptyFieldCondition()],
      logic: 'all',
    }
  );
}

interface DataTableProps {
  data: StockData[];
  fieldConfigs: FieldConfig[];
  allFields: string[];
  onFieldConfigsChange: (configs: FieldConfig[]) => void;
  onRowClick?: (row: StockData) => void;
  /** 非空时走服务端多数据集合并分页（需已登录数据服务），不再依赖本地 data 全量 */
  serverDatasetIds?: string[];
  /** 未登录时：选中项里若有 IndexedDB 大表，从本地合并加载行（与 data 中内存行合并） */
  localIdbDatasetIds?: string[];
}

type SortDirection = 'asc' | 'desc' | null;

function detectStockFields(fields: string[]): { code: string | null; name: string | null } {
  const codeKeywords = ['代码', 'code', 'Code', '股票代码'];
  const nameKeywords = ['名称', 'name', 'Name', '股票名称'];
  const code = fields.find((f) => codeKeywords.some((k) => f.includes(k))) ?? null;
  const name = fields.find((f) => nameKeywords.some((k) => f.includes(k))) ?? null;
  return { code, name };
}

// ─── Sort Icon ────────────────────────────────────────────────────────────────
function SortIcon({ direction }: { direction: SortDirection }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="inline-block ml-2">
      <path
        d="M10 5L13 9H7L10 5Z"
        fill={direction === 'asc' ? '#155DFC' : '#6B7280'}
        opacity={direction === 'asc' ? 1 : 0.7}
      />
      <path
        d="M10 15L7 11H13L10 15Z"
        fill={direction === 'desc' ? '#155DFC' : '#6B7280'}
        opacity={direction === 'desc' ? 1 : 0.7}
      />
    </svg>
  );
}

export function DataTable({
  data,
  fieldConfigs,
  allFields,
  onFieldConfigsChange,
  onRowClick,
  serverDatasetIds,
  localIdbDatasetIds,
}: DataTableProps) {
  const serverMode = Boolean(serverDatasetIds && serverDatasetIds.length > 0);
  const localIdbMode = !serverMode && Boolean(localIdbDatasetIds?.length);
  const localIdbKey = useMemo(
    () => (localIdbDatasetIds ?? []).join(','),
    [localIdbDatasetIds],
  );

  const [idbBuffered, setIdbBuffered] = useState<StockData[]>([]);
  const [idbLoading, setIdbLoading] = useState(false);
  const [idbStreamStockOpts, setIdbStreamStockOpts] = useState<{ code: string; name: string }[]>([]);

  /** 切换菜单后恢复上次日期；无记录时默认近 3 天 */
  const [dateRange, setDateRange] = useState<DateRange>(
    () => loadDataTableDateRangeFromStorage() ?? getLast3DaysRange()
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(
    () => loadDataTableDateRangeFromStorage() ?? getLast3DaysRange()
  );

  /** 从 localStorage 恢复；与当前数据集的代码取交集，若无交集则默认全选 */
  const [selectedStocks, setSelectedStocks] = useState<string[]>(
    () => loadDataTableSelectedStocksFromStorage() ?? []
  );

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [fieldConditions, setFieldConditions] = useState<FieldFilterCondition[]>(
    () => getInitialFieldFilters().conditions,
  );
  const [fieldLogic, setFieldLogic] = useState<FieldFilterLogic>(
    () => getInitialFieldFilters().logic,
  );
  /** 递增以通知 StockFieldFilterPopover 关闭「选择字段」下拉 */
  const [fieldFilterResetSignal, setFieldFilterResetSignal] = useState(0);

  const [serverStockOptions, setServerStockOptions] = useState<{ code: string; name: string }[]>([]);
  /** distinct-codes 是否已返回（用于股票下拉；表格 query-rows 不再等待此项） */
  const [serverDistinctReady, setServerDistinctReady] = useState(false);
  const [serverRows, setServerRows] = useState<StockData[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  /** 服务端 + 自定义字段筛选时拉取合并后的全量行，再在前端筛选与分页 */
  const [serverBulkRows, setServerBulkRows] = useState<StockData[] | null>(null);
  const [serverBulkLoading, setServerBulkLoading] = useState(false);
  const serverQueryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverQueryAbortRef = useRef<AbortController | null>(null);

  const [workerRows, setWorkerRows] = useState<StockData[] | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const workerRunIdRef = useRef(0);

  const dateField = useMemo(() => detectDateField(allFields), [allFields]);
  const stockFields = useMemo(() => detectStockFields(allFields), [allFields]);
  const totalScoreField = useMemo(
    () => detectTotalScoreField(allFields),
    [allFields],
  );
  const serverIdsKey = useMemo(
    () => (serverDatasetIds ?? []).join(','),
    [serverDatasetIds],
  );

  const selectedStocksKeyForIdb = useMemo(
    () => selectedStocks.join('\u0001'),
    [selectedStocks],
  );

  const tableSourceData = useMemo(
    () => (serverMode ? data : [...data, ...idbBuffered]),
    [serverMode, data, idbBuffered],
  );

  useEffect(() => {
    if (!localIdbMode || !localIdbDatasetIds?.length) {
      setIdbBuffered([]);
      setIdbStreamStockOpts([]);
      setIdbLoading(false);
      return;
    }
    let cancelled = false;
    setIdbLoading(true);
    void streamLocalIdbForDataTable(localIdbDatasetIds, {
      dateField,
      dateRange,
      stockCodeField: stockFields.code,
      selectedStocks,
      nameField: stockFields.name,
    })
      .then(({ filteredRows, stockOptions: opts }) => {
        if (!cancelled) {
          setIdbBuffered(filteredRows);
          setIdbStreamStockOpts(opts);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : '加载本地数据失败');
          setIdbBuffered([]);
          setIdbStreamStockOpts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIdbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    localIdbMode,
    localIdbKey,
    localIdbDatasetIds,
    dateField,
    dateRange.start,
    dateRange.end,
    stockFields.code,
    stockFields.name,
    selectedStocksKeyForIdb,
  ]);

  const useLocalWorker = !serverMode && tableSourceData.length >= WORKER_MIN_ROWS;

  const localStockOptions = useMemo(() => {
    const { code, name } = stockFields;
    if (!code) return [];

    const seen = new Set<string>();
    const options: { code: string; name: string }[] = [];

    tableSourceData.forEach((row) => {
      const stockCode = row[code] ? String(row[code]) : '';
      if (stockCode && !seen.has(stockCode)) {
        seen.add(stockCode);
        const stockName = name && row[name] ? String(row[name]) : stockCode;
        options.push({ code: stockCode, name: stockName });
      }
    });

    return options.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'));
  }, [tableSourceData, stockFields]);

  const stockOptions = serverMode
    ? serverStockOptions
    : localIdbMode && idbStreamStockOpts.length > 0
      ? idbStreamStockOpts
      : localStockOptions;

  const stockOptionCodes = useMemo(
    () => stockOptions.map((o) => o.code),
    [stockOptions],
  );

  /** 服务端合并查询的 codes：options 未到时仍可用 localStorage 恢复的选中，避免误查「全股票」 */
  const serverQueryCodes = useMemo((): string[] | undefined => {
    if (!serverMode) return undefined;
    if (stockOptions.length > 0) {
      const selectedSet = new Set(selectedStocks);
      const allSelected =
        selectedStocks.length > 0 &&
        selectedStocks.length === stockOptions.length &&
        stockOptions.every((o) => selectedSet.has(o.code));
      if (selectedStocks.length > 0 && !allSelected) return selectedStocks;
      return undefined;
    }
    if (selectedStocks.length > 0) return selectedStocks;
    return undefined;
  }, [serverMode, stockOptions, selectedStocks]);

  const serverStockDistinctLoading =
    serverMode && Boolean(serverDatasetIds?.length) && !serverDistinctReady;

  const visibleFields = useMemo(() => {
    return fieldConfigs
      .filter((c) => c.visible)
      .sort((a, b) => a.order - b.order)
      .map((c) => c.name);
  }, [fieldConfigs]);

  const filterableFields = useMemo(
    () => allFields.filter((f) => f !== '_empty'),
    [allFields],
  );

  const filteredFieldConditions = useMemo(() => {
    const next = normalizeActiveConditions(fieldConditions);
    if (next.length === 0) return EMPTY_ACTIVE_FIELD_CONDITIONS;
    return next;
  }, [fieldConditions]);

  /** 仅当「有效筛选」或逻辑组合真正变化时变化；只加空行不触发 */
  const activeFieldConditionsKey = useMemo(
    () =>
      JSON.stringify({
        conditions: filteredFieldConditions,
        logic: fieldLogic,
      }),
    [filteredFieldConditions, fieldLogic],
  );

  const canResetStockListModule = useMemo(() => {
    const dateDirty = !dateRangeIsLast3Days(dateRange);
    const stocksDirty = !stockSelectionIsAll(stockOptionCodes, selectedStocks);
    const filtersDirty =
      filteredFieldConditions.length > 0 || fieldLogic !== 'all';
    return dateDirty || stocksDirty || filtersDirty;
  }, [dateRange, stockOptionCodes, selectedStocks, filteredFieldConditions, fieldLogic]);

  const resetStockListModule = useCallback(() => {
    const d = getLast3DaysRange();
    startTransition(() => {
      setDateRange(d);
      setTempRange(d);
      setSelectedStocks(stockOptionCodes.length > 0 ? [...stockOptionCodes] : []);
      setFieldConditions([createEmptyFieldCondition()]);
      setFieldLogic('all');
    });
    setFieldFilterResetSignal((n) => n + 1);
    setDatePickerOpen(false);
  }, [stockOptionCodes]);

  // Save to localStorage when changed（失败时静默，避免隐私模式/配额抛错打断渲染）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DATE_RANGE, JSON.stringify(dateRange));
    } catch {
      /* ignore */
    }
  }, [dateRange]);

  useEffect(() => {
    if (selectedStocks.length === 0 && localStorage.getItem(STORAGE_KEY_SELECTED_STOCKS) === null) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED_STOCKS, JSON.stringify(selectedStocks));
    } catch {
      /* ignore */
    }
  }, [selectedStocks]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_FIELD_FILTERS,
        JSON.stringify({ conditions: fieldConditions, logic: fieldLogic }),
      );
    } catch {
      /* ignore */
    }
  }, [fieldConditions, fieldLogic]);

  /** 股票选项异步就绪后再与选中取交集；选项为空时不写入 []，避免切换模块/刷新初期抹掉 localStorage 已恢复的记忆 */
  useEffect(() => {
    if (stockOptions.length === 0) {
      return;
    }
    startTransition(() => {
      setSelectedStocks((prev) => {
        const codes = new Set(stockOptions.map((o) => o.code));
        const filtered = prev.filter((c) => codes.has(c));
        if (filtered.length > 0) return filtered;
        return stockOptions.map((o) => o.code);
      });
    });
  }, [stockOptions]);

  useEffect(() => {
    if (!serverMode || !serverDatasetIds?.length) {
      setServerStockOptions([]);
      setServerDistinctReady(false);
      return;
    }
    setServerDistinctReady(false);
    const ac = new AbortController();
    void fetchDistinctCodesApi(serverDatasetIds, ac.signal)
      .then((opts) => {
        if (ac.signal.aborted) return;
        setServerStockOptions(opts);
        setServerDistinctReady(true);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof Error && e.name === 'AbortError') return;
        toast.error(e instanceof Error ? e.message : '获取股票列表失败');
        setServerStockOptions([]);
        setServerDistinctReady(true);
      });
    return () => ac.abort();
  }, [serverMode, serverIdsKey, serverDatasetIds]);

  const syncPipelineData = useMemo(
    () =>
      filterSortStockRows({
        rows: tableSourceData,
        dateField,
        dateRange,
        stockCodeField: stockFields.code,
        selectedStocks,
        sortField,
        sortDirection,
        totalScoreField,
        fieldConditions: filteredFieldConditions,
        fieldLogic,
      }),
    [
      tableSourceData,
      dateField,
      dateRange,
      stockFields.code,
      selectedStocks,
      sortField,
      sortDirection,
      totalScoreField,
      filteredFieldConditions,
      fieldLogic,
    ],
  );

  useEffect(() => {
    if (!useLocalWorker) {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      setWorkerRows(null);
      setWorkerBusy(false);
      return;
    }
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/dataTablePipeline.worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    const id = ++workerRunIdRef.current;
    setWorkerBusy(true);
    const w = workerRef.current;
    w.postMessage({
      id,
      rows: tableSourceData,
      dateField,
      dateRange,
      stockCodeField: stockFields.code,
      selectedStocks,
      sortField,
      sortDirection,
      totalScoreField,
      fieldConditions: filteredFieldConditions,
      fieldLogic,
    });
    const onMsg = (e: MessageEvent<{ id: number; ok: boolean; filtered?: StockData[]; error?: string }>) => {
      const d = e.data;
      if (d.id !== id) return;
      setWorkerBusy(false);
      if (d.ok && Array.isArray(d.filtered)) {
        setWorkerRows(d.filtered);
        return;
      }
      toast.error(d.error || '数据处理失败');
      setWorkerRows(
        filterSortStockRows({
          rows: tableSourceData,
          dateField,
          dateRange,
          stockCodeField: stockFields.code,
          selectedStocks,
          sortField,
          sortDirection,
          totalScoreField,
          fieldConditions: filteredFieldConditions,
          fieldLogic,
        }),
      );
    };
    w.onmessage = onMsg;
    return () => {
      w.onmessage = null;
    };
  }, [
    useLocalWorker,
    tableSourceData,
    dateField,
    dateRange,
    stockFields.code,
    selectedStocks,
    sortField,
    sortDirection,
    totalScoreField,
    filteredFieldConditions,
    fieldLogic,
  ]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!serverMode || !serverDatasetIds?.length) {
      if (serverQueryTimerRef.current) {
        clearTimeout(serverQueryTimerRef.current);
        serverQueryTimerRef.current = null;
      }
      serverQueryAbortRef.current?.abort();
      serverQueryAbortRef.current = null;
      setServerRows([]);
      setServerTotal(0);
      setServerLoading(false);
      return;
    }

    if (filteredFieldConditions.length > 0) {
      setServerLoading(false);
      return () => {
        if (serverQueryTimerRef.current) {
          clearTimeout(serverQueryTimerRef.current);
          serverQueryTimerRef.current = null;
        }
        serverQueryAbortRef.current?.abort();
        serverQueryAbortRef.current = null;
      };
    }

    if (serverQueryTimerRef.current) {
      clearTimeout(serverQueryTimerRef.current);
      serverQueryTimerRef.current = null;
    }
    serverQueryAbortRef.current?.abort();

    serverQueryTimerRef.current = setTimeout(() => {
      serverQueryTimerRef.current = null;
      const ac = new AbortController();
      serverQueryAbortRef.current = ac;
      setServerLoading(true);

      void queryMergedRowsApi(
        {
          datasetIds: serverDatasetIds,
          page: currentPage,
          pageSize,
          dateFrom: dateRange.start || undefined,
          dateTo: dateRange.end || undefined,
          codes: serverQueryCodes,
          sortField,
          sortDirection,
        },
        ac.signal,
      )
        .then((r) => {
          setServerRows(r.data);
          setServerTotal(r.total);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          if (e instanceof Error && e.name === 'AbortError') return;
          toast.error(e instanceof Error ? e.message : '加载数据失败');
          setServerRows([]);
          setServerTotal(0);
        })
        .finally(() => {
          if (!ac.signal.aborted) setServerLoading(false);
        });
    }, SERVER_QUERY_DEBOUNCE_MS);

    return () => {
      if (serverQueryTimerRef.current) {
        clearTimeout(serverQueryTimerRef.current);
        serverQueryTimerRef.current = null;
      }
      serverQueryAbortRef.current?.abort();
      serverQueryAbortRef.current = null;
    };
  }, [
    serverMode,
    serverIdsKey,
    serverDatasetIds,
    currentPage,
    pageSize,
    dateRange.start,
    dateRange.end,
    selectedStocksKeyForIdb,
    sortField,
    sortDirection,
    stockOptions.length,
    activeFieldConditionsKey,
    serverQueryCodes,
  ]);

  useEffect(() => {
    if (!serverMode || !serverDatasetIds?.length) {
      setServerBulkRows(null);
      setServerBulkLoading(false);
      return;
    }
    if (filteredFieldConditions.length === 0) {
      setServerBulkRows(null);
      setServerBulkLoading(false);
      return;
    }

    const ac = new AbortController();
    setServerBulkLoading(true);
    setServerBulkRows(null);

    void fetchAllMergedRowsForFilters(
      {
        datasetIds: serverDatasetIds,
        dateFrom: dateRange.start || undefined,
        dateTo: dateRange.end || undefined,
        codes: serverQueryCodes,
        sortField: null,
        sortDirection: null,
      },
      ac.signal,
    )
      .then((rows) => {
        if (!ac.signal.aborted) setServerBulkRows(rows);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof Error && e.name === 'AbortError') return;
        toast.error(e instanceof Error ? e.message : '加载数据失败');
        if (!ac.signal.aborted) setServerBulkRows([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setServerBulkLoading(false);
      });

    return () => ac.abort();
  }, [
    serverMode,
    serverIdsKey,
    serverDatasetIds,
    activeFieldConditionsKey,
    dateRange.start,
    dateRange.end,
    selectedStocksKeyForIdb,
    stockOptions.length,
    selectedStocks.length,
    serverQueryCodes,
  ]);

  const pipelineData = useMemo(() => {
    if (serverMode) {
      if (filteredFieldConditions.length === 0) {
        if (sortField && sortDirection) {
          return serverRows;
        }
        return applyDefaultStockListSort(
          serverRows,
          dateField,
          totalScoreField,
          stockFields.code,
        );
      }
      return filterSortStockRows({
        rows: serverBulkRows ?? [],
        dateField,
        dateRange,
        stockCodeField: stockFields.code,
        selectedStocks,
        sortField,
        sortDirection,
        totalScoreField,
        fieldConditions: filteredFieldConditions,
        fieldLogic,
      });
    }
    if (useLocalWorker) return workerRows ?? [];
    return syncPipelineData;
  }, [
    serverMode,
    filteredFieldConditions,
    serverRows,
    serverBulkRows,
    dateField,
    dateRange,
    stockFields.code,
    selectedStocks,
    sortField,
    sortDirection,
    totalScoreField,
    fieldLogic,
    useLocalWorker,
    workerRows,
    syncPipelineData,
  ]);

  const isSortable = (field: string) => {
    const nonSortable = ['_empty', '代码', '名称'];
    return !nonSortable.includes(field);
  };

  const tableBusy =
    serverLoading ||
    serverBulkLoading ||
    idbLoading ||
    (useLocalWorker && (workerBusy || workerRows === null));

  const totalCount =
    serverMode && filteredFieldConditions.length === 0
      ? serverTotal
      : pipelineData.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    startTransition(() => {
      setCurrentPage(1);
    });
  }, [
    tableSourceData,
    dateRange,
    selectedStocks,
    sortField,
    sortDirection,
    pageSize,
    serverIdsKey,
    localIdbKey,
    activeFieldConditionsKey,
  ]);

  const pagedData = useMemo(() => {
    if (serverMode && filteredFieldConditions.length === 0) return serverRows;
    const start = (currentPage - 1) * pageSize;
    return pipelineData.slice(start, start + pageSize);
  }, [
    serverMode,
    filteredFieldConditions.length,
    serverRows,
    pipelineData,
    currentPage,
    pageSize,
  ]);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const useVirtualRows = pagedData.length >= VIRTUAL_ROW_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: useVirtualRows ? pagedData.length : 0,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 41,
    overscan: 12,
  });

  useEffect(() => {
    if (!useVirtualRows) return;
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage, pageSize, useVirtualRows]);

  const handleSort = (field: string) => {
    if (!isSortable(field)) return;
    startTransition(() => {
      if (sortField === field) {
        if (sortDirection === null) setSortDirection('asc');
        else if (sortDirection === 'asc') setSortDirection('desc');
        else {
          setSortDirection(null);
          setSortField(null);
        }
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    });
  };

  const applyDateRange = (range?: DateRange) => {
    const n = normalizeDateRangeForApply(range ?? tempRange, {
      emptyToLast7: true,
      emptyDefaultRange: getLast3DaysRange,
    });
    startTransition(() => {
      setDateRange(n);
      setTempRange(n);
    });
    setDatePickerOpen(false);
  };

  const clearDateRange = () => {
    const d = getLast3DaysRange();
    startTransition(() => {
      setDateRange(d);
      setTempRange(d);
    });
    setDatePickerOpen(false);
  };

  const handleSelectedStocksChange = useCallback((stocks: string[]) => {
    startTransition(() => {
      setSelectedStocks(stocks);
    });
  }, []);

  const pageButtonsContent = useMemo((): ReactNode => {
    if (totalPages <= 1) return null;
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages.map((p, idx) =>
      p === '...' ? (
        <span key={`ellipsis-${idx}`} className="px-1.5 text-muted-foreground text-sm select-none">…</span>
      ) : (
        <button
          key={p}
          onClick={() => {
            startTransition(() => setCurrentPage(p as number));
          }}
          className={`min-w-8 h-8 px-1 rounded text-sm transition-colors ${
            currentPage === p
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-foreground'
          }`}
        >
          {p}
        </button>
      )
    );
  }, [totalPages, currentPage]);

  const toolbarContent = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <DateRangePickerButton
          appliedRange={dateRange}
          open={datePickerOpen}
          onOpenChange={(v) => {
            setDatePickerOpen(v);
            if (v) setTempRange(dateRange);
          }}
          tempRange={tempRange}
          onTempRangeChange={setTempRange}
          onApply={applyDateRange}
          onClear={clearDateRange}
          hasDateField={!!dateField}
          hasFilter={!!(dateRange.start || dateRange.end)}
          busy={tableBusy}
          emptyDefaultRange={getLast3DaysRange}
        />
        <StockFilter
          options={stockOptions}
          selected={selectedStocks}
          onChange={handleSelectedStocksChange}
          optionsLoading={serverStockDistinctLoading}
        />
        <StockFieldFilterPopover
          filterableFields={filterableFields}
          conditions={fieldConditions}
          logic={fieldLogic}
          onConditionsChange={setFieldConditions}
          onLogicChange={setFieldLogic}
          fieldFilterResetSignal={fieldFilterResetSignal}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1 px-2.5 font-medium',
            canResetStockListModule
              ? 'border-primary/55 bg-primary/[0.08] text-primary shadow-sm hover:border-primary hover:bg-primary/15 hover:text-primary'
              : 'border-border bg-muted/50 text-muted-foreground !opacity-100 hover:bg-muted/50 hover:text-muted-foreground',
          )}
          disabled={!canResetStockListModule}
          onClick={resetStockListModule}
          title="恢复为近 3 天、全选股票、清空字段条件（不影响右上角数据集与列配置）"
          aria-label="重置股票列表筛选条件"
        >
          <RotateCcw className="size-3.5 shrink-0" aria-hidden />
          <span className="text-sm">重置</span>
        </Button>
      </div>
      <FieldSelector
        fields={allFields}
        fieldConfigs={fieldConfigs}
        onFieldConfigsChange={onFieldConfigsChange}
      />
    </div>
  );

  if (!serverMode && tableSourceData.length === 0 && !localIdbMode) {
    return (
      <div className="flex flex-col gap-3">
        {toolbarContent}
        <div className="flex items-center justify-center h-64 border border-dashed border-border rounded-xl bg-muted/20">
          <div className="text-center text-muted-foreground">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm leading-relaxed">暂无数据</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {toolbarContent}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {tableBusy ? (
            <div
              className="flex min-h-[min(70vh,680px)] flex-col items-center justify-center py-20 text-muted-foreground"
              aria-busy="true"
            >
              <Loader2
                className="h-8 w-8 shrink-0 animate-spin text-primary"
                aria-hidden
              />
            </div>
          ) : totalCount === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="text-center">
                <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm leading-relaxed">当前筛选条件下无数据</p>
              </div>
            </div>
          ) : useVirtualRows ? (
            <div
              ref={tableScrollRef}
              className="max-h-[min(70vh,680px)] overflow-auto"
            >
              <div className="sticky top-0 z-[1] flex min-w-max border-b-2 border-border bg-muted">
                {visibleFields.map((field) => (
                  <div
                    key={field}
                    className="shrink-0 whitespace-nowrap bg-muted px-3 py-3 text-sm font-semibold leading-snug text-foreground"
                  >
                    {isSortable(field) ? (
                      <button
                        type="button"
                        onClick={() => handleSort(field)}
                        className="inline-flex items-center gap-1 text-sm font-semibold leading-snug text-foreground hover:text-primary transition-colors"
                      >
                        {getFieldDisplayHeader(field)}
                        <SortIcon direction={sortField === field ? sortDirection : null} />
                      </button>
                    ) : (
                      <span className="text-sm font-semibold leading-snug text-foreground">
                        {getFieldDisplayHeader(field)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div
                className="relative min-w-max"
                style={{ height: rowVirtualizer.getTotalSize() }}
              >
                {rowVirtualizer.getVirtualItems().map((vr) => {
                  const row = pagedData[vr.index];
                  if (!row) return null;
                  return (
                    <div
                      key={vr.key}
                      role="row"
                      onClick={() => onRowClick?.(row)}
                      className={`absolute left-0 flex min-w-max border-b bg-background hover:bg-muted/40 ${
                        onRowClick ? "cursor-pointer" : ""
                      }`}
                      style={{
                        transform: `translateY(${vr.start}px)`,
                        height: `${vr.size}px`,
                      }}
                    >
                      {visibleFields.map((field) => {
                        const disp = formatFieldCellDisplay(field, row[field]);
                        return (
                          <div
                            key={field}
                            role="cell"
                            className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-sm leading-snug text-foreground/90 ${disp.className ?? ""}`}
                          >
                            {disp.text}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-2 border-border bg-muted hover:bg-muted">
                    {visibleFields.map((field) => (
                      <TableHead
                        key={field}
                        className="whitespace-nowrap bg-muted py-3 text-sm font-semibold leading-snug text-foreground"
                      >
                        {isSortable(field) ? (
                          <button
                            type="button"
                            onClick={() => handleSort(field)}
                            className="inline-flex items-center gap-1 text-sm font-semibold leading-snug text-foreground hover:text-primary transition-colors"
                          >
                            {getFieldDisplayHeader(field)}
                            <SortIcon direction={sortField === field ? sortDirection : null} />
                          </button>
                        ) : (
                          <span className="text-sm font-semibold leading-snug text-foreground">
                            {getFieldDisplayHeader(field)}
                          </span>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedData.map((row, index) => (
                    <TableRow
                      key={index}
                      onClick={() => onRowClick?.(row)}
                      className={`border-b bg-background hover:bg-muted/40 ${onRowClick ? "cursor-pointer" : ""}`}
                    >
                      {visibleFields.map((field) => {
                        const disp = formatFieldCellDisplay(field, row[field]);
                        return (
                          <TableCell
                            key={field}
                            className={`whitespace-nowrap py-2.5 text-sm leading-snug text-foreground/90 ${disp.className ?? ''}`}
                          >
                            {disp.text}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between px-1 text-sm">
        <span className="text-muted-foreground tabular-nums">
          共 <span className="text-foreground font-medium">{totalCount}</span> 条数据
        </span>
        <div className="flex items-center gap-3">
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => {
                  startTransition(() => setCurrentPage((p) => p - 1));
                }}
                className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {pageButtonsContent}
              <button
                disabled={currentPage === totalPages}
                onClick={() => {
                  startTransition(() => setCurrentPage((p) => p + 1));
                }}
                className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="text-muted-foreground ml-1">
                第 {currentPage}/{totalPages} 页
              </span>
            </div>
          )}
          {totalPages > 1 && <div className="h-4 w-px bg-border" />}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground whitespace-nowrap">每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                startTransition(() => setPageSize(Number(v)));
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-8 w-[5.75rem] shrink-0 border-input bg-background px-2 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}