import { useState, useMemo, useRef, useEffect, useCallback, useDeferredValue } from 'react';
import { Search, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { VirtualStockList } from './VirtualStockList';

interface StockOption {
  code: string;
  name: string;
}

interface StockFilterProps {
  options: StockOption[];
  selected: string[];
  onChange: (stocks: string[]) => void;
  /** 服务端拉 distinct-codes 期间为 true：按钮禁用并提示加载 */
  optionsLoading?: boolean;
}

export function StockFilter({ options, selected, onChange, optionsLoading = false }: StockFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (optionsLoading) setOpen(false);
  }, [optionsLoading]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  /** options 不变时复用小写串，避免每次按键对全表做 toLowerCase */
  const optionsLc = useMemo(
    () => options.map((o) => [o.code.toLowerCase(), o.name.toLowerCase()] as const),
    [options],
  );

  const filtered = useMemo(() => {
    if (!deferredQuery) return options;
    const q = deferredQuery.toLowerCase();
    const out: StockOption[] = [];
    for (let i = 0; i < options.length; i++) {
      const o = options[i]!;
      const [c, n] = optionsLc[i]!;
      if (c.includes(q) || n.includes(q)) out.push(o);
    }
    return out;
  }, [options, optionsLc, deferredQuery]);

  const toggle = useCallback(
    (code: string) => {
      onChange(
        selected.includes(code) ? selected.filter((s) => s !== code) : [...selected, code],
      );
    },
    [selected, onChange],
  );

  const allSelected =
    options.length > 0 &&
    selected.length === options.length &&
    options.every((o) => selectedSet.has(o.code));
  const someSelected = selected.length > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) onChange([]);
    else onChange(options.map((o) => o.code));
  };

  const buttonLabel = useMemo(() => {
    if (optionsLoading && options.length === 0 && selected.length === 0) {
      return '股票列表加载中…';
    }
    if (selected.length === 0) return '选择股票';
    if (selected.length === 1) {
      const stock = options.find((s) => s.code === selected[0]);
      return stock ? `${stock.code} ${stock.name}` : selected[0];
    }
    return `已选 ${selected.length} 只股票`;
  }, [selected, options, optionsLoading]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        disabled={optionsLoading}
        className={`gap-2 ${selected.length > 0 ? 'border-primary/50 text-primary' : ''}`}
        onClick={() => {
          if (optionsLoading) return;
          setOpen(!open);
        }}
      >
        {optionsLoading ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
        <span className="text-[14px] leading-snug">{buttonLabel}</span>
        {selected.length > 0 && !optionsLoading && (
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
        {!optionsLoading && open ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground" />
        ) : !optionsLoading ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : null}
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
                className="w-full pl-8 pr-3 py-2 text-[14px] leading-snug border border-input rounded-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 bg-background"
              />
            </div>
          </div>

          {!query && options.length > 0 && (
            <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border bg-muted/30">
              <div
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-muted/50"
                onClick={toggleAll}
              >
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                />
                <span className="select-none text-sm">全部股票</span>
                <span className="tabular-nums text-sm text-muted-foreground">{options.length} 只</span>
              </div>
            </div>
          )}

          {options.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground leading-relaxed">
              数据中未识别到股票字段
              <p className="text-sm mt-1 text-muted-foreground/80">请确认数据包含代码或名称列</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">未找到匹配股票</div>
          ) : (
            <VirtualStockList
              items={filtered}
              selectedSet={selectedSet}
              onToggle={toggle}
              isSingleSelect={false}
              scrollResetKey={query}
            />
          )}
        </div>
      )}
    </div>
  );
}
