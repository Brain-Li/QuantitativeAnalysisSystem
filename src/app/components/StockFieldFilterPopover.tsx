import type { CSSProperties } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Filter, Plus, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverWrapper,
} from "./ui/popover";
import { getFieldDisplayHeader } from "../utils/fieldDisplayFormat";
import {
  createEmptyFieldCondition,
  normalizeActiveConditions,
  type FieldFilterCondition,
  type FieldFilterLogic,
  type FieldFilterOp,
} from "../utils/fieldFilter";
import { cn, isPointerEventInsideContainer } from "./ui/utils";

const OP_OPTIONS: { value: FieldFilterOp; label: string }[] = [
  { value: "eq", label: "等于" },
  { value: "neq", label: "不等于" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
  { value: "between", label: "介于" },
  { value: "contains", label: "包含" },
  { value: "empty", label: "为空" },
];

const LOGIC_OPTIONS: { value: FieldFilterLogic; label: string }[] = [
  { value: "all", label: "所有" },
  { value: "any", label: "任一" },
];

/** 选择字段按钮：仅用 border 变色表示聚焦（1px），避免 outline 被父级 overflow-y-auto 裁切 */
const selectClass =
  "box-border h-8 min-w-0 rounded-md border border-solid border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-0 focus:border-primary cursor-pointer";

/** 字段触发器：固定宽度；列表高度见 FIELD_LIST_MAX_PX（约 14 行） */
const fieldSelectClass = cn(
  selectClass,
  "inline-flex w-[7rem] max-w-[7rem] shrink-0 items-center justify-between gap-1 text-left",
);

/** 约 14 行列表的像素上限（31.5rem @16px） */
const FIELD_LIST_MAX_PX = 504;

/** 「所有/任一」「等于」选项列表最大高度（与原先 Radix Select 下拉接近） */
const FILTER_ENUM_MAX_H_PX = 280;

/** 与「选择字段」一致：Portal + mousedown 外点关闭，避免 Radix Select 的 body pointer-events 吞掉第一次点击 */
function FilterEnumDropdownInner<T extends string>({
  value,
  options,
  onChange,
  isOpen,
  onRequestToggle,
  onRequestClose,
  onPointerDownCapture,
  buttonClassName,
  ariaLabel,
  title,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  isOpen: boolean;
  onRequestToggle: () => void;
  onRequestClose: () => void;
  onPointerDownCapture?: () => void;
  buttonClassName: string;
  ariaLabel: string;
  title?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);

  const updatePanelPosition = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !isOpen) return;
    const r = wrap.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - gap - 8;
    const maxH = Math.max(120, Math.min(FILTER_ENUM_MAX_H_PX, spaceBelow));
    setPanelStyle({
      position: "fixed",
      top: r.bottom + gap,
      left: r.left,
      minWidth: Math.max(r.width, 160),
      maxWidth: "min(18rem, calc(100vw - 2rem))",
      maxHeight: maxH,
      overflowY: "auto",
      zIndex: 9999,
    });
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPanelStyle(null);
      return;
    }
    updatePanelPosition();
  }, [isOpen, updatePanelPosition, value, options]);

  useEffect(() => {
    if (!isOpen) return;
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [isOpen, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        isPointerEventInsideContainer(wrapRef.current, e) ||
        isPointerEventInsideContainer(listRef.current, e)
      ) {
        return;
      }
      onRequestClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen, onRequestClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onRequestClose]);

  const label = options.find((o) => o.value === value)?.label ?? "";

  const listEl =
    isOpen && panelStyle ? (
      <ul
        ref={listRef}
        data-stock-filter-enum-portal=""
        role="listbox"
        style={panelStyle}
        className="rounded-md border border-solid border-border bg-popover py-1 text-sm text-foreground shadow-md"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <li key={o.value} role="presentation">
            <button
              type="button"
              role="option"
              className={cn(
                "flex w-full min-h-[2.25rem] items-center px-2 py-1.5 text-left hover:bg-muted",
                o.value === value && "bg-accent/50",
              )}
              onClick={() => {
                onChange(o.value);
                onRequestClose();
              }}
            >
              {o.label}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div ref={wrapRef} className="relative min-w-0 shrink-0">
      <button
        type="button"
        className={buttonClassName}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        title={title}
        onPointerDownCapture={() => {
          onPointerDownCapture?.();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onRequestToggle();
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </button>
      {typeof document !== "undefined" && listEl
        ? createPortal(listEl, document.body)
        : null}
    </div>
  );
}

const FilterEnumDropdown = memo(FilterEnumDropdownInner) as typeof FilterEnumDropdownInner;

/** 与选择字段一致：1px border-primary，无 outline/ring，避免叠边与裁切 */
const filterInputClass =
  "box-border h-8 min-w-0 flex-1 border border-solid border-border bg-background px-2 py-1 text-sm md:text-sm focus-visible:outline-none focus-visible:ring-0 focus-visible:border-primary";

/** Radix SelectTrigger：与输入框同口径；手型与「选择字段」一致 */
const filterSelectTriggerClass =
  "cursor-pointer disabled:cursor-not-allowed border-solid bg-background hover:bg-background dark:bg-background dark:hover:bg-background focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none focus-visible:border-primary data-[state=open]:border-primary";

interface StockFieldFilterPopoverProps {
  filterableFields: string[];
  conditions: FieldFilterCondition[];
  logic: FieldFilterLogic;
  onConditionsChange: (next: FieldFilterCondition[]) => void;
  onLogicChange: (next: FieldFilterLogic) => void;
  disabled?: boolean;
  /** 父级在「重置筛选」时递增，用于关闭字段下拉 */
  fieldFilterResetSignal?: number;
}

function FieldSelectDropdown({
  value,
  fields,
  onChange,
  isOpen,
  onRequestToggle,
  onRequestClose,
  onPointerDownCapture,
}: {
  value: string;
  fields: string[];
  onChange: (field: string) => void;
  isOpen: boolean;
  onRequestToggle: () => void;
  onRequestClose: () => void;
  /** 在捕获阶段先收起「所有/任一」「等于」下拉，避免与 Portal 列表抢第一次点击 */
  onPointerDownCapture?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);

  const updatePanelPosition = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !isOpen) return;
    const r = wrap.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - gap - 8;
    const maxH = Math.max(120, Math.min(FIELD_LIST_MAX_PX, spaceBelow));
    setPanelStyle({
      position: "fixed",
      top: r.bottom + gap,
      left: r.left,
      minWidth: Math.max(r.width, 160),
      maxWidth: "min(18rem, calc(100vw - 2rem))",
      maxHeight: maxH,
      overflowY: "auto",
      zIndex: 9999,
    });
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPanelStyle(null);
      return;
    }
    updatePanelPosition();
  }, [isOpen, updatePanelPosition, value, fields]);

  useEffect(() => {
    if (!isOpen) return;
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [isOpen, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        isPointerEventInsideContainer(wrapRef.current, e) ||
        isPointerEventInsideContainer(listRef.current, e)
      ) {
        return;
      }
      onRequestClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen, onRequestClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onRequestClose]);

  const label = value ? getFieldDisplayHeader(value) : "选择字段";

  const listEl =
    isOpen && panelStyle ? (
      <ul
        ref={listRef}
        data-stock-field-select-portal=""
        role="listbox"
        style={panelStyle}
        className="rounded-md border border-solid border-border bg-popover py-1 text-sm text-foreground shadow-md"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <li role="presentation">
          <button
            type="button"
            role="option"
            className="flex w-full min-h-[2.25rem] items-center px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => {
              onChange("");
              onRequestClose();
            }}
          >
            选择字段
          </button>
        </li>
        {fields.map((f) => (
          <li key={f} role="presentation">
            <button
              type="button"
              role="option"
              className="flex w-full min-h-[2.25rem] items-center px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => {
                onChange(f);
                onRequestClose();
              }}
            >
              {getFieldDisplayHeader(f)}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        className={cn(fieldSelectClass, isOpen && "border-primary")}
        aria-label="筛选字段"
        aria-expanded={isOpen}
        title={value ? getFieldDisplayHeader(value) : undefined}
        onPointerDownCapture={() => {
          onPointerDownCapture?.();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onRequestToggle();
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </button>
      {typeof document !== "undefined" && listEl
        ? createPortal(listEl, document.body)
        : null}
    </div>
  );
}

const MemoFieldSelectDropdown = memo(FieldSelectDropdown);

type FieldFilterConditionRowProps = {
  row: FieldFilterCondition;
  filterableFields: string[];
  isFieldMenuOpen: boolean;
  isOpMenuOpen: boolean;
  onToggleFieldMenu: (id: string) => void;
  onToggleOpMenu: (id: string) => void;
  onCloseFieldMenu: () => void;
  onCloseOpMenu: (id: string) => void;
  closeEnumDropdowns: () => void;
  /** 与原先「等于」下拉一致：收起字段列表 +「所有/任一」 */
  onOpEnumPointerDownCapture: () => void;
  dismissAllFilterFloats: () => void;
  patchRow: (id: string, patch: Partial<FieldFilterCondition>) => void;
  onRemoveRow: (id: string) => void;
};

const FieldFilterConditionRow = memo(function FieldFilterConditionRow({
  row,
  filterableFields,
  isFieldMenuOpen,
  isOpMenuOpen,
  onToggleFieldMenu,
  onToggleOpMenu,
  onCloseFieldMenu,
  onCloseOpMenu,
  closeEnumDropdowns,
  onOpEnumPointerDownCapture,
  dismissAllFilterFloats,
  patchRow,
  onRemoveRow,
}: FieldFilterConditionRowProps) {
  const handleFieldMenuToggle = useCallback(() => {
    onToggleFieldMenu(row.id);
  }, [onToggleFieldMenu, row.id]);

  const handleOpMenuToggle = useCallback(() => {
    onToggleOpMenu(row.id);
  }, [onToggleOpMenu, row.id]);

  const handleCloseOpMenu = useCallback(() => {
    onCloseOpMenu(row.id);
  }, [onCloseOpMenu, row.id]);

  const handleFieldChange = useCallback(
    (field: string) => {
      patchRow(row.id, { field });
    },
    [patchRow, row.id],
  );

  const handleOpChange = useCallback(
    (next: FieldFilterOp) => {
      patchRow(row.id, {
        op: next,
        value2: next === "between" ? row.value2 ?? "" : row.value2,
      });
    },
    [patchRow, row.id, row.value2],
  );

  const handleRemoveClick = useCallback(() => {
    onRemoveRow(row.id);
  }, [onRemoveRow, row.id]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <MemoFieldSelectDropdown
        value={row.field}
        fields={filterableFields}
        onChange={handleFieldChange}
        isOpen={isFieldMenuOpen}
        onRequestToggle={handleFieldMenuToggle}
        onRequestClose={onCloseFieldMenu}
        onPointerDownCapture={closeEnumDropdowns}
      />

      <FilterEnumDropdown
        value={row.op}
        options={OP_OPTIONS}
        onChange={handleOpChange}
        isOpen={isOpMenuOpen}
        onRequestToggle={handleOpMenuToggle}
        onRequestClose={handleCloseOpMenu}
        onPointerDownCapture={onOpEnumPointerDownCapture}
        buttonClassName={cn(
          filterSelectTriggerClass,
          "inline-flex h-8 w-[6.5rem] max-w-[6.5rem] shrink-0 items-center justify-between gap-1 rounded-md border border-border text-left text-sm text-foreground [&_span]:min-w-0 [&_span]:truncate",
          isOpMenuOpen && "border-primary",
        )}
        aria-label="比较方式"
        title={OP_OPTIONS.find((o) => o.value === row.op)?.label ?? undefined}
      />

      {row.op === "empty" ? (
        <span className="min-w-[4rem] flex-1 text-xs text-muted-foreground">
          （不填值）
        </span>
      ) : row.op === "between" ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Input
            className={cn(filterInputClass, "min-w-[4.5rem]")}
            placeholder="下限"
            value={row.value}
            onPointerDownCapture={dismissAllFilterFloats}
            onChange={(e) => {
              patchRow(row.id, { value: e.target.value });
            }}
          />
          <span className="shrink-0 text-muted-foreground">~</span>
          <Input
            className={cn(filterInputClass, "min-w-[4.5rem]")}
            placeholder="上限"
            value={row.value2 ?? ""}
            onPointerDownCapture={dismissAllFilterFloats}
            onChange={(e) => {
              patchRow(row.id, { value2: e.target.value });
            }}
          />
        </div>
      ) : (
        <Input
          className={cn(filterInputClass, "min-w-[6rem]")}
          placeholder="请输入"
          value={row.value}
          onPointerDownCapture={dismissAllFilterFloats}
          onChange={(e) => {
            patchRow(row.id, { value: e.target.value });
          }}
        />
      )}

      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onPointerDownCapture={dismissAllFilterFloats}
        onClick={handleRemoveClick}
        aria-label="删除此条件"
      >
        <X className="size-4" />
      </button>
    </div>
  );
});

