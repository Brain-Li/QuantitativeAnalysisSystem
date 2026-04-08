import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useDeferredValue,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from 'recharts';
import {
  TrendingUp,
  BarChart3,
  Plus,
  X,
  LineChart as LineChartIcon,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  Trash2,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardTitle } from './ui/card';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { VirtualStockList } from './VirtualStockList';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import {
  DateRangePickerButton,
  type DateRange,
  getLast7DaysRange,
  normalizeDateRangeForApply,
  detectDateField,
} from './DateRangePickerButton';
import type { StockData } from '../types';
import {
  STORAGE_KEY_LEGACY_TREND_DATE,
  STORAGE_KEY_TREND_STATE,
} from '../sessionPersistence';
import { toast } from 'sonner';
import {
  fetchDistinctCodesApi,
  queryMergedRowsApi,
  fetchAllMergedRowsForFilters,
} from '../api/serverApi';
import { streamLocalIdbForDataTable } from '../api/localDatasetIdb';
import { TrendChartTooltip } from './TrendChartTooltip';
import {
  formatDateCell,
  formatMetricValueForChart,
  getFieldDisplayHeader,
  computeTrendYAxisDomain,
  trendYAxisShouldIncludeZero,
  isZhangDieFuField,
  zhangDieFuStyle,
} from '../utils/fieldDisplayFormat';
import { parseToDateStr } from '../utils/tableDataPipeline';

interface StockTrendAnalysisProps {
  data: StockData[];
  allFields: string[];
  /** 与 DataTable 一致：已登录数据服务且选中数据集时按需拉取合并行 */
  serverDatasetIds?: string[];
  /** 未登录：选中项含 IndexedDB 大表时从本地合并加载 */
  localIdbDatasetIds?: string[];
}

type TrendViewMode = 'single' | 'dual';

interface ChartConfig {
  id: string;
  selectedStocks: string[];
  selectedMetrics: string[];
  activeMetric: string;
  chartType: 'line' | 'bar';
  dateFrom: string;
  dateTo: string;
  viewMode: TrendViewMode;
  leftMetric: string;
  rightMetric: string;
  /** 双指标对比：左 / 右轴各自折线或柱状；缺省时在图表内回退为 `chartType` */
  dualLeftSeriesType?: 'line' | 'bar';
  dualRightSeriesType?: 'line' | 'bar';
}

interface StockOption {
  code: string;
  name: string;
}

