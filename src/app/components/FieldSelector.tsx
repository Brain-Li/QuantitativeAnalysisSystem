import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { Settings, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import type { FieldConfig } from '../types';
import { cn } from './ui/utils';

interface FieldSelectorProps {
  fields: string[];
  fieldConfigs: FieldConfig[];
  onFieldConfigsChange: (configs: FieldConfig[]) => void;
}

/** 飞书 Shadow-L-down 近似：略强调的下沉投影 */
const DRAGGING_ROW_SHADOW =
  '0 4px 16px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.08)';

const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: '1' },
    },
  }),
};

type SortableFieldRowProps = {
  config: FieldConfig;
  onToggle: (fieldName: string) => void;
  showInsertLineBefore: boolean;
};

const SORTABLE_TRANSITION = {
  duration: 220,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
} as const;

const SortableFieldRow = memo(function SortableFieldRow({
  config,
  onToggle,
  showInsertLineBefore,
}: SortableFieldRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: config.name,
    transition: SORTABLE_TRANSITION,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.95 : undefined,
    boxShadow: isDragging ? DRAGGING_ROW_SHADOW : undefined,
  } as React.CSSProperties;

  const handleRowClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || el.closest('[data-field-drag-handle]')) return;
    onToggle(config.name);
  };

  return (
    <div ref={setNodeRef} style={style} className="relative select-none">
      {showInsertLineBefore && (
        <div
          className="pointer-events-none absolute -top-1 left-0 right-2 z-10 flex justify-center"
          aria-hidden
        >
          <div className="h-[3px] w-full max-w-[calc(100%-0.5rem)] rounded-full bg-[#155DFC]" />
        </div>
      )}
      <div
        role="presentation"
        onClick={handleRowClick}
        className={cn(
          'flex min-h-10 cursor-pointer items-center gap-2 rounded border p-2 transition-[border-color,background-color,box-shadow] duration-200',
          isDragging
            ? 'border-primary/40 bg-muted/30'
            : 'border-border hover:bg-muted',
        )}
      >
        <div
          className={cn(
            'size-4 shrink-0 rounded-[4px] border-2 flex items-center justify-center transition-all',
            config.visible
              ? 'bg-primary border-primary'
              : 'border-muted-foreground/40 bg-background hover:border-muted-foreground/60',
          )}
        >
          {config.visible && (
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M2 6L5 9L10 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        <span className="min-w-0 flex-1 text-left text-sm leading-snug">{config.name}</span>
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-field-drag-handle
          aria-label="拖动排序"
          title="拖动排序"
          className={cn(
            'flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground',
            'cursor-grab hover:bg-muted/80 active:cursor-grabbing',
          )}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 pointer-events-none" aria-hidden />
        </button>
      </div>
    </div>
  );
});

type OverlayRowProps = { config: FieldConfig };

function FieldConfigDragPreview({ config }: OverlayRowProps) {
  return (
    <div
      className="flex min-h-10 w-[calc(20rem-2rem-4px)] max-w-[min(20rem,calc(100vw-2rem))] cursor-grabbing select-none items-center gap-2 rounded border border-primary/30 bg-popover/85 p-2 shadow-lg backdrop-blur-[1px]"
      style={{ boxShadow: DRAGGING_ROW_SHADOW }}
    >
      <div
        className={cn(
          'size-4 shrink-0 rounded-[4px] border-2 flex items-center justify-center',
          config.visible ? 'bg-primary border-primary' : 'border-muted-foreground/40 bg-background',
        )}
      >
        {config.visible && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2 6L5 9L10 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span className="min-w-0 flex-1 text-left text-sm leading-snug">{config.name}</span>
      <div className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
        <GripVertical className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

export function FieldSelector({
  fields,
  fieldConfigs,
  onFieldConfigsChange,
}: FieldSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const fieldConfigsRef = useRef(fieldConfigs);
  fieldConfigsRef.current = fieldConfigs;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const itemIds = useMemo(() => fieldConfigs.map((c) => c.name), [fieldConfigs]);

  const toggleFieldVisibility = useCallback(
    (fieldName: string) => {
      const fc = fieldConfigsRef.current;
      const newConfigs = fc.map((config) =>
        config.name === fieldName ? { ...config, visible: !config.visible } : config,
      );
      onFieldConfigsChange(newConfigs);
    },
    [onFieldConfigsChange],
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setOverId(null);
  }, []);

  const handleDragOver = useCallback((e: DragOverEvent) => {
    setOverId(e.over ? String(e.over.id) : null);
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      setActiveId(null);
      setOverId(null);
      if (!over || active.id === over.id) return;
      const ids = fieldConfigs.map((c) => c.name);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(fieldConfigs, oldIndex, newIndex).map((c, i) => ({
        ...c,
        order: i,
      }));
      onFieldConfigsChange(next);
    },
    [fieldConfigs, onFieldConfigsChange],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
  }, []);

  const showLineBeforeName = useMemo(() => {
    if (!activeId || !overId || activeId === overId) return null;
    return overId;
  }, [activeId, overId]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      if (activeId) return;
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
  }, [isOpen, activeId]);

  const visibleCount = useMemo(
    () => fieldConfigs.reduce((n, f) => n + (f.visible ? 1 : 0), 0),
    [fieldConfigs],
  );
  const allSelected = visibleCount === fieldConfigs.length;

  const toggleAll = useCallback(() => {
    const newConfigs = fieldConfigs.map((config) => ({
      ...config,
      visible: !allSelected,
    }));
    onFieldConfigsChange(newConfigs);
  }, [allSelected, fieldConfigs, onFieldConfigsChange]);

  const activeConfig = activeId
    ? fieldConfigs.find((c) => c.name === activeId) ?? null
    : null;

  const sortableContent = (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-2">
        {fieldConfigs.map((config) => (
          <SortableFieldRow
            key={config.name}
            config={config}
            onToggle={toggleFieldVisibility}
            showInsertLineBefore={showLineBeforeName === config.name}
          />
        ))}
      </div>
    </SortableContext>
  );

  return (
    <div ref={containerRef} className="relative">
      <Button variant="outline" size="sm" onClick={() => setIsOpen((v) => !v)}>
        <Settings className="mr-2 h-4 w-4" />
        <span className="text-[14px] leading-snug">字段配置 ({visibleCount}/{fields.length})</span>
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-border bg-popover p-4 shadow-md">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="mb-1 text-sm font-medium leading-snug">选择展示字段</h4>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  勾选字段可展示，右侧手柄拖拽排序
                </p>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                className="ml-2 whitespace-nowrap text-sm text-primary transition-colors hover:text-primary/80"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
              autoScroll={{
                threshold: { x: 0, y: 0.12 },
                acceleration: 12,
                interval: 5,
              }}
            >
              <div
                ref={listScrollRef}
                className="relative max-h-[300px] overflow-y-auto overflow-x-hidden pr-1 select-none"
              >
                {sortableContent}
              </div>
              <DragOverlay dropAnimation={DROP_ANIMATION} className="z-[240]">
                {activeConfig ? <FieldConfigDragPreview config={activeConfig} /> : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      )}
    </div>
  );
}
