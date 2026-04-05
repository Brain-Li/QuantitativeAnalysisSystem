import { useEffect, useRef } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Button } from './ui/button';
import { DateRangeCalendarField } from './DateRangeCalendarField';

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

export function getTodayDateRange(): DateRange {
  const t = formatDate(new Date());
  return { start: t, end: t };
}

/** 趋势分析默认：近 7 天（含今日共 7 个自然日） */
export function getLast7DaysRange(): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return { start: formatDate(start), end: formatDate(end) };
}

function getThisWeekRange(): DateRange {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: formatDate(mon), end: formatDate(sun) };
}

function getThisMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: formatDate(start), end: formatDate(end) };
}

/** 与股票列表、趋势分析共用：同一套快捷项与弹层布局 */
export const DATE_SHORTCUTS = [
  { label: '今日', getRange: (): DateRange => getTodayDateRange() },
  { label: '本周', getRange: getThisWeekRange },
  { label: '本月', getRange: getThisMonthRange },
  {
    label: '近7天',
    getRange: (): DateRange => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 6);
      return { start: formatDate(start), end: formatDate(end) };
    },
  },
  {
    label: '近30天',
    getRange: (): DateRange => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      return { start: formatDate(start), end: formatDate(end) };
    },
  },
  {
    label: '近90天',
    getRange: (): DateRange => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 89);
      return { start: formatDate(start), end: formatDate(end) };
    },
  },
];

export function detectDateField(fields: string[]): string | null {
  const keywords = ['日期', '时间', 'date', 'Date', 'time', 'Time', '交易日'];
  return fields.find((f) => keywords.some((k) => f.includes(k))) ?? null;
}

export interface DateRangePickerButtonProps {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tempRange: DateRange;
  onTempRangeChange: (range: DateRange) => void;
  onApply: (range?: DateRange) => void;
  onClear: () => void;
  hasDateField: boolean;
  hasFilter: boolean;
}

/** 股票列表 / 趋势分析共用的日期区间弹层（宽、左右分栏、日历边距与列表一致） */
export function DateRangePickerButton({
  label,
  open,
  onOpenChange,
  tempRange,
  onTempRangeChange,
  onApply,
  onClear,
  hasDateField,
  hasFilter,
}: DateRangePickerButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        className={`gap-2 ${hasFilter ? 'border-primary/50 text-primary' : ''}`}
        title={hasDateField ? undefined : '未检测到日期字段，日期筛选不可用'}
        onClick={() => onOpenChange(!open)}
      >
        <CalendarDays className="w-4 h-4" />
        <span className="text-[14px] leading-snug">{label}</span>
        {hasFilter && (
          <span
            className="ml-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(23.5rem,calc(100vw-1rem))] rounded-md border border-border bg-popover p-0 shadow-md">
          <div className="flex flex-row items-stretch">
            <div className="flex w-[7rem] shrink-0 flex-col gap-2 border-r border-border px-2.5 py-2 sm:w-[7.25rem] sm:px-3">
              {DATE_SHORTCUTS.map((shortcut) => {
                const r = shortcut.getRange();
                const isActive = tempRange.start === r.start && tempRange.end === r.end;
                return (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => onTempRangeChange(shortcut.getRange())}
                    className={`w-full rounded-md px-2 py-1.5 text-center text-[14px] leading-tight transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 justify-center py-1.5 pl-2 pr-2 sm:px-3">
              <DateRangeCalendarField
                start={tempRange.start}
                end={tempRange.end}
                onChange={(start, end) => onTempRangeChange({ start, end })}
              />
            </div>
          </div>
          {!hasDateField && (
            <div className="border-t border-border px-2.5 py-1.5 sm:px-3">
              <p className="text-sm leading-snug text-amber-600 bg-amber-50 px-2 py-1.5 rounded border border-amber-200">
                未检测到日期字段，筛选可能无效
              </p>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-border px-2.5 py-1.5 sm:px-3">
            <Button variant="ghost" size="sm" onClick={onClear} className="h-8 text-sm">
              清除
            </Button>
            <Button size="sm" onClick={() => onApply()} className="h-8 text-sm">
              确定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
