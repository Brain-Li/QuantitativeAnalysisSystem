import { useMemo, useState, useEffect } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './ui/table';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { FieldSelector } from './FieldSelector';
import { StockFilter } from './StockFilter';
import {
  DateRangePickerButton,
  type DateRange,
  formatDate,
  getTodayDateRange,
  detectDateField,
} from './DateRangePickerButton';
import {
  Database, CalendarDays, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { StockData, FieldConfig } from '../types';
import { formatFieldCellDisplay, getFieldDisplayHeader } from '../utils/fieldDisplayFormat';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const STORAGE_KEY_DATE_RANGE = 'datatable_date_range_v3';
const STORAGE_KEY_SELECTED_STOCKS = 'datatable_selected_stocks_v3';

function isYmdOrEmpty(s: string): boolean {
  if (s === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function loadDateRangeFromStorage(): DateRange | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATE_RANGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { start, end } = parsed as { start?: unknown; end?: unknown };
    if (typeof start !== 'string' || typeof end !== 'string') return null;
    if (!isYmdOrEmpty(start) || !isYmdOrEmpty(end)) return null;
    return { start, end };
  } catch {
    return null;
  }
}

function loadSelectedStocksFromStorage(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_STOCKS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const codes = parsed.filter((x): x is string => typeof x === 'string');
    return codes;
  } catch {
    return null;
  }
}

interface DataTableProps {
  data: StockData[];
  fieldConfigs: FieldConfig[];
  allFields: string[];
  onFieldConfigsChange: (configs: FieldConfig[]) => void;
  onRowClick?: (row: StockData) => void;
}

type SortDirection = 'asc' | 'desc' | null;

function parseToDateStr(value: string | number | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return formatDate(value);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
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
}: DataTableProps) {
  /** 切换菜单后恢复上次日期；无记录时默认今日 */
  const [dateRange, setDateRange] = useState<DateRange>(
    () => loadDateRangeFromStorage() ?? getTodayDateRange()
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(
    () => loadDateRangeFromStorage() ?? getTodayDateRange()
  );

  /** 从 localStorage 恢复；与当前数据集的代码取交集，若无交集则默认全选 */
  const [selectedStocks, setSelectedStocks] = useState<string[]>(
    () => loadSelectedStocksFromStorage() ?? []
  );

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const dateField = useMemo(() => detectDateField(allFields), [allFields]);
  const stockFields = useMemo(() => detectStockFields(allFields), [allFields]);

  // Extract stock options
  const stockOptions = useMemo(() => {
    const { code, name } = stockFields;
    if (!code) return [];
    
    const seen = new Set<string>();
    const options: { code: string; name: string }[] = [];
    
    data.forEach((row) => {
      const stockCode = row[code] ? String(row[code]) : '';
      if (stockCode && !seen.has(stockCode)) {
        seen.add(stockCode);
        const stockName = name && row[name] ? String(row[name]) : stockCode;
        options.push({ code: stockCode, name: stockName });
      }
    });
    
    return options.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'));
  }, [data, stockFields]);

  const visibleFields = useMemo(() => {
    return fieldConfigs
      .filter((c) => c.visible)
      .sort((a, b) => a.order - b.order)
      .map((c) => c.name);
  }, [fieldConfigs]);

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
    if (stockOptions.length === 0) {
      setSelectedStocks([]);
      return;
    }
    setSelectedStocks((prev) => {
      const codes = new Set(stockOptions.map((o) => o.code));
      const filtered = prev.filter((c) => codes.has(c));
      if (filtered.length > 0) return filtered;
      return stockOptions.map((o) => o.code);
    });
  }, [stockOptions]);

  const dateFilteredData = useMemo(() => {
    if (!dateField || (!dateRange.start && !dateRange.end)) return data;
    return data.filter((row) => {
      const raw = row[dateField];
      const ds = parseToDateStr(raw as string | number | Date | null);
      if (!ds) return true;
      if (dateRange.start && ds < dateRange.start) return false;
      if (dateRange.end && ds > dateRange.end) return false;
      return true;
    });
  }, [data, dateField, dateRange]);

  const stockFilteredData = useMemo(() => {
    if (!stockFields.code || selectedStocks.length === 0) return dateFilteredData;
    return dateFilteredData.filter((row) => {
      const stockCode = row[stockFields.code!] ? String(row[stockFields.code!]) : '';
      return selectedStocks.includes(stockCode);
    });
  }, [dateFilteredData, stockFields, selectedStocks]);

  const isSortable = (field: string) => {
    const nonSortable = ['_empty', '代码', '名称'];
    return !nonSortable.includes(field);
  };

  const sortedData = useMemo(() => {
    if (!sortField || !sortDirection) return stockFilteredData;
    return [...stockFilteredData].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const an = Number(av), bn = Number(bv);
      if (!isNaN(an) && !isNaN(bn)) return sortDirection === 'asc' ? an - bn : bn - an;
      const cmp = String(av).localeCompare(String(bv), 'zh-CN');
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [stockFilteredData, sortField, sortDirection]);

  const totalCount = sortedData.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [data, dateRange, selectedStocks, sortField, sortDirection, pageSize]);

  const pagedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (field: string) => {
    if (!isSortable(field)) return;
    if (sortField === field) {
      if (sortDirection === null) setSortDirection('asc');
      else if (sortDirection === 'asc') setSortDirection('desc');
      else { setSortDirection(null); setSortField(null); }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const dateRangeLabel = () => {
    if (!dateRange.start && !dateRange.end) return '选择时间';
    if (dateRange.start === dateRange.end) return dateRange.start || '选择时间';
    return `${dateRange.start || '—'} 至 ${dateRange.end || '—'}`;
  };

  const applyDateRange = (range?: DateRange) => {
    let { start, end } = range ?? tempRange;
    if (start && end && start > end) [start, end] = [end, start];
    setDateRange({ start, end });
    setDatePickerOpen(false);
  };

  const clearDateRange = () => {
    setDateRange({ start: '', end: '' });
    setTempRange({ start: '', end: '' });
    setDatePickerOpen(false);
  };

  const renderPageButtons = () => {
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
          onClick={() => setCurrentPage(p as number)}
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
  };

  const toolbarContent = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <DateRangePickerButton
          label={dateRangeLabel()}
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
        />
        <StockFilter
          options={stockOptions}
          selected={selectedStocks}
          onChange={setSelectedStocks}
        />
      </div>
      <FieldSelector
        fields={allFields}
        fieldConfigs={fieldConfigs}
        onFieldConfigsChange={onFieldConfigsChange}
      />
    </div>
  );

  if (data.length === 0) {
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
          {totalCount === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="text-center">
                <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm leading-relaxed">当前筛选条件下无数据</p>
                <button
                  className="mt-2 text-[13px] text-primary hover:underline"
                  onClick={() => {
                    clearDateRange();
                    setSelectedStocks([]);
                  }}
                >
                  清除筛选条件
                </button>
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
                onClick={() => setCurrentPage((p) => p - 1)}
                className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {renderPageButtons()}
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
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
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size} 条</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}