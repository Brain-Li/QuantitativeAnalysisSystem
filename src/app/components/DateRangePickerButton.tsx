import { useEffect, useMemo, useRef } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { DateRangeCalendarField } from './DateRangeCalendarField';
import { cn } from './ui/utils';

export interface DateRange {
  start: string;
  end: string;
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function addDaysYmd(ymd: string, delta: number): string {
  const dt = parseYmd(ymd);
  if (!dt) return ymd;
  dt.setDate(dt.getDate() + delta);
  return formatDate(dt);
}

const MAX_SPAN_DAYS = 365;

/** 禁止未来日、起止顺序、最大约 1 年；双空时可用 emptyDefaultRange（默认近 7 天） */
export function normalizeDateRangeForApply(
  range: DateRange,
  opts?: {
    emptyToLast7?: boolean;
    silent?: boolean;
    /** 双空且需默认区间时调用；不传则使用近 7 天 */
    emptyDefaultRange?: () => DateRange;
  },
): DateRange {
  const today = formatDate(new Date());
  let { start, end } = range;
  const emptyToLast7 = opts?.emptyToLast7 !== false;
  const silent = opts?.silent === true;

  if (!start?.trim() && !end?.trim()) {
    if (emptyToLast7) return opts?.emptyDefaultRange?.() ?? getLast7DaysRange();
    return { start: '', end: '' };
  }

  start = start.trim();
  end = end.trim();
  if (!start && end) start = end;
  if (!end && start) end = start;

  if (start && start > today) start = today;
  if (end && end > today) end = today;

  if (start && end && start > end) {
    if (!silent) toast.info('开始日期不能晚于结束日期，已自动交换');
    [start, end] = [end, start];
  }

  if (start && end) {
    const ds = parseYmd(start);
    const de = parseYmd(end);
    if (ds && de) {
      const span = Math.round((de.getTime() - ds.getTime()) / 86400000);
      if (span > MAX_SPAN_DAYS) {
        if (!silent) toast.info('时间范围较大，数据加载可能稍慢', { duration: 4000 });
        end = addDaysYmd(start, MAX_SPAN_DAYS);
        if (end > today) end = today;
      }
    }
  }

  return { start, end };
}

export function getTodayDateRange(): DateRange {
  const t = formatDate(new Date());
  return { start: t, end: t };
}

export function getYesterdayRange(): DateRange {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = formatDate(d);
  return { start: y, end: y };
}

/** 近 3 天（含今日共 3 个自然日）— 股票列表默认 */
export function getLast3DaysRange(): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 2);
  return { start: formatDate(start), end: formatDate(end) };
}

/** 近 7 天（含今日共 7 个自然日）— 趋势分析默认 */
export function getLast7DaysRange(): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return { start: formatDate(start), end: formatDate(end) };
}

/** 本月 1 日至今日或月末（不选未来日） */
export function getThisMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endD = lastDay > now ? now : lastDay;
  return { start: formatDate(start), end: formatDate(endD) };
}

/** 与股票列表、趋势分析、对比图弹层共用 */
export const DATE_SHORTCUTS = [
  { label: '今日', getRange: (): DateRange => getTodayDateRange() },
  { label: '昨日', getRange: (): DateRange => getYesterdayRange() },
  { label: '近 7 天', getRange: (): DateRange => getLast7DaysRange() },
  {
    label: '近 30 天',
    getRange: (): DateRange => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      return { start: formatDate(start), end: formatDate(end) };
    },
  },
  {
    label: '近 90 天',
    getRange: (): DateRange => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 89);
      return { start: formatDate(start), end: formatDate(end) };
    },
  },
  { label: '本月', getRange: getThisMonthRange },
];

export function detectDateField(fields: string[]): string | null {
  const keywords = ['日期', '时间', 'date', 'Date', 'time', 'Time', '交易日'];
  return fields.find((f) => keywords.some((k) => f.includes(k))) ?? null;
}

