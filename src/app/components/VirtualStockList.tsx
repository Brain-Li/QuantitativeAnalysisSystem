import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check } from 'lucide-react';
import { cn } from './ui/utils';

export type VirtualStockListItem = { code: string; name: string };

type VirtualStockListProps = {
  items: VirtualStockListItem[];
  /** 用 Set 做选中判断，避免数千次 includes */
  selectedSet: Set<string>;
  onToggle: (code: string) => void;
  isSingleSelect: boolean;
  /** 搜索关键字变化时传，用于滚回顶部 */
  scrollResetKey?: string;
  /** 单行估算高度（px），与 padding 一致即可 */
  estimateRowHeight?: number;
};

/**
 * 股票下拉列表虚拟滚动：仅挂载可视区附近行，解决 5000+ 股票时打开卡顿。
 */
export function VirtualStockList({
  items,
  selectedSet,
  onToggle,
  isSingleSelect,
  scrollResetKey = '',
  estimateRowHeight,
}: VirtualStockListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const estimate =
    estimateRowHeight ?? (isSingleSelect ? 44 : 40);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimate,
    overscan: 12,
  });

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [scrollResetKey]);

  if (items.length === 0) {
    return null;
  }

  const vItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="max-h-60 overflow-y-auto overscroll-contain"
    >
      <div
        style={{
          height: totalSize,
          position: 'relative',
          width: '100%',
        }}
      >
        {vItems.map((virtualRow) => {
          const stock = items[virtualRow.index];
          if (!stock) return null;
          const isSelected = selectedSet.has(stock.code);
          const label =
            stock.code !== stock.name ? `${stock.code}  ${stock.name}` : stock.code;

          return (
            <div
              key={stock.code}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                minHeight: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                role="option"
                aria-selected={isSelected}
                onClick={() => onToggle(stock.code)}
                className={cn(
                  'flex items-center gap-2.5 px-3 cursor-pointer transition-colors',
                  isSingleSelect ? 'py-2.5' : 'py-2',
                  isSingleSelect
                    ? isSelected
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/50'
                    : isSelected
                      ? 'bg-primary/5 text-primary'
                      : 'hover:bg-muted/50',
                )}
              >
                {!isSingleSelect && (
                  <div
                    className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                      isSelected ? 'bg-primary border-primary' : 'border-border bg-background',
                    )}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                  </div>
                )}
                <span
                  className={cn(
                    'flex-1 truncate leading-snug',
                    isSingleSelect ? 'text-sm' : 'text-[14px]',
                    isSingleSelect && isSelected && 'text-foreground font-medium',
                  )}
                >
                  {label}
                </span>
                {isSingleSelect && isSelected && (
                  <Check className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2.5} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
