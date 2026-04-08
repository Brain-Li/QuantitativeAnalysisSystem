import { useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';
import { Calendar } from './ui/calendar';
import { cn } from './ui/utils';

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
  /** 并排展示月数，参考设计图为 2 */
  numberOfMonths?: number;
  className?: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * 点选 / 拖拽起止日期（react-day-picker range）；可选双月并排。
 */
export function DateRangeCalendarField({
  start,
  end,
  onChange,
  numberOfMonths = 2,
  className,
}: DateRangeCalendarFieldProps) {
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

  const today = useMemo(() => startOfDay(new Date()), []);
  const disableFuture = (d: Date) => startOfDay(d) > today;

  return (
    <div
      className={cn(
        'flex w-fit min-w-0 max-w-full shrink-0 justify-start',
        className,
      )}
    >
      <Calendar
        className="!m-0 !w-fit !min-w-0 !p-0"
        classNames={{
          months: cn(
            'flex w-max max-w-none gap-2',
            numberOfMonths > 1 ? 'flex-col sm:flex-row' : 'flex-col',
          ),
          month: 'flex w-fit flex-col items-stretch gap-1.5',
          table: 'mx-auto w-auto border-collapse space-x-1',
          row: 'mt-1 flex w-full',
        }}
        mode="range"
        numberOfMonths={numberOfMonths}
        locale={zhCN}
        defaultMonth={defaultMonth}
        selected={selected}
        onSelect={handleSelect}
        disabled={disableFuture}
      />
    </div>
  );
}