export function StockFieldFilterPopover({
  filterableFields,
  conditions,
  logic,
  onConditionsChange,
  onLogicChange,
  disabled,
  fieldFilterResetSignal = 0,
}: StockFieldFilterPopoverProps) {
  const activeCount = useMemo(
    () => normalizeActiveConditions(conditions).length,
    [conditions],
  );
  const [fieldMenuOpenId, setFieldMenuOpenId] = useState<string | null>(null);
  const [logicMenuOpen, setLogicMenuOpen] = useState(false);
  const [opMenuRowId, setOpMenuRowId] = useState<string | null>(null);
  const closeFieldMenu = useCallback(() => setFieldMenuOpenId(null), []);

  /** 仅收起「所有/任一」「等于」（点「选择字段」时用，不关字段列表） */
  const closeEnumDropdowns = useCallback(() => {
    setLogicMenuOpen(false);
    setOpMenuRowId(null);
  }, []);

  /** 点「等于」下拉触发器时：收起字段 Portal 与「所有/任一」（与原先逻辑一致） */
  const onOpEnumPointerDownCapture = useCallback(() => {
    setFieldMenuOpenId(null);
    setLogicMenuOpen(false);
  }, []);

  /** 收起字段 Portal + 两个枚举下拉（点输入框等时用） */
  const dismissAllFilterFloats = useCallback(() => {
    setFieldMenuOpenId(null);
    setLogicMenuOpen(false);
    setOpMenuRowId(null);
  }, []);

  useEffect(() => {
    setFieldMenuOpenId(null);
    setLogicMenuOpen(false);
    setOpMenuRowId(null);
  }, [fieldFilterResetSignal]);

  /** 打开「选择字段」列表时收起「所有/任一」「等于」 */
  useEffect(() => {
    if (fieldMenuOpenId !== null) {
      setLogicMenuOpen(false);
      setOpMenuRowId(null);
    }
  }, [fieldMenuOpenId]);

  /** 打开「所有/任一」时收起字段列表与「等于」 */
  useEffect(() => {
    if (logicMenuOpen) {
      setFieldMenuOpenId(null);
      setOpMenuRowId(null);
    }
  }, [logicMenuOpen]);

  /** 打开「等于」时收起字段列表与「所有/任一」 */
  useEffect(() => {
    if (opMenuRowId !== null) {
      setFieldMenuOpenId(null);
      setLogicMenuOpen(false);
    }
  }, [opMenuRowId]);

  const patchRow = useCallback(
    (id: string, patch: Partial<FieldFilterCondition>) => {
      onConditionsChange(
        conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
    },
    [conditions, onConditionsChange],
  );

  const removeRow = useCallback(
    (id: string) => {
      if (conditions.length <= 1) {
        setFieldMenuOpenId(null);
        onConditionsChange([]);
        return;
      }
      setFieldMenuOpenId((prev) => (prev === id ? null : prev));
      onConditionsChange(conditions.filter((c) => c.id !== id));
    },
    [conditions, onConditionsChange],
  );

  const addRow = useCallback(() => {
    onConditionsChange([...conditions, createEmptyFieldCondition()]);
  }, [conditions, onConditionsChange]);

  const toggleFieldMenuFor = useCallback((id: string) => {
    setFieldMenuOpenId((prev) => (prev === id ? null : id));
  }, []);

  const toggleOpMenuFor = useCallback((id: string) => {
    setOpMenuRowId((prev) => (prev === id ? null : id));
  }, []);

  const closeOpMenuIfRow = useCallback((id: string) => {
    setOpMenuRowId((prev) => (prev === id ? null : prev));
  }, []);

  return (
    <PopoverWrapper>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-input"
            disabled={disabled}
          >
            <Filter className="size-3.5 opacity-70" aria-hidden />
            <span>筛选</span>
            {activeCount > 0 ? (
              <span className="tabular-nums rounded bg-primary/15 px-1.5 py-0 text-[11px] font-medium text-primary">
                {activeCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(100vw-1.5rem,32rem)] p-4 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              设置筛选条件
            </span>
            {conditions.length >= 2 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">符合以下</span>
                <FilterEnumDropdown
                  value={logic}
                  options={LOGIC_OPTIONS}
                  onChange={(v) => onLogicChange(v)}
                  isOpen={logicMenuOpen}
                  onRequestToggle={() =>
                    setLogicMenuOpen((prev) => !prev)
                  }
                  onRequestClose={() => setLogicMenuOpen(false)}
                  onPointerDownCapture={() => {
                    setFieldMenuOpenId(null);
                    setOpMenuRowId(null);
                  }}
                  buttonClassName={cn(
                    filterSelectTriggerClass,
                    "inline-flex h-8 w-[4.25rem] max-w-[4.25rem] shrink-0 items-center justify-between gap-1 rounded-md border border-border px-1.5 text-left text-sm text-foreground [&_span]:min-w-0 [&_span]:truncate",
                    logicMenuOpen && "border-primary",
                  )}
                  aria-label="条件组合方式（所有：同时满足；任一：满足其一）"
                />
                <span className="text-muted-foreground">条件</span>
              </div>
            ) : null}
          </div>

          <div className="flex max-h-[min(50vh,320px)] flex-col gap-2 overflow-y-auto pr-0.5">
            {conditions.length === 0
              ? null
              : conditions.map((row) => (
                  <FieldFilterConditionRow
                    key={row.id}
                    row={row}
                    filterableFields={filterableFields}
                    isFieldMenuOpen={fieldMenuOpenId === row.id}
                    isOpMenuOpen={opMenuRowId === row.id}
                    onToggleFieldMenu={toggleFieldMenuFor}
                    onToggleOpMenu={toggleOpMenuFor}
                    onCloseFieldMenu={closeFieldMenu}
                    onCloseOpMenu={closeOpMenuIfRow}
                    closeEnumDropdowns={closeEnumDropdowns}
                    onOpEnumPointerDownCapture={onOpEnumPointerDownCapture}
                    dismissAllFilterFloats={dismissAllFilterFloats}
                    patchRow={patchRow}
                    onRemoveRow={removeRow}
                  />
                ))}
          </div>

          <button
            type="button"
            className="mt-3 flex items-center gap-1 text-sm text-primary hover:underline"
            onPointerDownCapture={dismissAllFilterFloats}
            onClick={addRow}
          >
            <Plus className="size-4" />
            添加条件
          </button>
        </PopoverContent>
      </Popover>
    </PopoverWrapper>
  );
}
