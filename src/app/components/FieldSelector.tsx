import { useState, useRef, useEffect } from 'react';
import { Settings, GripVertical, CheckSquare, Square } from 'lucide-react';
import { Button } from './ui/button';
import type { FieldConfig } from '../types';

interface FieldSelectorProps {
  fields: string[];
  fieldConfigs: FieldConfig[];
  onFieldConfigsChange: (configs: FieldConfig[]) => void;
}

export function FieldSelector({
  fields,
  fieldConfigs,
  onFieldConfigsChange,
}: FieldSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFieldVisibility = (fieldName: string) => {
    const newConfigs = fieldConfigs.map((config) =>
      config.name === fieldName
        ? { ...config, visible: !config.visible }
        : config
    );
    onFieldConfigsChange(newConfigs);
  };

  const handleDragStart = (index: number, e: React.DragEvent) => {
    setDraggedIndex(index);
    setDragOverIndex(null);
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragOver = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newConfigs = [...fieldConfigs];
      const draggedItem = newConfigs[draggedIndex];
      newConfigs.splice(draggedIndex, 1);
      newConfigs.splice(dragOverIndex, 0, draggedItem);
      const updatedConfigs = newConfigs.map((config, idx) => ({ ...config, order: idx }));
      onFieldConfigsChange(updatedConfigs);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setDragOverIndex(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const visibleCount = fieldConfigs.filter((f) => f.visible).length;
  const allSelected = visibleCount === fieldConfigs.length;

  const toggleAll = () => {
    const newConfigs = fieldConfigs.map((config) => ({
      ...config,
      visible: !allSelected,
    }));
    onFieldConfigsChange(newConfigs);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen((v) => !v)}
      >
        <Settings className="mr-2 h-4 w-4" />
        <span className="text-[14px] leading-snug">字段配置 ({visibleCount}/{fields.length})</span>
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-popover border border-border rounded-md shadow-md z-50 p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium mb-1 text-sm leading-snug">选择展示字段</h4>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  勾选字段可展示，拖拽可调整顺序
                </p>
              </div>
              <button
                onClick={toggleAll}
                className="text-sm text-primary hover:text-primary/80 transition-colors whitespace-nowrap ml-2"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="h-[300px] overflow-y-auto pr-1 space-y-2">
              {fieldConfigs.map((config, index) => (
                <div
                  key={config.name}
                  draggable
                  onDragStart={(e) => handleDragStart(index, e)}
                  onDragOver={(e) => handleDragOver(index, e)}
                  onDragEnd={handleDragEnd}
                  onDragLeave={handleDragLeave}
                  className={`flex items-center gap-2 p-2 rounded border cursor-move transition-all ${
                    draggedIndex === index
                      ? 'opacity-50 border-primary bg-primary/10'
                      : dragOverIndex === index
                      ? 'border-primary bg-primary/5 scale-105'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  {/* Custom checkbox */}
                  <div
                    className={`size-4 shrink-0 rounded-[4px] border-2 flex items-center justify-center cursor-pointer transition-all ${
                      config.visible
                        ? 'bg-primary border-primary'
                        : 'border-muted-foreground/40 bg-background hover:border-muted-foreground/60'
                    }`}
                    onClick={() => toggleFieldVisibility(config.name)}
                  >
                    {config.visible && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <label
                    className="flex-1 cursor-pointer text-sm leading-snug select-none"
                    onClick={() => toggleFieldVisibility(config.name)}
                  >
                    {config.name}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}