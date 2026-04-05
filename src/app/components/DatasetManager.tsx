import { useState } from 'react';
import { Database, Trash2, Clock, FileText, Search, ChevronLeft, ChevronRight, CheckSquare, Square } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from './ui/utils';
import type { Dataset } from '../types';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

interface DatasetManagerProps {
  datasets: Dataset[];
  currentDatasetId?: string;
  onSelectDataset: (datasetId: string) => void;
  onDeleteDataset: (datasetId: string) => void;
  onBatchDeleteDatasets?: (datasetIds: string[]) => void;
  /** 与数据导入页配合纵向撑满视口时使用，例如 `min-h-0 flex-1` */
  className?: string;
}

// Simple confirm dialog without Radix UI
function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-50 bg-background w-full max-w-sm mx-4 rounded-lg border p-6 shadow-lg">
        <h3 className="text-base font-semibold mb-2 leading-snug">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            className="bg-destructive hover:bg-destructive/90 text-white"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            删除
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DatasetManager({
  datasets,
  currentDatasetId,
  onSelectDataset,
  onDeleteDataset,
  onBatchDeleteDatasets,
  className,
}: DatasetManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<string | 'batch' | null>(null);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [itemsPerPage, setItemsPerPage] = useState(PAGE_SIZE_OPTIONS[0]);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const filteredDatasets = datasets.filter((dataset) =>
    dataset.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredDatasets.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedDatasets = filteredDatasets.slice(startIndex, startIndex + itemsPerPage);

  const hasListTable = datasets.length > 0 && filteredDatasets.length > 0;

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onSelectDataset('');
    }
  };

  const renderPageButtons = () => {
    if (totalPages <= 1) return null;
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages.map((p, idx) =>
      p === '...' ? (
        <span key={`ellipsis-${idx}`} className="px-1.5 text-muted-foreground text-sm select-none">…</span>
      ) : (
        <button
          key={p}
          onClick={() => setCurrentPage(p as number)}
          className={`min-w-8 h-8 px-1 rounded text-sm transition-colors ${
            currentPage === p
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-foreground'
          }`}
        >
          {p}
        </button>
      )
    );
  };

  const handleSelectDataset = (datasetId: string) => {
    if (selectedDatasetIds.includes(datasetId)) {
      setSelectedDatasetIds(selectedDatasetIds.filter(id => id !== datasetId));
    } else {
      setSelectedDatasetIds([...selectedDatasetIds, datasetId]);
    }
  };

  const handleBatchDelete = () => {
    if (onBatchDeleteDatasets && selectedDatasetIds.length > 0) {
      onBatchDeleteDatasets(selectedDatasetIds);
      setSelectedDatasetIds([]);
    }
  };

  return (
    <Card className={cn('min-h-0', className)}>
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2 text-[15px] sm:text-base font-semibold leading-snug">
          <Database className="w-5 h-5 shrink-0" />
          数据集管理
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          hasListTable ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-3',
        )}
      >
        {/* Search */}
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            placeholder="搜索数据集..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm leading-snug border border-input rounded-md bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
        </div>

        {datasets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm leading-relaxed">暂无数据集</p>
          </div>
        ) : filteredDatasets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm leading-relaxed">未找到匹配的数据集</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Batch Delete Toolbar */}
            <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const currentPageIds = paginatedDatasets.map(d => d.id);
                    const allSelected = currentPageIds.every(id => selectedDatasetIds.includes(id));
                    if (allSelected) {
                      setSelectedDatasetIds(selectedDatasetIds.filter(id => !currentPageIds.includes(id)));
                    } else {
                      const newSelected = [...new Set([...selectedDatasetIds, ...currentPageIds])];
                      setSelectedDatasetIds(newSelected);
                    }
                  }}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {paginatedDatasets.length > 0 && 
                   paginatedDatasets.every(d => selectedDatasetIds.includes(d.id)) ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  <span className="text-sm">
                    {paginatedDatasets.length > 0 && 
                     paginatedDatasets.every(d => selectedDatasetIds.includes(d.id))
                      ? '取消全选'
                      : '全选'}
                  </span>
                </button>
                {selectedDatasetIds.length > 0 && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    已选 <span className="text-foreground font-medium">{selectedDatasetIds.length}</span> 项
                  </span>
                )}
              </div>
              {selectedDatasetIds.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-destructive/50 text-destructive hover:bg-destructive hover:text-white"
                  onClick={() => setDeleteTarget('batch')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  批量删除
                </Button>
              )}
            </div>

            <div
              className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
              onClick={handleContainerClick}
            >
              {paginatedDatasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className={`p-2.5 sm:p-3 rounded-lg border transition-colors cursor-pointer ${
                    currentDatasetId === dataset.id
                      ? 'border-primary bg-primary/5'
                      : selectedDatasetIds.includes(dataset.id)
                      ? 'border-primary/70 bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDataset(dataset.id);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-2.5 flex-1 min-w-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectDataset(dataset.id);
                        }}
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                      >
                        {selectedDatasetIds.includes(dataset.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <p className="font-medium text-sm leading-snug truncate" title={dataset.name}>
                          {dataset.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground shrink-0 sm:max-w-[min(100%,22rem)]">
                          <span className="inline-flex items-center gap-1 tabular-nums whitespace-nowrap">
                            <Clock className="w-3.5 h-3.5 shrink-0 opacity-80" />
                            {formatDate(dataset.importTime)}
                          </span>
                          <span className="hidden sm:inline text-border select-none" aria-hidden>
                            |
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-xs font-normal h-5 px-1.5 py-0 leading-none tabular-nums"
                          >
                            {dataset.dataCount} 条
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <button
                      className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(dataset.id);
                      }}
                      title="删除数据集"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex shrink-0 items-center justify-between border-t px-1 pt-2 text-sm">
              <span className="text-muted-foreground tabular-nums">
                共 <span className="text-foreground font-medium">{filteredDatasets.length}</span> 个数据集
              </span>
              <div className="flex items-center gap-2">
                {totalPages > 1 && (
                  <>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => p - 1)}
                        className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      {renderPageButtons()}
                      <button
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((p) => p + 1)}
                        className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <span className="text-muted-foreground ml-1">
                        第 {currentPage}/{totalPages} 页
                      </span>
                    </div>
                    <div className="h-4 w-px bg-border" />
                  </>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground whitespace-nowrap">每页</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size} 条</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget === 'batch') {
            handleBatchDelete();
          } else if (deleteTarget) {
            onDeleteDataset(deleteTarget);
          }
          setDeleteTarget(null);
        }}
        title={deleteTarget === 'batch' ? `确认批量删除 ${selectedDatasetIds.length} 个数据集？` : '确认删除数据集？'}
        description="删除后数据将无法恢复。是否继续？"
      />
    </Card>
  );
}