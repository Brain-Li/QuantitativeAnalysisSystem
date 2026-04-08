import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useDeferredValue,
} from 'react';
import { createPortal } from 'react-dom';
import { Database, Search, ChevronDown, X } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import type { Dataset } from '../types';

/** w-72，与面板 class 一致，用于对齐触发按钮右缘 */
const PANEL_WIDTH_PX = 288;
const PANEL_GAP_PX = 4;

interface DatasetSelectorProps {
  datasets: Dataset[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function DatasetSelector({ datasets, selectedIds, onSelectionChange }: DatasetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  /** 下拉内勾选状态，仅点击「确定」后同步到父级 */
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  const openPanel = useCallback(() => {
    setDraftIds([...selectedIds]);
    setOpen(true);
  }, [selectedIds]);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  const confirmSelection = useCallback(() => {
    onSelectionChange(draftIds);
    setSearch('');
    setOpen(false);
  }, [onSelectionChange, draftIds]);

  useEffect(() => {
    if (!open) {
      setDraftIds([...selectedIds]);
    }
  }, [open, selectedIds]);

  const deferredSearch = useDeferredValue(search);

  const datasetsNameLc = useMemo(
    () => datasets.map((ds) => [ds, ds.name.toLowerCase()] as const),
    [datasets],
  );

  const filteredDatasets = useMemo(() => {
    const t = deferredSearch.trim().toLowerCase();
    if (!t) return datasets;
    const out: Dataset[] = [];
    for (let i = 0; i < datasetsNameLc.length; i++) {
      const [ds, lc] = datasetsNameLc[i]!;
      if (lc.includes(t)) out.push(ds);
    }
    return out;
  }, [datasets, datasetsNameLc, deferredSearch]);

  const buttonLabel = useMemo(() => {
    if (datasets.length === 0) return '暂无数据集';
    if (datasets.length > 0 && selectedIds.length === datasets.length) {
      return `全部数据集 (${datasets.length})`;
    }
    if (selectedIds.length === 0) return '未选择数据集';
    return `已选 ${selectedIds.length}/${datasets.length} 个数据集`;
  }, [datasets.length, selectedIds.length]);

  const draftIdSet = useMemo(() => new Set(draftIds), [draftIds]);

  const allDraftSelected = datasets.length > 0 && draftIds.length === datasets.length;
  const someDraftSelected = draftIds.length > 0 && draftIds.length < datasets.length;

  const toggleAllDraft = useCallback(() => {
    if (datasets.length > 0 && draftIds.length === datasets.length) {
      setDraftIds([]);
    } else {
      setDraftIds(datasets.map((ds) => ds.id));
    }
  }, [datasets, draftIds.length]);

  const toggleOneDraft = useCallback(
    (id: string) => {
      setDraftIds((prev) => {
        const set = new Set(prev);
        if (set.has(id)) {
          set.delete(id);
          return Array.from(set);
        }
        return [...prev, id];
      });
    },
    [],
  );

  const updatePanelPosition = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, r.right - PANEL_WIDTH_PX),
      Math.max(8, window.innerWidth - PANEL_WIDTH_PX - 8),
    );
    setPanelPos({ top: r.bottom + PANEL_GAP_PX, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
    const onWin = () => updatePanelPosition();
    window.addEventListener('resize', onWin);
    document.addEventListener('scroll', onWin, true);
    return () => {
      window.removeEventListener('resize', onWin);
      document.removeEventListener('scroll', onWin, true);
    };
  }, [open, updatePanelPosition]);

  // Close on outside click（面板通过 Portal 挂到 body，须同时判断 panelRef）
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closePanel();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, closePanel]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        className="gap-1.5 min-w-[160px] justify-between"
        disabled={datasets.length === 0}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <div className="flex items-center gap-1.5 truncate">
          <Database className="w-4 h-4 flex-shrink-0 text-primary" />
          <span className="truncate text-sm leading-snug">{buttonLabel}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {/* Dropdown：Portal + fixed，避免被下方 DataTable 叠层挡住或被 main overflow 裁切 */}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed w-72 bg-popover border border-border rounded-md shadow-md z-[200] overflow-hidden"
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            {/* Search */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="搜索数据集..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                {search && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearch('')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Select All */}
            {!search && (
              <div
                className="flex items-center gap-2.5 px-3 py-2 border-b border-border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={toggleAllDraft}
              >
                <Checkbox
                  checked={allDraftSelected ? true : someDraftSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAllDraft}
                />
                <span className="text-sm select-none">全部数据集</span>
                <span className="ml-auto text-sm text-muted-foreground tabular-nums">{datasets.length} 个</span>
              </div>
            )}

            {/* List */}
            <div className="max-h-[220px] overflow-y-auto">
              {filteredDatasets.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">无匹配数据集</div>
              ) : (
                <div className="py-1">
                  {filteredDatasets.map((ds) => {
                    const isSelected = draftIdSet.has(ds.id);
                    return (
                      <div
                        key={ds.id}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                          isSelected ? 'bg-primary/5' : ''
                        }`}
                        onClick={() => toggleOneDraft(ds.id)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOneDraft(ds.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate select-none">{ds.name}</div>
                          <div className="text-sm text-muted-foreground select-none tabular-nums">
                            {ds.dataCount} 条数据
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {datasets.length > 0 && (
              <div className="p-2 border-t border-border flex justify-end items-center gap-2">
                <span className="mr-auto text-sm text-muted-foreground tabular-nums">已选 {draftIds.length} 个</span>
                <Button size="sm" className="h-8 text-sm px-3" onClick={confirmSelection}>
                  确定
                </Button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
