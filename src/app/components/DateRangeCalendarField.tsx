import { useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';
import { Calendar } from './ui/calendar';

function parseYmd(s: string): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? undefined : dt;
}

function toYmd(d: Date | undefined): string {
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

interface DateRangeCalendarFieldProps {
  /** yyyy-MM-dd */
  start: string;
  /** yyyy-MM-dd */
  end: string;
  onChange: (start: string, end: string) => void;
}

/**
 * 单面板内拖拽/点选起止日期（react-day-picker range），替代两个原生 date input。
 */
export function DateRangeCalendarField({ start, end, onChange }: DateRangeCalendarFieldProps) {
  const selected: DateRange | undefined = useMemo(() => {
    const from = parseYmd(start);
    const to = parseYmd(end);
    if (!from && !to) return undefined;
    if (from && !to) return { from, to: undefined };
    if (from && to) return { from, to };
    return undefined;
  }, [start, end]);

  const defaultMonth = useMemo(() => parseYmd(start) ?? parseYmd(end) ?? new Date(), [start, end]);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      onChange('', '');
      return;
    }
    const fs = toYmd(range.from);
    if (!range.to) {
      onChange(fs, fs);
      return;
    }
    const te = toYmd(range.to);
    let a = fs;
    let b = te;
    if (a > b) [a, b] = [b, a];
    onChange(a, b);
  };

  return (
    <div className="flex w-full min-w-0 max-w-full shrink-0 justify-center">
      <Calendar
        className="!p-1 px-0.5 py-1"
        classNames={{
          months: "flex w-full flex-col gap-0",
          month: "flex w-full flex-col items-stretch gap-1.5",
          table: "mx-auto w-auto border-collapse space-x-1",
          row: "mt-1 flex w-full",
        }}
        mode="range"
        numberOfMonths={1}
        locale={zhCN}
        defaultMonth={defaultMonth}
        selected={selected}
        onSelect={handleSelect}
      />
    </div>
  );
}