/** 筛选条上回显：起止日期用「~」连接；无有效区间时为「选择时间」 */
export function formatRangeLabel(range: DateRange): string {
  const s = range.start?.trim() ?? '';
  const e = range.end?.trim() ?? '';
  if (!s && !e) return '选择时间';
  if (!s && e) return e;
  if (s && !e) return s;
  if (s === e) return s;
  return `${s} ~ ${e}`;
}

export interface DateRangePickerButtonProps {
  /** 已确定的时间范围（用于触发条回显；弹层打开时与 temp 对比展示预览） */
  appliedRange: DateRange;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tempRange: DateRange;
  onTempRangeChange: (range: DateRange) => void;
  onApply: (range?: DateRange) => void;
  onClear: () => void;
  hasDateField: boolean;
  hasFilter: boolean;
  /** 拉数中：禁止打开/修改，避免重复提交 */
  busy?: boolean;
  /** 日期双空时「确定」回退的默认区间（股票列表用近 3 天，趋势用近 7 天等） */
  emptyDefaultRange?: () => DateRange;
}

/**
 * 顶部触发条回显区间 + 弹层内左侧快捷、右侧双月历（起止在日历与快捷中设置，不在弹层重复占一行输入框）。
 */
export function DateRangePickerButton({
  appliedRange,
  open,
  onOpenChange,
  tempRange,
  onTempRangeChange,
  onApply,
  onClear,
  hasDateField,
  hasFilter,
  busy = false,
  emptyDefaultRange,
}: DateRangePickerButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const triggerText = useMemo(() => {
    const r = open ? tempRange : appliedRange;
    return formatRangeLabel(r);
  }, [open, tempRange, appliedRange]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onOpenChange]);

  const handleApply = () => {
    const n = normalizeDateRangeForApply(tempRange, {
      emptyToLast7: true,
      emptyDefaultRange: emptyDefaultRange ?? getLast7DaysRange,
    });
    onTempRangeChange(n);
    onApply(n);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        className={cn(
          'h-9 min-w-[min(100%,16rem)] max-w-[min(100%,28rem)] gap-2 px-3',
          hasFilter ? 'border-primary/50 text-primary' : 'border-input',
        )}
        title={hasDateField ? undefined : '未检测到日期字段，日期筛选不可用'}
        onClick={() => !busy && onOpenChange(!open)}
      >
        <CalendarDays
          className={cn('h-4 w-4 shrink-0', hasFilter ? 'text-primary' : 'text-muted-foreground')}
          aria-hidden
        />
        <span className="truncate text-[14px] leading-snug tabular-nums">{triggerText}</span>
        {hasFilter && (
          <span
            className="ml-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </Button>

      {open && !busy && (
        <div className="absolute left-0 top-full z-50 mt-1 w-max max-w-[min(40rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover p-0 shadow-lg">
          <div className="flex w-max max-w-full flex-col sm:flex-row sm:items-stretch">
            <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/25 px-2 py-3 sm:w-[6.75rem] sm:border-b-0 sm:border-r sm:border-border">
              {DATE_SHORTCUTS.map((shortcut) => {
                const r = shortcut.getRange();
                const isActive = tempRange.start === r.start && tempRange.end === r.end;
                return (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => onTempRangeChange(shortcut.getRange())}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-[14px] font-normal leading-snug transition-colors',
                      isActive
                        ? 'bg-primary font-medium text-primary-foreground shadow-sm'
                        : 'text-foreground/85 hover:bg-background hover:text-foreground hover:shadow-sm',
                    )}
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>

            <div className="flex w-fit min-w-0 shrink flex-col p-3">
              <DateRangeCalendarField
                start={tempRange.start}
                end={tempRange.end}
                numberOfMonths={2}
                onChange={(start, end) => onTempRangeChange({ start, end })}
              />
            </div>
          </div>

          {!hasDateField && (
            <div className="border-t border-border px-3 py-2">
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-sm leading-snug text-amber-800">
                未检测到日期字段，筛选可能无效
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
            <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={onClear}>
              清除
            </Button>
            <Button size="sm" className="h-8 text-sm" onClick={handleApply}>
              确定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
