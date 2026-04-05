import { useState, useMemo, useRef, useEffect } from 'react';
import { Database, Search, ChevronDown, X } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import type { Dataset } from '../types';

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

  const openPanel = () => {
    setDraftIds([...selectedIds]);
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
  };

  const confirmSelection = () => {
    onSelectionChange(draftIds);
    setSearch('');
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      setDraftIds([...selectedIds]);
    }
  }, [open, selectedIds]);

  const filteredDatasets = useMemo(() => {
    if (!search.trim()) return datasets;
    const q = search.toLowerCase();
    return datasets.filter((ds) => ds.name.toLowerCase().includes(q));
  }, [datasets, search]);

  const committedAll = datasets.length > 0 && selectedIds.length === datasets.length;
  const getLabel = () => {
    if (datasets.length === 0) return '暂无数据集';
    if (committedAll) return `全部数据集 (${datasets.length})`;
    if (selectedIds.length === 0) return '未选择数据集';
    return `已选 ${selectedIds.length}/${datasets.length} 个数据集`;
  };

  const allDraftSelected = datasets.length > 0 && draftIds.length === datasets.length;
  const someDraftSelected = draftIds.length > 0 && draftIds.length < datasets.length;

  const toggleAllDraft = () => {
    if (allDraftSelected) {
      setDraftIds([]);
    } else {
      setDraftIds(datasets.map((ds) => ds.id));
    }
  };

  const toggleOneDraft = (id: string) => {
    if (draftIds.includes(id)) {
      setDraftIds(draftIds.filter((sid) => sid !== id));
    } else {
      setDraftIds([...draftIds, id]);
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePanel();
      }
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
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 min-w-[160px] justify-between"
        disabled={datasets.length === 0}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <div className="flex items-center gap-1.5 truncate">
          <Database className="w-4 h-4 flex-shrink-0 text-primary" />
          <span className="truncate text-sm leading-snug">{getLabel()}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-popover border border-border rounded-md shadow-md z-50 overflow-hidden">
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
              <div className="py-6 text-center text-sm text-muted-foreground">
                无匹配数据集
              </div>
            ) : (
              <div className="py-1">
                {filteredDatasets.map((ds) => {
                  const isSelected = draftIds.includes(ds.id);
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
        </div>
      )}
    </div>
  );
}
