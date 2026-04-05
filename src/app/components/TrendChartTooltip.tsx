import type { TooltipProps } from 'recharts';
import {
  formatDateCell,
  formatMetricValueForChart,
  getFieldDisplayHeader,
  isZhangDieFuField,
  zhangDieFuStyle,
} from '../utils/fieldDisplayFormat';

export function TrendChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const labelText =
    label !== undefined && label !== null ? formatDateCell(label) : '';

  return (
    <div
      className="rounded-lg border border-border bg-popover px-3 py-2.5 text-sm leading-snug shadow-md"
      style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      {labelText ? <p className="mb-1.5 text-muted-foreground">{labelText}</p> : null}
      {payload.map((item, i) => {
        const key = String(item.dataKey ?? item.name ?? i);
        const header = getFieldDisplayHeader(key);
        const formatted = formatMetricValueForChart(key, item.value);
        const colorStyle = isZhangDieFuField(key) ? zhangDieFuStyle(item.value) : undefined;
        return (
          <p key={key + String(i)} className="flex flex-wrap gap-1">
            <span className="text-foreground/80">{header}:</span>
            <span className="font-medium" style={colorStyle}>
              {formatted}
            </span>
          </p>
        );
      })}
    </div>
  );
}