const CHART_COLORS = ['#155DFC', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

/** 趋势图绘图区高度（px）；单指标 / 双指标共用 */
const TREND_CHART_HEIGHT = 440;

/** 数据标签字号（与下方 SVG text 一致） */
const DATA_LABEL_FONT_PX = 14;
/** 柱图：正值在柱顶上方；负值柱底标签与柱端间距（略大于柱顶，避免贴底） */
const BAR_LABEL_GAP_ABOVE = 12;
const BAR_LABEL_GAP_BELOW = 16;
/** 底部方案：基线以下数字占位 + 横轴刻度带（近似 px） */
const BAR_LABEL_BOTTOM_FOOTPRINT = 32;
/** 负值改柱侧时与柱的水平间距 */
const BAR_LABEL_SIDE_GAP = 6;
/** 侧放时与绘图区左缘保留宽度，避免压纵轴刻度（近似） */
const BAR_LABEL_Y_AXIS_CLEARANCE = 46;
/** 侧放标签估算宽度（短数字，px；用于与纵轴/右缘碰撞判断） */
const BAR_LABEL_SIDE_TEXT_WIDTH = 40;
/** 折线：相对数据点的纵向偏移（外侧，避免压线） */
const LINE_LABEL_DY_ABOVE = -17;
const LINE_LABEL_DY_BELOW = 19;
/** 折线：点过密时抽样展示，减少互相遮挡 */
const LINE_LABEL_DENSE_MIN_ROWS = 36;
const LINE_LABEL_MAX_SHOWN = 24;
/** 折线标签近似绘图区纵向范围（ResponsiveContainer 内扣 margin，用于贴边翻转） */
const LINE_LABEL_APPROX_Y_MAX = 292;

interface TrendPersistV1 {
  v: 1;
  dateRange: DateRange;
  selectedStocks: string[];
  selectedMetrics: string[];
  activeMetric: string;
  chartType: 'line' | 'bar';
  /** 旧版 localStorage 可能无此字段，读取时按 single 处理 */
  viewMode?: TrendViewMode;
  leftMetric?: string;
  rightMetric?: string;
  dualLeftSeriesType?: 'line' | 'bar';
  dualRightSeriesType?: 'line' | 'bar';
  /** 是否在数据点上显示数值标签 */
  showDataLabels?: boolean;
  additionalCharts: ChartConfig[];
}

function isYmdOrEmpty(s: string): boolean {
  if (s === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseChartConfig(x: unknown): ChartConfig | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string') return null;
  if (!Array.isArray(c.selectedStocks) || !Array.isArray(c.selectedMetrics)) return null;
  if (typeof c.activeMetric !== 'string') return null;
  if (c.chartType !== 'line' && c.chartType !== 'bar') return null;
  if (typeof c.dateFrom !== 'string' || typeof c.dateTo !== 'string') return null;
  const selectedStocks = c.selectedStocks.filter((s): s is string => typeof s === 'string');
  const selectedMetrics = c.selectedMetrics.filter((s): s is string => typeof s === 'string');
  const viewMode: TrendViewMode = c.viewMode === 'dual' ? 'dual' : 'single';
  const leftMetric = typeof c.leftMetric === 'string' ? c.leftMetric : '';
  const rightMetric = typeof c.rightMetric === 'string' ? c.rightMetric : '';
  const dualLeftSeriesType = c.dualLeftSeriesType === 'bar' ? 'bar' : c.dualLeftSeriesType === 'line' ? 'line' : undefined;
  const dualRightSeriesType = c.dualRightSeriesType === 'bar' ? 'bar' : c.dualRightSeriesType === 'line' ? 'line' : undefined;
  return {
    id: c.id,
    selectedStocks,
    selectedMetrics,
    activeMetric: c.activeMetric,
    chartType: c.chartType,
    dateFrom: isYmdOrEmpty(c.dateFrom) ? c.dateFrom : '',
    dateTo: isYmdOrEmpty(c.dateTo) ? c.dateTo : '',
    viewMode,
    leftMetric,
    rightMetric,
    ...(dualLeftSeriesType !== undefined ? { dualLeftSeriesType } : {}),
    ...(dualRightSeriesType !== undefined ? { dualRightSeriesType } : {}),
  };
}

function loadTrendPersist(): TrendPersistV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TREND_STATE);
    if (raw) {
      const p = JSON.parse(raw) as unknown;
      if (!p || typeof p !== 'object') return null;
      const o = p as Record<string, unknown>;
      if (o.v !== 1) return null;
      const dr = o.dateRange as DateRange | undefined;
      if (!dr || typeof dr.start !== 'string' || typeof dr.end !== 'string') return null;
      if (!isYmdOrEmpty(dr.start) || !isYmdOrEmpty(dr.end)) return null;
      const selectedStocks = Array.isArray(o.selectedStocks)
        ? o.selectedStocks.filter((s): s is string => typeof s === 'string')
        : [];
      const selectedMetrics = Array.isArray(o.selectedMetrics)
        ? o.selectedMetrics.filter((s): s is string => typeof s === 'string')
        : [];
      const activeMetric = typeof o.activeMetric === 'string' ? o.activeMetric : '';
      const chartType = o.chartType === 'bar' ? 'bar' : 'line';
      const viewMode: TrendViewMode = o.viewMode === 'dual' ? 'dual' : 'single';
      const leftMetric = typeof o.leftMetric === 'string' ? o.leftMetric : '';
      const rightMetric = typeof o.rightMetric === 'string' ? o.rightMetric : '';
      const dualLeftSeriesType =
        o.dualLeftSeriesType === 'bar' ? 'bar' : o.dualLeftSeriesType === 'line' ? 'line' : undefined;
      const dualRightSeriesType =
        o.dualRightSeriesType === 'bar' ? 'bar' : o.dualRightSeriesType === 'line' ? 'line' : undefined;
      const additionalCharts = Array.isArray(o.additionalCharts)
        ? o.additionalCharts.map(parseChartConfig).filter((c): c is ChartConfig => c !== null)
        : [];
      const showDataLabels = o.showDataLabels === true;
      return {
        v: 1,
        dateRange: dr,
        selectedStocks,
        selectedMetrics,
        activeMetric,
        chartType,
        viewMode,
        leftMetric,
        rightMetric,
        ...(dualLeftSeriesType !== undefined ? { dualLeftSeriesType } : {}),
        ...(dualRightSeriesType !== undefined ? { dualRightSeriesType } : {}),
        showDataLabels,
        additionalCharts,
      };
    }
    const legacy = localStorage.getItem(STORAGE_KEY_LEGACY_TREND_DATE);
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      if (parsed && typeof parsed === 'object') {
        const { start, end } = parsed as { start?: string; end?: string };
        if (typeof start === 'string' && typeof end === 'string' && isYmdOrEmpty(start) && isYmdOrEmpty(end)) {
          return {
            v: 1,
            dateRange: { start, end },
            selectedStocks: [],
            selectedMetrics: [],
            activeMetric: '',
            chartType: 'line',
            viewMode: 'single',
            leftMetric: '',
            rightMetric: '',
            showDataLabels: false,
            additionalCharts: [],
          };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getDefaultTrendDateRange(): DateRange {
  return getLast7DaysRange();
}

/** 与股票列表同款 `DateRangePickerButton`；用于对比图卡片的独立日期 */
function StandaloneDateRangePicker({
  dateFrom,
  dateTo,
  onDateChange,
  hasDateField,
}: {
  dateFrom: string;
  dateTo: string;
  onDateChange: (from: string, to: string) => void;
  hasDateField: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(() => ({
    start: dateFrom,
    end: dateTo,
  }));

  useEffect(() => {
    if (open) {
      setTempRange({ start: dateFrom, end: dateTo });
    }
  }, [open, dateFrom, dateTo]);

  const apply = (range?: DateRange) => {
    const n = normalizeDateRangeForApply(range ?? tempRange, {
      emptyToLast7: true,
      emptyDefaultRange: getLast7DaysRange,
    });
    onDateChange(n.start, n.end);
    setOpen(false);
  };

  const clear = () => {
    onDateChange('', '');
    setOpen(false);
  };

  return (
    <DateRangePickerButton
      appliedRange={{ start: dateFrom, end: dateTo }}
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setTempRange({ start: dateFrom, end: dateTo });
      }}
      tempRange={tempRange}
      onTempRangeChange={setTempRange}
      onApply={apply}
      onClear={clear}
      hasDateField={hasDateField}
      hasFilter={!!(dateFrom || dateTo)}
      emptyDefaultRange={getLast7DaysRange}
    />
  );
}

// ─── Custom Stock Selector ─────────────────────────────────────────────────
function StockSelector({
  options,
  selected,
  onChange,
  isSingleSelect = false,
  optionsLoading = false,
}: {
  options: StockOption[];
  selected: string[];
  onChange: (stocks: string[]) => void;
  isSingleSelect?: boolean;
  /** 服务端拉取股票代码列表期间为 true */
  optionsLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!deferredQuery) return options;
    const q = deferredQuery.toLowerCase();
    return options.filter(
      (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [options, deferredQuery]);

  const toggle = (code: string) => {
    if (isSingleSelect) {
      // Single select mode: toggle or set
      if (selected.includes(code)) {
        onChange([]);
      } else {
        onChange([code]);
        setOpen(false); // Auto close on selection
      }
    } else {
      // Multi select mode
      onChange(
        selected.includes(code) ? selected.filter((s) => s !== code) : [...selected, code]
      );
    }
  };

  const buttonLabel = () => {
    if (optionsLoading && options.length === 0) return '加载股票列表…';
    if (selected.length === 0) return '选择股票';
    if (selected.length === 1) {
      const stock = options.find((s) => s.code === selected[0]);
      return stock ? `${stock.code} ${stock.name}` : selected[0];
    }
    return `已选 ${selected.length} 只股票`;
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        className={`gap-2 ${selected.length > 0 ? 'border-primary/50 text-primary' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {optionsLoading && options.length === 0 ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
        <span className="text-sm leading-snug">{buttonLabel()}</span>
        {selected.length > 0 && (
          <span
            className="ml-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
          >
            <X className="w-3 h-3" />
          </span>
        )}
        {open ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-popover border border-border rounded-md shadow-md z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="搜索代码或名称..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 bg-background"
              />
            </div>
          </div>

          {options.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {optionsLoading ? (
                <>
                  <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-40" aria-hidden />
                  <p>正在加载股票列表…</p>
                </>
              ) : (
                <>
                  数据中未识别到股票字段
                  <p className="text-sm mt-1 text-muted-foreground/70">请确认数据包含代码或名称列</p>
                </>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">未找到匹配股票</div>
          ) : (
            <VirtualStockList
              items={filtered}
              selectedSet={selectedSet}
              onToggle={toggle}
              isSingleSelect={isSingleSelect}
              scrollResetKey={query}
            />
          )}

          {/* Footer */}
          {!isSingleSelect && selected.length > 0 && (
            <div className="px-3 py-2 border-t border-border bg-muted/20 flex items-center justify-between">
              <span className="text-sm tabular-nums text-muted-foreground">已选 {selected.length} 项</span>
              <button
                onClick={() => onChange([])}
                className="text-sm text-muted-foreground hover:text-destructive transition-colors"
              >
                清除全部
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Metrics Panel ─────────────────────────────────────────────────────────
function MetricsPanel({
  metrics,
  selected,
  onChange,
}: {
  metrics: string[];
  selected: string[];
  onChange: (metrics: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!expanded) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [expanded]);

  const toggle = (metric: string) => {
    onChange(
      selected.includes(metric) ? selected.filter((m) => m !== metric) : [...selected, metric]
    );
  };

  return (
    <div ref={ref} className="border border-border rounded-lg overflow-hidden">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground leading-snug">选择指标</span>
          {selected.length > 0 && (
            <span className="inline-flex min-w-6 h-6 items-center justify-center px-1 bg-primary text-primary-foreground rounded-full text-sm leading-none tabular-nums">
              {selected.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>{expanded ? '收起' : '展开选择'}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="p-3 border-t border-border bg-white">
          {metrics.length === 0 ? (
            <p className="text-[14px] text-muted-foreground text-center py-3 leading-relaxed">
              未找到数值型指标字段
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {metrics.map((metric) => {
                const isSelected = selected.includes(metric);
                const colorIdx = selected.indexOf(metric);
                return (
                  <div
                    key={metric}
                    onClick={() => toggle(metric)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-all select-none ${
                      isSelected
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-border hover:border-primary/30 hover:bg-muted/30'
                    }`}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors"
                      style={{
                        backgroundColor:
                          isSelected && colorIdx >= 0
                            ? CHART_COLORS[colorIdx % CHART_COLORS.length]
                            : '#d4d4d4',
                      }}
                    />
                    <span
                      className={`text-[14px] leading-snug truncate ${
                        isSelected ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {getFieldDisplayHeader(metric)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Selected metrics preview (when collapsed) */}
      {!expanded && selected.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-white flex flex-wrap gap-1.5">
          {selected.map((metric, idx) => (
            <span
              key={metric}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm text-white"
              style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
            >
              {getFieldDisplayHeader(metric)}
              <button onClick={() => toggle(metric)}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function yDomainIncludesZero(d: [number, number] | undefined): boolean {
  if (!d) return false;
  return d[0] <= 0 && d[1] >= 0;
}

/** 双指标对比：单轴折线 / 柱状切换 */
function DualAxisSeriesTypeToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: 'line' | 'bar';
  onChange: (v: 'line' | 'bar') => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="flex rounded-md border border-border overflow-hidden shrink-0"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => onChange('line')}
        className={`flex items-center justify-center gap-0.5 px-2.5 py-1.5 transition-colors ${
          value === 'line' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'
        }`}
        title="折线图"
      >
        <LineChartIcon className="h-[14px] w-[14px]" />
      </button>
      <button
        type="button"
        onClick={() => onChange('bar')}
        className={`flex items-center justify-center gap-0.5 px-2.5 py-1.5 border-l border-border transition-colors ${
          value === 'bar' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'
        }`}
        title="柱状图"
      >
        <BarChart3 className="h-[14px] w-[14px]" />
      </button>
    </div>
  );
}

type BarLabelOpts = {
  /** 单指标：柱顶水平居中；双指标：略偏左/右减轻并排遮挡 */
  barLabelPriority: 'single' | 'dual';
  dualBarSide?: 'left' | 'right';
  /** 与折线同图时，柱标签略作纵向错开，减轻与折线点标签重叠 */
  composedWithLine?: boolean;
  /** 用于相邻负值柱错开顶/底策略（与 dataKey 成对） */
  rows?: StockData[];
  dataKey?: string;
};

function parseRowMetric(row: StockData | undefined, key: string): number | null {
  if (!row) return null;
  const raw = row[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseLabelNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type BarLabelLayout =
  | { mode: 'above'; cx: number; textY: number }
  | { mode: 'below'; cx: number; textY: number }
  /** 负值：零轴上方（柱顶沿之上），水平居中 */
  | { mode: 'aboveNegative'; cx: number; textY: number }
  /** 负值：柱左侧或右侧，靠近柱底纵向位置 */
  | { mode: 'side'; x: number; textY: number; anchor: 'start' | 'end' };

/** textAnchor=end 时锚点在数字右端，文字向左延伸 */
function sideLabelWouldClipYAxisLeft(
  parentVB: { x: number; y: number; width: number; height: number },
  anchorX: number
): boolean {
  const leftmost = anchorX - BAR_LABEL_SIDE_TEXT_WIDTH;
  return leftmost < parentVB.x + BAR_LABEL_Y_AXIS_CLEARANCE;
}

/** textAnchor=start 时锚点在数字左端，文字向右延伸 */
function sideLabelWouldClipPlotRight(
  parentVB: { x: number; y: number; width: number; height: number },
  anchorX: number
): boolean {
  const rightmost = anchorX + BAR_LABEL_SIDE_TEXT_WIDTH;
  return rightmost > parentVB.x + parentVB.width - 6;
}

/**
 * 负值柱标签：1）底部不与横轴冲突则底居中；2）否则尝试柱侧（双柱仅外侧重叠 Y 轴则顶放）；3）两侧均不可用则顶放。
 */
function computeBarLabelLayout(
  viewBox: { x: number; y: number; width: number; height: number },
  opts: BarLabelOpts,
  numericValue: number,
  props: Record<string, unknown>
): BarLabelLayout {
  const { x, y, width, height } = viewBox;
  const topY = Math.min(y, y + height);
  const bottomY = Math.max(y, y + height);
  const cxBase = x + width / 2;
  let cx = cxBase;
  if (opts.barLabelPriority === 'dual') {
    cx += opts.dualBarSide === 'left' ? -7 : opts.dualBarSide === 'right' ? 7 : 0;
  }

  const indexRaw = props.index;
  const index = typeof indexRaw === 'number' ? indexRaw : Number.parseInt(String(indexRaw ?? 0), 10);

  const barH = Math.abs(height);
  const microY = opts.composedWithLine ? (index % 3) * 2 - 2 : 0;

  if (numericValue >= 0) {
    let textY = topY - BAR_LABEL_GAP_ABOVE + microY;
    if (topY < 20) {
      textY = Math.min(bottomY - 4, topY + Math.max(10, barH * 0.35)) + microY;
    }
    return { mode: 'above', cx, textY };
  }

  const parentVB = props.parentViewBox as
    | { x?: number; y?: number; width?: number; height?: number }
    | undefined;

  let plotBottom: number | undefined;
  if (parentVB && parentVB.y !== undefined && parentVB.height !== undefined) {
    plotBottom = parentVB.y + parentVB.height;
  }

  const bottomBaselineY = bottomY + BAR_LABEL_GAP_BELOW + microY;
  const bottomFitsVertically =
    plotBottom === undefined ||
    bottomBaselineY + BAR_LABEL_BOTTOM_FOOTPRINT <= plotBottom;

  const aboveNegativeY = topY - BAR_LABEL_GAP_ABOVE + microY;

  /** 侧放纵向：靠近柱体下半段，略上移避免贴底 */
  const sideTextY =
    Math.max(
      topY + DATA_LABEL_FONT_PX + 2,
      Math.min(bottomY - 8, topY + Math.max(barH * 0.62, 20)),
    ) + microY;

  const rows = opts.rows;
  const dataKey = opts.dataKey;

  if (bottomFitsVertically) {
    return { mode: 'below', cx, textY: bottomBaselineY };
  }

  if (!parentVB || parentVB.x === undefined || parentVB.width === undefined) {
    return { mode: 'aboveNegative', cx, textY: aboveNegativeY };
  }

  const vbFull = {
    x: parentVB.x,
    y: parentVB.y ?? 0,
    width: parentVB.width,
    height: parentVB.height ?? 0,
  };

  const isDual = opts.barLabelPriority === 'dual';

  const trySideLeft = (): BarLabelLayout | null => {
    const ax = x - BAR_LABEL_SIDE_GAP;
    if (sideLabelWouldClipYAxisLeft(vbFull, ax)) return null;
    return { mode: 'side', x: ax, textY: sideTextY, anchor: 'end' as const };
  };

  const trySideRight = (): BarLabelLayout | null => {
    const ax = x + width + BAR_LABEL_SIDE_GAP;
    if (sideLabelWouldClipPlotRight(vbFull, ax)) return null;
    return { mode: 'side', x: ax, textY: sideTextY, anchor: 'start' as const };
  };

  if (isDual) {
    if (opts.dualBarSide === 'left') {
      const left = trySideLeft();
      if (left) return left;
      return { mode: 'aboveNegative', cx, textY: aboveNegativeY };
    }
    const right = trySideRight();
    if (right) return right;
    return { mode: 'aboveNegative', cx, textY: aboveNegativeY };
  }

  const preferLeftFirst = index % 2 === 0;
  const first = preferLeftFirst ? trySideLeft() : trySideRight();
  if (first) return first;
  const second = preferLeftFirst ? trySideRight() : trySideLeft();
  if (second) return second;

  return { mode: 'aboveNegative', cx, textY: aboveNegativeY };
}

/** 柱状图数据标签（单指标 / 双柱） */
function trendBarLabelContent(metric: string, seriesColor: string, opts: BarLabelOpts) {
  return (props: Record<string, unknown>) => {
    const value = props.value;
    if (value === undefined || value === null) return null;
    const txt = formatMetricValueForChart(metric, value);
    const zf = isZhangDieFuField(metric) ? zhangDieFuStyle(value) : undefined;
    const fill = zf?.color ?? seriesColor;

    const vb = props.viewBox as { x?: number; y?: number; width?: number; height?: number } | undefined;
    if (
      !vb ||
      vb.x === undefined ||
      vb.y === undefined ||
      vb.width === undefined ||
      vb.height === undefined
    ) {
      return null;
    }

    const num = parseLabelNumber(value);
    if (num === null) return null;

    const layout = computeBarLabelLayout(
      { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
      opts,
      num,
      props
    );

    if (layout.mode === 'side') {
      return (
        <text
          x={layout.x}
          y={layout.textY}
          textAnchor={layout.anchor}
          fontSize={DATA_LABEL_FONT_PX}
          fill={fill}
          className="select-none"
          style={{ pointerEvents: 'none' }}
        >
          {txt}
        </text>
      );
    }

    const cx = layout.cx;
    const textY = layout.textY;
    return (
      <text
        x={cx}
        y={textY}
        textAnchor="middle"
        fontSize={DATA_LABEL_FONT_PX}
        fill={fill}
        className="select-none"
        style={{ pointerEvents: 'none' }}
      >
        {txt}
      </text>
    );
  };
}

/**
 * 折线数据标签 PRD：优先在数据点外侧（上/下），避免压线；点过密时抽样；双轴时左右错开减轻重叠。
 */
function trendLineLabelContent(
  metric: string,
  seriesColor: string,
  rows: StockData[],
  dataKey: string,
  opts?: {
    dualSlot?: 'left' | 'right';
    seriesStackIndex?: number;
    /** 与同图柱序列并存时略偏移，减轻与柱标签/柱体重叠 */
    composedWithBar?: boolean;
  }
) {
  return (props: Record<string, unknown>) => {
    const value = props.value;
    if (value === undefined || value === null) return null;
    const txt = formatMetricValueForChart(metric, value);
    const zf = isZhangDieFuField(metric) ? zhangDieFuStyle(value) : undefined;
    const fill = zf?.color ?? seriesColor;

    const x = props.x;
    const y = props.y;
    if (x === undefined || y === undefined) return null;
    const nx = typeof x === 'number' ? x : Number.parseFloat(String(x));
    const ny = typeof y === 'number' ? y : Number.parseFloat(String(y));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;

    const indexRaw = props.index;
    const index = typeof indexRaw === 'number' ? indexRaw : Number.parseInt(String(indexRaw ?? 0), 10);
    const n = rows.length;
    if (n === 0 || index < 0 || index >= n) return null;

    let stride = 1;
    if (n >= LINE_LABEL_DENSE_MIN_ROWS) {
      stride = Math.max(1, Math.ceil(n / LINE_LABEL_MAX_SHOWN));
    }
    if (stride > 1 && index % stride !== 0) return null;

    const v = parseRowMetric(rows[index], dataKey);
    if (v === null) return null;
    const vPrev = parseRowMetric(rows[index > 0 ? index - 1 : index], dataKey);
    const vNext = parseRowMetric(rows[index < n - 1 ? index + 1 : index], dataKey);
    const vp = vPrev ?? v;
    const vn = vNext ?? v;

    let dy: number;
    if (index === 0) {
      dy = v >= vn ? LINE_LABEL_DY_ABOVE : LINE_LABEL_DY_BELOW;
    } else if (index === n - 1) {
      dy = v >= vp ? LINE_LABEL_DY_ABOVE : LINE_LABEL_DY_BELOW;
    } else if (v >= vp && v >= vn) {
      dy = LINE_LABEL_DY_ABOVE;
    } else if (v <= vp && v <= vn) {
      dy = LINE_LABEL_DY_BELOW;
    } else {
      const mid = (vp + vn) / 2;
      dy = v >= mid ? LINE_LABEL_DY_ABOVE : LINE_LABEL_DY_BELOW;
    }

    /** 仍偏密时微错开纵向，减轻相邻点标签互相遮挡 */
    if (stride === 1 && n > 28) {
      dy += ((index % 3) - 1) * 5;
    }

    /** 贴绘图区上下沿时翻转，减轻与图例区/横轴区重叠（近似坐标） */
    if (ny < 22 && dy < 0) dy = LINE_LABEL_DY_BELOW;
    if (ny > LINE_LABEL_APPROX_Y_MAX - 18 && dy > 0) dy = LINE_LABEL_DY_ABOVE;

    let dx = 0;
    if (opts?.dualSlot === 'left') dx = -6;
    if (opts?.dualSlot === 'right') dx = 6;
    if (opts?.seriesStackIndex !== undefined) {
      dx += (opts.seriesStackIndex % 3) * 4 - 4;
    }
    if (stride === 1 && n > 40) {
      dx += ((index % 2) * 2 - 1) * 3;
    }

    if (opts?.composedWithBar) {
      if (dy < 0) dy -= 5;
      else if (dy > 0) dy += 5;
      dx += opts.dualSlot === 'left' ? -3 : opts.dualSlot === 'right' ? 3 : 0;
    }

    return (
      <text
        x={nx + dx}
        y={ny}
        dy={dy}
        textAnchor="middle"
        fontSize={DATA_LABEL_FONT_PX}
        fill={fill}
        className="select-none"
        style={{ pointerEvents: 'none' }}
      >
        {txt}
      </text>
    );
  };
}

// ─── Chart Renderer ────────────────────────────────────────────────────────
function ChartRenderer({
  data,
  metrics,
  type,
  dateField,
  activeMetric,
  onMetricChange,
  viewMode = 'single',
  leftMetric,
  rightMetric,
  dualLeftSeriesType,
  dualRightSeriesType,
  stockCode,
  showDataLabels = false,
}: {
  data: StockData[];
  metrics: string[];
  type: 'line' | 'bar';
  dateField: string;
  activeMetric?: string;
  onMetricChange?: (metric: string) => void;
  viewMode?: TrendViewMode;
  leftMetric?: string;
  rightMetric?: string;
  /** 双指标时左轴序列类型；缺省与 `type` 一致 */
  dualLeftSeriesType?: 'line' | 'bar';
  dualRightSeriesType?: 'line' | 'bar';
  stockCode: string;
  showDataLabels?: boolean;
}) {
  /** 双指标：图例点击切换左/右序列显示（与 Recharts Line/Bar 的 hide 联动） */
  const [dualLegendHidden, setDualLegendHidden] = useState({ left: false, right: false });

  useEffect(() => {
    setDualLegendHidden({ left: false, right: false });
  }, [leftMetric, rightMetric]);

  /** 单指标：按 dataKey（指标字段名）记录图例隐藏 */
  const [singleLegendHidden, setSingleLegendHidden] = useState<Record<string, boolean>>({});

  const formatDate = (value: string | number | Date) => {
    const str = String(value);
    if (str.includes(' ')) return str.split(' ')[0];
    if (str.includes('T')) return str.split('T')[0];
    return str;
  };

  const formattedData = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        [dateField]: formatDate(row[dateField]),
      })),
    [data, dateField]
  );

  const isDual =
    viewMode === 'dual' &&
    !!leftMetric &&
    !!rightMetric &&
    leftMetric !== rightMetric &&
    metrics.includes(leftMetric) &&
    metrics.includes(rightMetric);

  const displayMetrics = activeMetric ? [activeMetric] : metrics;
  const yAxisMetric = displayMetrics[0] ?? metrics[0] ?? '';
  const showMetricTabs =
    !isDual && metrics.length > 1 && activeMetric !== undefined;

  useEffect(() => {
    setSingleLegendHidden({});
  }, [metrics.join(','), activeMetric ?? '', type]);
  const yDomain = useMemo(
    () => (yAxisMetric ? computeTrendYAxisDomain(formattedData, yAxisMetric, stockCode) : undefined),
    [formattedData, yAxisMetric, stockCode]
  );

  const leftDomain = useMemo(
    () =>
      isDual && leftMetric
        ? computeTrendYAxisDomain(formattedData, leftMetric, stockCode)
        : undefined,
    [formattedData, isDual, leftMetric, stockCode]
  );

  const rightDomain = useMemo(
    () =>
      isDual && rightMetric
        ? computeTrendYAxisDomain(formattedData, rightMetric, stockCode)
        : undefined,
    [formattedData, isDual, rightMetric, stockCode]
  );

  const leftColorIdx = isDual && leftMetric ? metrics.indexOf(leftMetric) : 0;
  const rightColorIdx = isDual && rightMetric ? metrics.indexOf(rightMetric) : 1;

  const leftSeriesKind = (dualLeftSeriesType ?? type) as 'line' | 'bar';
  const rightSeriesKind = (dualRightSeriesType ?? type) as 'line' | 'bar';

  if (data.length === 0 || metrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <TrendingUp className="w-10 h-10 opacity-20" />
        <p className="text-[14px] leading-relaxed">暂无符合条件的数据</p>
      </div>
    );
  }

  const commonProps = {
    data: formattedData,
    margin: {
      /* 上边距：为图例与绘图区间留出空隙；双轴左/右标题与刻度需左右留白，避免裁切与重叠 */
      top: isDual ? 64 : showMetricTabs ? 106 : 74,
      right: isDual ? 56 : 16,
      /* 双轴：轴标题用 outside（left/right），需更大 margin，避免与刻度数字重叠 */
      left: isDual ? 72 : 14,
      bottom: 72,
    },
  };

  /** 倾斜日期刻度首尾易贴边裁切，用 padding 与左侧 margin 配合 */
  const axisProps = {
    dataKey: dateField,
    tickFormatter: (v: string | number) => formatDateCell(v),
    tick: { fontSize: 14, fill: '#737373' },
    angle: -40,
    textAnchor: 'end' as const,
    height: 72,
    tickMargin: 8,
    padding: { left: 8, right: 8 } as const,
  };

  const legendWrapperStyle: CSSProperties = {
    fontSize: 14,
    marginTop: -8,
    paddingTop: 0,
    paddingBottom: 16,
  };

  const handleDualLegendClick = (
    data: { dataKey?: unknown },
    _index: number,
    e: MouseEvent
  ) => {
    e.preventDefault();
    const k = data.dataKey;
    if (typeof k !== 'string') return;
    if (k === leftMetric) {
      setDualLegendHidden((s) => ({ ...s, left: !s.left }));
    } else if (k === rightMetric) {
      setDualLegendHidden((s) => ({ ...s, right: !s.right }));
    }
  };

  const handleSingleLegendClick = (
    data: { dataKey?: unknown },
    _index: number,
    e: MouseEvent
  ) => {
    e.preventDefault();
    const k = data.dataKey;
    if (typeof k !== 'string') return;
    if (!displayMetrics.includes(k)) return;
    setSingleLegendHidden((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  if (isDual && leftMetric && rightMetric) {
    return (
      <div className="relative">
        <ResponsiveContainer width="100%" height={TREND_CHART_HEIGHT}>
          <ComposedChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis {...axisProps} />
            <YAxis
              yAxisId="left"
              orientation="left"
              tick={{ fontSize: 14, fill: CHART_COLORS[leftColorIdx % CHART_COLORS.length] }}
              width={72}
              domain={leftDomain ?? ['auto', 'auto']}
              tickFormatter={(v: number) => formatMetricValueForChart(leftMetric, v)}
              label={{
                value: getFieldDisplayHeader(leftMetric),
                angle: -90,
                position: 'left',
                offset: 10,
                style: { fontSize: 14, fill: CHART_COLORS[leftColorIdx % CHART_COLORS.length] },
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 14, fill: CHART_COLORS[rightColorIdx % CHART_COLORS.length] }}
              width={72}
              domain={rightDomain ?? ['auto', 'auto']}
              tickFormatter={(v: number) => formatMetricValueForChart(rightMetric, v)}
              label={{
                value: getFieldDisplayHeader(rightMetric),
                angle: 90,
                position: 'right',
                offset: 10,
                style: { fontSize: 14, fill: CHART_COLORS[rightColorIdx % CHART_COLORS.length] },
              }}
            />
            {leftDomain &&
              leftMetric &&
              trendYAxisShouldIncludeZero(leftMetric) &&
              yDomainIncludesZero(leftDomain) && (
                <ReferenceLine yAxisId="left" y={0} stroke="#d4d4d4" strokeDasharray="3 3" />
              )}
            {rightDomain &&
              rightMetric &&
              trendYAxisShouldIncludeZero(rightMetric) &&
              yDomainIncludesZero(rightDomain) && (
                <ReferenceLine yAxisId="right" y={0} stroke="#d4d4d4" strokeDasharray="3 3" />
              )}
            <Tooltip content={<TrendChartTooltip />} />
            <Legend
              wrapperStyle={{ ...legendWrapperStyle, cursor: 'pointer' }}
              verticalAlign="top"
              align="center"
              iconType="circle"
              iconSize={10}
              onClick={handleDualLegendClick}
            />
            {leftSeriesKind === 'line' ? (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey={leftMetric}
                name={getFieldDisplayHeader(leftMetric)}
                hide={dualLegendHidden.left}
                stroke={CHART_COLORS[leftColorIdx % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{
                  r: 3,
                  fill: CHART_COLORS[leftColorIdx % CHART_COLORS.length],
                  strokeWidth: 0,
                }}
                activeDot={{
                  r: 5,
                  fill: CHART_COLORS[leftColorIdx % CHART_COLORS.length],
                  strokeWidth: 0,
                }}
              >
                {showDataLabels && (
                  <LabelList
                    dataKey={leftMetric}
                    content={trendLineLabelContent(
                      leftMetric,
                      CHART_COLORS[leftColorIdx % CHART_COLORS.length],
                      formattedData,
                      leftMetric,
                      {
                        dualSlot: 'left',
                        composedWithBar: rightSeriesKind === 'bar',
                      }
                    )}
                  />
                )}
              </Line>
            ) : (
              <Bar
                yAxisId="left"
                dataKey={leftMetric}
                name={getFieldDisplayHeader(leftMetric)}
                hide={dualLegendHidden.left}
                fill={CHART_COLORS[leftColorIdx % CHART_COLORS.length]}
                radius={[2, 2, 0, 0]}
                barSize={18}
              >
                {showDataLabels && (
                  <LabelList
                    dataKey={leftMetric}
                    content={trendBarLabelContent(
                      leftMetric,
                      CHART_COLORS[leftColorIdx % CHART_COLORS.length],
                      {
                        barLabelPriority: 'dual',
                        dualBarSide: 'left',
                        composedWithLine: rightSeriesKind === 'line',
                        rows: formattedData,
                        dataKey: leftMetric,
                      }
                    )}
                  />
                )}
              </Bar>
            )}
            {rightSeriesKind === 'line' ? (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={rightMetric}
                name={getFieldDisplayHeader(rightMetric)}
                hide={dualLegendHidden.right}
                stroke={CHART_COLORS[rightColorIdx % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{
                  r: 3,
                  fill: CHART_COLORS[rightColorIdx % CHART_COLORS.length],
                  strokeWidth: 0,
                }}
                activeDot={{
                  r: 5,
                  fill: CHART_COLORS[rightColorIdx % CHART_COLORS.length],
                  strokeWidth: 0,
                }}
              >
                {showDataLabels && (
                  <LabelList
                    dataKey={rightMetric}
                    content={trendLineLabelContent(
                      rightMetric,
                      CHART_COLORS[rightColorIdx % CHART_COLORS.length],
                      formattedData,
                      rightMetric,
                      {
                        dualSlot: 'right',
                        composedWithBar: leftSeriesKind === 'bar',
                      }
                    )}
                  />
                )}
              </Line>
            ) : (
              <Bar
                yAxisId="right"
                dataKey={rightMetric}
                name={getFieldDisplayHeader(rightMetric)}
                hide={dualLegendHidden.right}
                fill={CHART_COLORS[rightColorIdx % CHART_COLORS.length]}
                radius={[2, 2, 0, 0]}
                barSize={18}
              >
                {showDataLabels && (
                  <LabelList
                    dataKey={rightMetric}
                    content={trendBarLabelContent(
                      rightMetric,
                      CHART_COLORS[rightColorIdx % CHART_COLORS.length],
                      {
                        barLabelPriority: 'dual',
                        dualBarSide: 'right',
                        composedWithLine: leftSeriesKind === 'line',
                        rows: formattedData,
                        dataKey: rightMetric,
                      }
                    )}
                  />
                )}
              </Bar>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="relative">
      {showMetricTabs && onMetricChange && (
        <div className="absolute left-14 top-0 z-10 flex flex-wrap gap-1.5 pb-1">
          {metrics.map((metric, idx) => {
            const isActive = metric === activeMetric;
            const color = CHART_COLORS[idx % CHART_COLORS.length];
            return (
              <button
                key={metric}
                onClick={() => onMetricChange(metric)}
                className={`px-3 py-1 rounded-md text-[14px] font-medium transition-all ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted border border-border'
                }`}
                style={isActive ? { backgroundColor: color } : {}}
              >
                {getFieldDisplayHeader(metric)}
              </button>
            );
          })}
        </div>
      )}

      <ResponsiveContainer width="100%" height={TREND_CHART_HEIGHT}>
        {type === 'line' ? (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis {...axisProps} />
            <YAxis
              tick={{ fontSize: 14, fill: '#737373' }}
              width={55}
              domain={yDomain ?? ['auto', 'auto']}
              tickFormatter={(v: number) => formatMetricValueForChart(yAxisMetric, v)}
            />
            {yDomain &&
              trendYAxisShouldIncludeZero(yAxisMetric) &&
              yDomainIncludesZero(yDomain) && (
                <ReferenceLine y={0} stroke="#d4d4d4" strokeDasharray="3 3" />
              )}
            <Tooltip content={<TrendChartTooltip />} />
            <Legend
              wrapperStyle={{ ...legendWrapperStyle, cursor: 'pointer' }}
              verticalAlign="top"
              align="center"
              iconType="circle"
              iconSize={10}
              onClick={handleSingleLegendClick}
            />
            {displayMetrics.map((metric) => {
              const colorIdx = metrics.indexOf(metric);
              const c = CHART_COLORS[colorIdx % CHART_COLORS.length];
              return (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  name={getFieldDisplayHeader(metric)}
                  hide={!!singleLegendHidden[metric]}
                  stroke={c}
                  strokeWidth={2}
                  dot={{ r: 3, fill: c, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: c, strokeWidth: 0 }}
                >
                  {showDataLabels && (
                    <LabelList
                      dataKey={metric}
                      content={trendLineLabelContent(
                        metric,
                        CHART_COLORS[colorIdx % CHART_COLORS.length],
                        formattedData,
                        metric,
                        displayMetrics.length > 1
                          ? { seriesStackIndex: colorIdx }
                          : undefined
                      )}
                    />
                  )}
                </Line>
              );
            })}
          </LineChart>
        ) : (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis {...axisProps} />
            <YAxis
              tick={{ fontSize: 14, fill: '#737373' }}
              width={55}
              domain={yDomain ?? ['auto', 'auto']}
              tickFormatter={(v: number) => formatMetricValueForChart(yAxisMetric, v)}
            />
            {yDomain &&
              trendYAxisShouldIncludeZero(yAxisMetric) &&
              yDomainIncludesZero(yDomain) && (
                <ReferenceLine y={0} stroke="#d4d4d4" strokeDasharray="3 3" />
              )}
            <Tooltip content={<TrendChartTooltip />} />
            <Legend
              wrapperStyle={{ ...legendWrapperStyle, cursor: 'pointer' }}
              verticalAlign="top"
              align="center"
              iconType="circle"
              iconSize={10}
              onClick={handleSingleLegendClick}
            />
            {displayMetrics.map((metric) => {
              const colorIdx = metrics.indexOf(metric);
              return (
                <Bar
                  key={metric}
                  dataKey={metric}
                  name={getFieldDisplayHeader(metric)}
                  hide={!!singleLegendHidden[metric]}
                  fill={CHART_COLORS[colorIdx % CHART_COLORS.length]}
                  radius={[2, 2, 0, 0]}
                >
                  {showDataLabels && (
                    <LabelList
                      dataKey={metric}
                      content={trendBarLabelContent(
                        metric,
                        CHART_COLORS[colorIdx % CHART_COLORS.length],
                        {
                          barLabelPriority: 'single',
                          rows: formattedData,
                          dataKey: metric,
                        }
                      )}
                    />
                  )}
                </Bar>
              );
            })}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export function StockTrendAnalysis({
  data,
  allFields,
  serverDatasetIds,
  localIdbDatasetIds,
}: StockTrendAnalysisProps) {
  const initialTrend = useMemo(() => loadTrendPersist(), []);

  const [dateRange, setDateRange] = useState<DateRange>(
    () => initialTrend?.dateRange ?? getDefaultTrendDateRange()
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(
    () => initialTrend?.dateRange ?? getDefaultTrendDateRange()
  );

  const [selectedStocks, setSelectedStocks] = useState<string[]>(() => [
    ...(initialTrend?.selectedStocks ?? []),
  ]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(() => [
    ...(initialTrend?.selectedMetrics ?? []),
  ]);
  const [activeMetric, setActiveMetric] = useState<string>(initialTrend?.activeMetric ?? '');
  const [chartType, setChartType] = useState<'line' | 'bar'>(initialTrend?.chartType ?? 'line');
  const [viewMode, setViewMode] = useState<TrendViewMode>(() =>
    initialTrend?.viewMode === 'dual' ? 'dual' : 'single'
  );
  const [leftMetric, setLeftMetric] = useState<string>(() => initialTrend?.leftMetric ?? '');
  const [rightMetric, setRightMetric] = useState<string>(() => initialTrend?.rightMetric ?? '');
  const [dualLeftSeriesType, setDualLeftSeriesType] = useState<'line' | 'bar'>(() =>
    initialTrend?.dualLeftSeriesType === 'bar' ? 'bar' : 'line'
  );
  const [dualRightSeriesType, setDualRightSeriesType] = useState<'line' | 'bar'>(() =>
    initialTrend?.dualRightSeriesType === 'bar' ? 'bar' : 'line'
  );
  const [showDataLabels, setShowDataLabels] = useState(
    () => initialTrend?.showDataLabels === true
  );
  const [additionalCharts, setAdditionalCharts] = useState<ChartConfig[]>(initialTrend?.additionalCharts ?? []);

  const [localIdbBuf, setLocalIdbBuf] = useState<StockData[]>([]);
  const [localIdbTrendLoading, setLocalIdbTrendLoading] = useState(false);
  const [localIdbTrendScanOpts, setLocalIdbTrendScanOpts] = useState<StockOption[]>([]);

  useEffect(() => {
    const payload: TrendPersistV1 = {
      v: 1,
      dateRange,
      selectedStocks,
      selectedMetrics,
      activeMetric,
      chartType,
      viewMode,
      leftMetric,
      rightMetric,
      dualLeftSeriesType,
      dualRightSeriesType,
      showDataLabels,
      additionalCharts,
    };
    try {
      localStorage.setItem(STORAGE_KEY_TREND_STATE, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [
    dateRange,
    selectedStocks,
    selectedMetrics,
    activeMetric,
    chartType,
    viewMode,
    leftMetric,
    rightMetric,
    dualLeftSeriesType,
    dualRightSeriesType,
    showDataLabels,
    additionalCharts,
  ]);

  // Update active metric when selected metrics change
  useEffect(() => {
    if (selectedMetrics.length > 0 && !selectedMetrics.includes(activeMetric)) {
      setActiveMetric(selectedMetrics[0]);
    } else if (selectedMetrics.length === 0) {
      setActiveMetric('');
    }
  }, [selectedMetrics, activeMetric]);

  useEffect(() => {
    if (selectedMetrics.length < 2) {
      if (viewMode === 'dual') setViewMode('single');
      return;
    }
    if (viewMode !== 'dual') return;
    const sm = selectedMetrics;
    let L = sm.includes(leftMetric) ? leftMetric : sm[0];
    let R = sm.includes(rightMetric) ? rightMetric : sm[1];
    if (R === L) R = sm.find((m) => m !== L) ?? sm[1];
    if (L !== leftMetric) setLeftMetric(L);
    if (R !== rightMetric) setRightMetric(R);
  }, [selectedMetrics, viewMode, leftMetric, rightMetric]);

  const dateFieldForPicker = useMemo(() => detectDateField(allFields), [allFields]);

  // ── Detect date field
  const dateField = useMemo(() => {
    const found = allFields.find(
      (f) =>
        f.toLowerCase().includes('日期') ||
        f.toLowerCase().includes('date') ||
        f.toLowerCase().includes('时间') ||
        f.toLowerCase().includes('time')
    );
    return found ?? allFields[0] ?? '';
  }, [allFields]);

  const streamStockCols = useMemo(() => {
    const codeKeywords = ['代码', 'code', 'Code', '股票代码'];
    const nameKeywords = ['名称', 'name', 'Name', '股票名称'];
    const code =
      allFields.find((f) => codeKeywords.some((k) => f.includes(k))) ?? null;
    const name =
      allFields.find((f) => nameKeywords.some((k) => f.includes(k))) ?? null;
    return { code, name };
  }, [allFields]);

  const serverMode = Boolean(serverDatasetIds?.length);
  const serverIdsKey = useMemo(
    () => (serverDatasetIds ?? []).join(','),
    [serverDatasetIds],
  );

  const [remoteRows, setRemoteRows] = useState<StockData[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [serverStockOpts, setServerStockOpts] = useState<StockOption[]>([]);
  const [serverStockDistinctLoading, setServerStockDistinctLoading] = useState(false);
  const [sampleRow, setSampleRow] = useState<StockData | null>(null);

  useEffect(() => {
    if (!serverMode || !serverDatasetIds?.length) {
      setServerStockOpts([]);
      setServerStockDistinctLoading(false);
      return;
    }
    setServerStockDistinctLoading(true);
    const ac = new AbortController();
    void fetchDistinctCodesApi(serverDatasetIds, ac.signal)
      .then((opts) => {
        if (ac.signal.aborted) return;
        setServerStockOpts(
          opts
            .map((o) => ({ code: o.code, name: o.name }))
            .sort((a, b) => a.code.localeCompare(b.code, 'zh-CN')),
        );
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setServerStockOpts([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setServerStockDistinctLoading(false);
      });
    return () => ac.abort();
  }, [serverMode, serverIdsKey, serverDatasetIds]);

  useEffect(() => {
    if (!serverMode || !serverDatasetIds?.length) {
      setSampleRow(null);
      return;
    }
    const ac = new AbortController();
    void queryMergedRowsApi(
      { datasetIds: serverDatasetIds, page: 1, pageSize: 1 },
      ac.signal,
    )
      .then((r) => setSampleRow(r.data[0] ?? null))
      .catch(() => setSampleRow(null));
    return () => ac.abort();
  }, [serverMode, serverIdsKey, serverDatasetIds]);

  const trendDateEnvelope = useMemo(() => {
    const candidates: string[] = [];
    if (dateRange.start) candidates.push(dateRange.start);
    if (dateRange.end) candidates.push(dateRange.end);
    additionalCharts.forEach((c) => {
      if (c.dateFrom) candidates.push(c.dateFrom);
      if (c.dateTo) candidates.push(c.dateTo);
    });
    const sorted = candidates.filter(Boolean).sort();
    if (sorted.length === 0) {
      const r = getLast7DaysRange();
      return { start: r.start, end: r.end };
    }
    return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
  }, [dateRange, additionalCharts]);

  const stocksUnion = useMemo(() => {
    const s = new Set<string>();
    selectedStocks.forEach((c) => s.add(c));
    additionalCharts.forEach((ch) => ch.selectedStocks.forEach((c) => s.add(c)));
    return Array.from(s);
  }, [selectedStocks, additionalCharts]);

  const stocksUnionKey = useMemo(() => stocksUnion.join('\u0001'), [stocksUnion]);

  useEffect(() => {
    if (!serverMode || !serverDatasetIds?.length) {
      setRemoteRows([]);
      setTrendLoading(false);
      return;
    }
    if (stocksUnion.length === 0) {
      setRemoteRows([]);
      setTrendLoading(false);
      return;
    }
    const ac = new AbortController();
    setTrendLoading(true);
    void fetchAllMergedRowsForFilters(
      {
        datasetIds: serverDatasetIds,
        dateFrom: trendDateEnvelope.start,
        dateTo: trendDateEnvelope.end,
        codes: stocksUnion,
        sortField: null,
        sortDirection: 'asc',
      },
      ac.signal,
    )
      .then(setRemoteRows)
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof Error && e.name === 'AbortError') return;
        toast.error(e instanceof Error ? e.message : '加载趋势数据失败');
        setRemoteRows([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setTrendLoading(false);
      });
    return () => ac.abort();
  }, [
    serverMode,
    serverIdsKey,
    serverDatasetIds,
    trendDateEnvelope.start,
    trendDateEnvelope.end,
    stocksUnionKey,
  ]);

  const localIdbTrendMode = !serverMode && Boolean(localIdbDatasetIds?.length);
  const localIdbTrendKey = useMemo(
    () => (localIdbDatasetIds ?? []).join(','),
    [localIdbDatasetIds],
  );

  useEffect(() => {
    if (!localIdbTrendMode || !localIdbDatasetIds?.length) {
      setLocalIdbBuf([]);
      setLocalIdbTrendScanOpts([]);
      setLocalIdbTrendLoading(false);
      return;
    }
    if (stocksUnion.length === 0) {
      setLocalIdbBuf([]);
      setLocalIdbTrendScanOpts([]);
      setLocalIdbTrendLoading(false);
      return;
    }
    let cancelled = false;
    setLocalIdbTrendLoading(true);
    void streamLocalIdbForDataTable(localIdbDatasetIds, {
      dateField,
      dateRange: trendDateEnvelope,
      stockCodeField: streamStockCols.code,
      selectedStocks: stocksUnion,
      nameField: streamStockCols.name,
    })
      .then(({ filteredRows, stockOptions: opts }) => {
        if (!cancelled) {
          setLocalIdbBuf(filteredRows);
          setLocalIdbTrendScanOpts(
            opts.map((o) => ({ code: o.code, name: o.name })),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : '加载本地数据失败');
          setLocalIdbBuf([]);
          setLocalIdbTrendScanOpts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLocalIdbTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    localIdbTrendMode,
    localIdbTrendKey,
    localIdbDatasetIds,
    dateField,
    trendDateEnvelope.start,
    trendDateEnvelope.end,
    stocksUnionKey,
    streamStockCols.code,
    streamStockCols.name,
  ]);

  const effectiveData = serverMode
    ? remoteRows
    : localIdbTrendMode
      ? [...data, ...localIdbBuf]
      : data;

  // ── Detect stock identifier field
  const stockFilterField = useMemo(() => {
    const codeField = allFields.find(
      (f) =>
        f.toLowerCase().includes('代码') ||
        f.toLowerCase().includes('code') ||
        f.toLowerCase().includes('symbol')
    );
    const nameField = allFields.find(
      (f) =>
        f.toLowerCase().includes('名称') ||
        f.toLowerCase().includes('name') ||
        f.toLowerCase().includes('stock')
    );
    if (codeField) return codeField;
    if (nameField) return nameField;
    // Fallback: first non-numeric field
    return (
      allFields.find((field) => {
        if (effectiveData.length === 0 && !sampleRow) return false;
        const row = effectiveData[0] ?? sampleRow;
        if (!row) return false;
        const val = row[field];
        return isNaN(Number(val)) && val !== null && val !== '';
      }) ?? allFields[0] ?? ''
    );
  }, [allFields, effectiveData, sampleRow]);

  // ── Detect secondary name field
  const stockNameField = useMemo(() => {
    const nameField = allFields.find(
      (f) =>
        f.toLowerCase().includes('名称') ||
        f.toLowerCase().includes('name') ||
        f.toLowerCase().includes('stock')
    );
    return nameField !== stockFilterField ? nameField : undefined;
  }, [allFields, stockFilterField]);

  // ── Stock options
  const stockOptions = useMemo((): StockOption[] => {
    if (serverMode) return serverStockOpts;
    if (localIdbTrendMode && localIdbTrendScanOpts.length > 0) {
      return localIdbTrendScanOpts;
    }
    if (!stockFilterField) return [];
    const map = new Map<string, StockOption>();
    effectiveData.forEach((row) => {
      const code = String(row[stockFilterField] ?? '');
      const name = stockNameField ? String(row[stockNameField] ?? '') : code;
      if (code && !map.has(code)) {
        map.set(code, { code, name });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [
    serverMode,
    serverStockOpts,
    localIdbTrendMode,
    localIdbTrendScanOpts,
    effectiveData,
    stockFilterField,
    stockNameField,
  ]);

  // ── Metric fields (numeric columns)
  const metricFields = useMemo(() => {
    const first = effectiveData[0] ?? sampleRow;
    if (!first) return [];
    return allFields.filter((f) => {
      const v = first[f];
      return v !== null && v !== '' && !isNaN(Number(v));
    });
  }, [allFields, effectiveData, sampleRow]);

  /** 当前数据集中存在的股票/指标与记忆选择取交集（单股只保留 1 个代码）；股票/数值列列表未就绪时不清空，避免切换模块或首屏拉数期间抹掉 localStorage 记忆 */
  useEffect(() => {
    const stockCodes =
      stockOptions.length === 0 ? null : new Set(stockOptions.map((o) => o.code));
    const metricSet =
      metricFields.length === 0 ? null : new Set(metricFields);

    if (stockCodes !== null) {
      setSelectedStocks((prev) => prev.filter((c) => stockCodes.has(c)).slice(0, 1));
    }
    if (metricSet !== null) {
      setSelectedMetrics((prev) => prev.filter((x) => metricSet.has(x)));
    }
    setAdditionalCharts((prev) =>
      prev.map((chart) => {
        const ss =
          stockCodes === null
            ? chart.selectedStocks
            : chart.selectedStocks.filter((c) => stockCodes.has(c)).slice(0, 1);
        const sm =
          metricSet === null
            ? chart.selectedMetrics
            : chart.selectedMetrics.filter((x) => metricSet.has(x));
        let am = chart.activeMetric;
        if (sm.length > 0 && !sm.includes(am)) am = sm[0];
        else if (sm.length === 0) am = '';
        let vm: TrendViewMode = chart.viewMode ?? 'single';
        if (sm.length < 2) vm = 'single';
        let lm = chart.leftMetric ?? '';
        let rm = chart.rightMetric ?? '';
        if (vm === 'dual' && sm.length >= 2) {
          lm = sm.includes(lm) ? lm : sm[0];
          rm = sm.includes(rm) ? rm : sm[1];
          if (rm === lm) rm = sm.find((m) => m !== lm) ?? sm[1];
        }
        const df = isYmdOrEmpty(chart.dateFrom) ? chart.dateFrom : '';
        const dt = isYmdOrEmpty(chart.dateTo) ? chart.dateTo : '';
        return {
          ...chart,
          selectedStocks: ss,
          selectedMetrics: sm,
          activeMetric: am,
          dateFrom: df,
          dateTo: dt,
          viewMode: vm,
          leftMetric: lm,
          rightMetric: rm,
        };
      })
    );
  }, [stockOptions, metricFields]);

  // ── Filter data for a chart（与 DataTable 一致：先 parseToDateStr 再比 YYYY-MM-DD，避免 "2025-04-08 00:00:00" 与 "2025-04-08" 字符串比较把当日数据滤掉）
  const filterData = (stocks: string[], from: string, to: string) => {
    if (!stockFilterField) return [];
    let rows = effectiveData.filter((row) =>
      stocks.includes(String(row[stockFilterField] ?? '')),
    );
    if (from || to) {
      rows = rows.filter((row) => {
        const ds = parseToDateStr(row[dateField] as string | number | Date | null);
        if (!ds) return true;
        if (from && ds < from) return false;
        if (to && ds > to) return false;
        return true;
      });
    }
    return rows.sort((a, b) => {
      const da = parseToDateStr(a[dateField] as string | number | Date | null);
      const db = parseToDateStr(b[dateField] as string | number | Date | null);
      return (da ?? String(a[dateField] ?? '')).localeCompare(db ?? String(b[dateField] ?? ''));
    });
  };

  const applyDateRange = (range?: DateRange) => {
    const n = normalizeDateRangeForApply(range ?? tempRange, {
      emptyToLast7: true,
      emptyDefaultRange: getLast7DaysRange,
    });
    setDateRange(n);
    setTempRange(n);
    setDatePickerOpen(false);
  };

  const clearDateRange = () => {
    const d = getLast7DaysRange();
    setDateRange(d);
    setTempRange(d);
    setDatePickerOpen(false);
  };

  const trendDateControlsBusy =
    (serverMode && trendLoading && stocksUnion.length > 0) ||
    (localIdbTrendMode && localIdbTrendLoading);

  const mainChartData = useMemo(
    () => filterData(selectedStocks, dateRange.start, dateRange.end),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedStocks,
      dateRange.start,
      dateRange.end,
      effectiveData,
      dateField,
      stockFilterField,
    ],
  );

  // ── Additional charts
  const addChart = () => {
    const metrics = [...selectedMetrics];
    let am = activeMetric;
    if (metrics.length > 0) {
      if (!am || !metrics.includes(am)) am = metrics[0];
    } else {
      am = '';
    }
    const lm = metrics[0] ?? '';
    const rm = metrics[1] ?? '';
    setAdditionalCharts((prev) => [
      ...prev,
      {
        id: `chart_${Date.now()}`,
        selectedStocks: [],
        selectedMetrics: metrics,
        activeMetric: am,
        chartType: 'line',
        dateFrom: dateRange.start,
        dateTo: dateRange.end,
        viewMode: 'single',
        leftMetric: lm,
        rightMetric: rm,
        dualLeftSeriesType: 'line',
        dualRightSeriesType: 'line',
      },
    ]);
  };

  const updateChart = (id: string, patch: Partial<ChartConfig>) => {
    setAdditionalCharts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const removeChart = (id: string) => {
    setAdditionalCharts((prev) => prev.filter((c) => c.id !== id));
  };

  const mainChartReady = selectedStocks.length > 0 && selectedMetrics.length > 0;

  return (
    <div className="space-y-5">
      {/* ── 主趋势图：筛选 + 图表同卡（与对比图卡片结构一致） ───────────────── */}
      <Card>
        <CardContent className="space-y-5 px-6 pb-6 pt-6">
          {/* 时间范围 + 股票（单指标 / 双指标对比共用） */}
          <div className="flex flex-wrap items-center gap-2">
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
              hasDateField={!!dateFieldForPicker}
              hasFilter={!!(dateRange.start || dateRange.end)}
              busy={trendDateControlsBusy}
              emptyDefaultRange={getLast7DaysRange}
            />
            <StockSelector
              options={stockOptions}
              selected={selectedStocks}
              onChange={setSelectedStocks}
              isSingleSelect={true}
              optionsLoading={serverMode && serverStockDistinctLoading}
            />
          </div>
          <MetricsPanel
            metrics={metricFields}
            selected={selectedMetrics}
            onChange={setSelectedMetrics}
          />

          {mainChartReady && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div>
                  <CardTitle className="text-[14px] font-semibold leading-snug text-foreground">
                    {selectedStocks.map((code) => {
                      const stock = stockOptions.find((s) => s.code === code);
                      return stock ? `${stock.code} ${stock.name}` : code;
                    }).join(' · ')}
                  </CardTitle>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {selectedMetrics.length >= 2 && (
                    <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => setViewMode('single')}
                        className={`px-3 py-1.5 text-[14px] transition-colors ${
                          viewMode === 'single'
                            ? 'bg-primary text-white'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        单指标
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setViewMode('dual');
                          setLeftMetric(selectedMetrics[0]);
                          setRightMetric(selectedMetrics[1]);
                          setDualLeftSeriesType(chartType);
                          setDualRightSeriesType(chartType);
                        }}
                        className={`border-l border-border px-3 py-1.5 text-[14px] transition-colors ${
                          viewMode === 'dual'
                            ? 'bg-primary text-white'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        双指标对比
                      </button>
                    </div>
                  )}
                  {viewMode !== 'dual' && (
                    <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => setChartType('line')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-[14px] transition-colors ${
                          chartType === 'line'
                            ? 'bg-primary text-white'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <LineChartIcon className="h-3.5 w-3.5" />
                        折线
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartType('bar')}
                        className={`flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-[14px] transition-colors ${
                          chartType === 'bar'
                            ? 'bg-primary text-white'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                        柱状
                      </button>
                    </div>
                  )}
                  <div className="ml-0.5 flex shrink-0 items-center gap-2 border-l border-border pl-2">
                    <Label
                      htmlFor="trend-chart-data-labels-main"
                      className="cursor-pointer whitespace-nowrap text-[14px] font-normal text-muted-foreground"
                    >
                      数据标签
                    </Label>
                    <Switch
                      id="trend-chart-data-labels-main"
                      checked={showDataLabels}
                      onCheckedChange={setShowDataLabels}
                    />
                  </div>
                </div>
              </div>
              {selectedMetrics.length >= 2 && viewMode === 'dual' && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                  <span className="shrink-0 text-sm text-muted-foreground">左 Y 轴</span>
                  <Select
                    value={leftMetric}
                    onValueChange={(v) => {
                      setLeftMetric(v);
                      if (v === rightMetric) {
                        const alt = selectedMetrics.find((m) => m !== v);
                        if (alt) setRightMetric(alt);
                      }
                    }}
                  >
                    <SelectTrigger className="min-w-[120px] max-w-[220px] border-border text-[14px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {selectedMetrics.map((m) => (
                        <SelectItem key={m} value={m}>
                          {getFieldDisplayHeader(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <DualAxisSeriesTypeToggle
                    value={dualLeftSeriesType}
                    onChange={setDualLeftSeriesType}
                    ariaLabel="左轴图表类型"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">右 Y 轴</span>
                  <Select
                    value={rightMetric}
                    onValueChange={(v) => {
                      setRightMetric(v);
                      if (v === leftMetric) {
                        const alt = selectedMetrics.find((m) => m !== v);
                        if (alt) setLeftMetric(alt);
                      }
                    }}
                  >
                    <SelectTrigger className="min-w-[120px] max-w-[220px] border-border text-[14px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {selectedMetrics.map((m) => (
                        <SelectItem key={m} value={m}>
                          {getFieldDisplayHeader(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <DualAxisSeriesTypeToggle
                    value={dualRightSeriesType}
                    onChange={setDualRightSeriesType}
                    ariaLabel="右轴图表类型"
                  />
                </div>
              )}
            </div>
          )}

          {mainChartReady && (
            <ChartRenderer
              data={mainChartData}
              metrics={selectedMetrics}
              type={chartType}
              dateField={dateField}
              activeMetric={activeMetric}
              onMetricChange={setActiveMetric}
              viewMode={viewMode}
              leftMetric={leftMetric}
              rightMetric={rightMetric}
              dualLeftSeriesType={viewMode === 'dual' ? dualLeftSeriesType : undefined}
              dualRightSeriesType={viewMode === 'dual' ? dualRightSeriesType : undefined}
              stockCode={selectedStocks[0] ?? ''}
              showDataLabels={showDataLabels}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Additional Charts ────────────────────────────────────────── */}
      {additionalCharts.map((chart, idx) => {
        const chartData = filterData(chart.selectedStocks, chart.dateFrom, chart.dateTo);

        return (
          <Card key={chart.id}>
            <CardContent className="space-y-5 px-6 pb-6 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <StandaloneDateRangePicker
                    dateFrom={chart.dateFrom}
                    dateTo={chart.dateTo}
                    onDateChange={(from, to) => updateChart(chart.id, { dateFrom: from, dateTo: to })}
                    hasDateField={!!dateFieldForPicker}
                  />
                  <StockSelector
                    options={stockOptions}
                    selected={chart.selectedStocks}
                    onChange={(stocks) => updateChart(chart.id, { selectedStocks: stocks })}
                    isSingleSelect={true}
                    optionsLoading={serverMode && serverStockDistinctLoading}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeChart(chart.id)}
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  title="删除对比图表"
                  aria-label="删除对比图表"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <MetricsPanel
                metrics={metricFields}
                selected={chart.selectedMetrics}
                onChange={(metrics) => {
                  const patch: Partial<ChartConfig> = { selectedMetrics: metrics };
                  if (metrics.length > 0 && !metrics.includes(chart.activeMetric)) {
                    patch.activeMetric = metrics[0];
                  } else if (metrics.length === 0) {
                    patch.activeMetric = '';
                  }
                  if (metrics.length < 2) {
                    patch.viewMode = 'single';
                  } else if ((chart.viewMode ?? 'single') === 'dual') {
                    const sm = metrics;
                    let lm = chart.leftMetric ?? '';
                    let rm = chart.rightMetric ?? '';
                    lm = sm.includes(lm) ? lm : sm[0];
                    rm = sm.includes(rm) ? rm : sm[1];
                    if (rm === lm) rm = sm.find((m) => m !== lm) ?? sm[1];
                    patch.leftMetric = lm;
                    patch.rightMetric = rm;
                  }
                  updateChart(chart.id, patch);
                }}
              />

              {chart.selectedStocks.length > 0 && chart.selectedMetrics.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <CardTitle className="text-[14px] font-semibold leading-snug text-foreground">
                      {chart.selectedStocks.map((code) => {
                        const stock = stockOptions.find((s) => s.code === code);
                        return stock ? `${stock.code} ${stock.name}` : code;
                      }).join(' · ')}
                    </CardTitle>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {chart.selectedMetrics.length >= 2 && (
                        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                          <button
                            type="button"
                            onClick={() => updateChart(chart.id, { viewMode: 'single' })}
                            className={`px-3 py-1.5 text-[14px] transition-colors ${
                              (chart.viewMode ?? 'single') === 'single'
                                ? 'bg-primary text-white'
                                : 'text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            单指标
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateChart(chart.id, {
                                viewMode: 'dual',
                                leftMetric: chart.selectedMetrics[0],
                                rightMetric: chart.selectedMetrics[1],
                                dualLeftSeriesType: chart.chartType,
                                dualRightSeriesType: chart.chartType,
                              })
                            }
                            className={`border-l border-border px-3 py-1.5 text-[14px] transition-colors ${
                              chart.viewMode === 'dual'
                                ? 'bg-primary text-white'
                                : 'text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            双指标对比
                          </button>
                        </div>
                      )}
                      {(chart.viewMode ?? 'single') !== 'dual' && (
                        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                          <button
                            type="button"
                            onClick={() => updateChart(chart.id, { chartType: 'line' })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[14px] transition-colors ${
                              chart.chartType === 'line'
                                ? 'bg-primary text-white'
                                : 'text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            <LineChartIcon className="h-3.5 w-3.5" />
                            折线
                          </button>
                          <button
                            type="button"
                            onClick={() => updateChart(chart.id, { chartType: 'bar' })}
                            className={`flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-[14px] transition-colors ${
                              chart.chartType === 'bar'
                                ? 'bg-primary text-white'
                                : 'text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            <BarChart3 className="h-3.5 w-3.5 shrink-0" />
                            柱状
                          </button>
                        </div>
                      )}
                      <div className="ml-0.5 flex shrink-0 items-center gap-2 border-l border-border pl-2">
                        <Label
                          htmlFor={`trend-chart-data-labels-${chart.id}`}
                          className="cursor-pointer whitespace-nowrap text-[14px] font-normal text-muted-foreground"
                        >
                          数据标签
                        </Label>
                        <Switch
                          id={`trend-chart-data-labels-${chart.id}`}
                          checked={showDataLabels}
                          onCheckedChange={setShowDataLabels}
                        />
                      </div>
                    </div>
                  </div>
                  {chart.selectedMetrics.length >= 2 && chart.viewMode === 'dual' && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                      <span className="shrink-0 text-sm text-muted-foreground">左 Y 轴</span>
                      <Select
                        value={chart.leftMetric ?? chart.selectedMetrics[0]!}
                        onValueChange={(v) => {
                          const rm = chart.rightMetric ?? '';
                          const patch: Partial<ChartConfig> = { leftMetric: v };
                          if (v === rm) {
                            const alt = chart.selectedMetrics.find((m) => m !== v);
                            if (alt) patch.rightMetric = alt;
                          }
                          updateChart(chart.id, patch);
                        }}
                      >
                        <SelectTrigger className="min-w-[120px] max-w-[220px] border-border text-[14px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={4}>
                          {chart.selectedMetrics.map((m) => (
                            <SelectItem key={m} value={m}>
                              {getFieldDisplayHeader(m)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <DualAxisSeriesTypeToggle
                        value={chart.dualLeftSeriesType ?? chart.chartType}
                        onChange={(v) => updateChart(chart.id, { dualLeftSeriesType: v })}
                        ariaLabel="对比图左轴图表类型"
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">右 Y 轴</span>
                      <Select
                        value={chart.rightMetric ?? chart.selectedMetrics[1]!}
                        onValueChange={(v) => {
                          const lm = chart.leftMetric ?? '';
                          const patch: Partial<ChartConfig> = { rightMetric: v };
                          if (v === lm) {
                            const alt = chart.selectedMetrics.find((m) => m !== v);
                            if (alt) patch.leftMetric = alt;
                          }
                          updateChart(chart.id, patch);
                        }}
                      >
                        <SelectTrigger className="min-w-[120px] max-w-[220px] border-border text-[14px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={4}>
                          {chart.selectedMetrics.map((m) => (
                            <SelectItem key={m} value={m}>
                              {getFieldDisplayHeader(m)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <DualAxisSeriesTypeToggle
                        value={chart.dualRightSeriesType ?? chart.chartType}
                        onChange={(v) => updateChart(chart.id, { dualRightSeriesType: v })}
                        ariaLabel="对比图右轴图表类型"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="pt-2">
                  <CardTitle className="text-[14px] font-semibold leading-snug text-foreground">
                    {chart.selectedStocks.length > 0
                      ? chart.selectedStocks.map((code) => {
                          const stock = stockOptions.find((s) => s.code === code);
                          return stock ? `${stock.code} ${stock.name}` : code;
                        }).join(' · ')
                      : `对比图表 ${idx + 1}`}
                  </CardTitle>
                </div>
              )}

              {chart.selectedStocks.length > 0 && chart.selectedMetrics.length > 0 && (
                <ChartRenderer
                  data={chartData}
                  metrics={chart.selectedMetrics}
                  type={chart.chartType}
                  dateField={dateField}
                  activeMetric={chart.activeMetric}
                  onMetricChange={(metric) => updateChart(chart.id, { activeMetric: metric })}
                  viewMode={chart.viewMode ?? 'single'}
                  leftMetric={chart.leftMetric ?? ''}
                  rightMetric={chart.rightMetric ?? ''}
                  dualLeftSeriesType={
                    (chart.viewMode ?? 'single') === 'dual'
                      ? chart.dualLeftSeriesType ?? chart.chartType
                      : undefined
                  }
                  dualRightSeriesType={
                    (chart.viewMode ?? 'single') === 'dual'
                      ? chart.dualRightSeriesType ?? chart.chartType
                      : undefined
                  }
                  stockCode={chart.selectedStocks[0] ?? ''}
                  showDataLabels={showDataLabels}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* ── Add Chart Button ─────────────────────────────────────────── */}
      {selectedStocks.length > 0 && selectedMetrics.length > 0 && (
        <div className="flex justify-center">
          <button
            onClick={addChart}
            className="flex items-center gap-2 px-5 py-2.5 border-2 border-dashed border-border rounded-xl text-[14px] text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all leading-snug"
          >
            <Plus className="w-4 h-4" />
            添加对比图表
          </button>
        </div>
      )}
    </div>
  );
}