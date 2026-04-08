import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  startTransition,
  useDeferredValue,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router";
import { Toaster } from "./components/ui/sonner";
import { DataImport } from "./components/DataImport";
import { DatasetManager } from "./components/DatasetManager";
import { DatasetSelector } from "./components/DatasetSelector";
import { DataTable } from "./components/DataTable";
import { StockTrendAnalysis } from "./components/StockTrendAnalysis";
import {
  Upload,
  Table as TableIcon,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Shield,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import type { Dataset, FieldConfig, StockData } from "./types";
import { useAuth } from "./auth/AuthContext";
import { CandlestickBrandIcon } from "./components/BrandMark";
import { cn } from "./components/ui/utils";
import { readServerApiToken } from "./api/serverToken";
import {
  deleteDatasetApi,
  listDatasetsApi,
  datasetsFromMetasOnly,
  logoutServerApi,
  invalidateDatasetQueryCaches,
  prefetchServerDataViews,
} from "./api/serverApi";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";
import { AdminAccountModule } from "./components/AdminAccountModule";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  clearDatasetsCache,
  saveDatasetsCache,
} from "./api/datasetsCache";
import { deleteLocalDatasetRows } from "./api/localDatasetIdb";
import {
  STORAGE_KEY_FIELD_CONFIGS,
  applyLogoutPersistenceRules,
  loadDataTableDateRangeFromStorage,
  loadDataTableSelectedStocksFromStorage,
  loadSelectedDatasetIdsFromStorage,
  saveSelectedDatasetIdsToStorage,
} from "./sessionPersistence";
import { getLast3DaysRange } from "./components/DateRangePickerButton";

type MenuType = "import" | "data" | "analysis" | "admin";

function isAbortLikeError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

function loadFieldConfigsFromStorage(): FieldConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FIELD_CONFIGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (c): c is FieldConfig =>
        c !== null &&
        typeof c === "object" &&
        typeof (c as FieldConfig).name === "string" &&
        typeof (c as FieldConfig).visible === "boolean" &&
        typeof (c as FieldConfig).order === "number"
    );
  } catch {
    return null;
  }
}

export default function QuantitativeApp() {
  const navigate = useNavigate();
  const { logout, token, user } = useAuth();
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const forceChangePwd = Boolean(user?.forcePasswordChange);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>(loadSelectedDatasetIdsFromStorage);
  /** 首次渲染即 true（会走服务端同步时），避免「暂无数据集」在缓存/接口返回前闪一下 */
  const [datasetsSyncing, setDatasetsSyncing] = useState(() =>
    Boolean(token && readServerApiToken()),
  );
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const [activeMenu, setActiveMenu] = useState<MenuType>("import");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (activeMenu === "admin" && user?.role !== "admin") {
      setActiveMenu("import");
    }
  }, [activeMenu, user?.role]);

  const selectedIdSet = useMemo(
    () => new Set(selectedDatasetIds),
    [selectedDatasetIds],
  );

  const datasetById = useMemo(() => {
    const m = new Map<string, (typeof datasets)[number]>();
    for (const d of datasets) m.set(d.id, d);
    return m;
  }, [datasets]);

  const mergedFields = useMemo(() => {
    const fieldSet = new Set<string>();
    for (const ds of datasets) {
      if (!selectedIdSet.has(ds.id)) continue;
      for (const f of ds.fields) fieldSet.add(f);
    }
    return Array.from(fieldSet);
  }, [datasets, selectedIdSet]);

  /** 仅内存中的行（不含 IndexedDB 大表）；避免大表 spread 造成额外中间分配 */
  const mergedData = useMemo<StockData[]>(() => {
    let size = 0;
    for (const ds of datasets) {
      if (!selectedIdSet.has(ds.id) || ds.storage === "indexeddb") continue;
      size += ds.data.length;
    }
    if (size === 0) return [];
    const out: StockData[] = new Array(size);
    let i = 0;
    for (const ds of datasets) {
      if (!selectedIdSet.has(ds.id) || ds.storage === "indexeddb") continue;
      const rows = ds.data;
      for (let j = 0; j < rows.length; j++) {
        out[i++] = rows[j]!;
      }
    }
    return out;
  }, [datasets, selectedIdSet]);

  const selectedLocalIdbDatasetIds = useMemo(
    () =>
      selectedDatasetIds.filter(
        (id) => datasetById.get(id)?.storage === "indexeddb",
      ),
    [datasetById, selectedDatasetIds],
  );

  const hasLocalIdbSelection = selectedLocalIdbDatasetIds.length > 0;

  const deferredMergedData = useDeferredValue(mergedData);
  const deferredMergedFields = useDeferredValue(mergedFields);

  const cacheSaveWarnedRef = useRef(false);
  /** 上一轮已知的数据集 id，用于识别「新导入」并自动加入股票列表/趋势分析的选中 */
  const prevDatasetIdsRef = useRef<Set<string>>(new Set());
  const reportCacheSave = useCallback((ok: boolean) => {
    if (ok) {
      cacheSaveWarnedRef.current = false;
      return;
    }
    if (cacheSaveWarnedRef.current) return;
    cacheSaveWarnedRef.current = true;
    toast.warning(
      "本地缓存写入失败（可能超出浏览器存储配额），刷新后将仍从网络加载数据。可尝试减少导入数据量或清理站点数据。",
      { duration: 8000 },
    );
  }, []);

  useEffect(() => {
    if (deferredMergedFields.length === 0) {
      startTransition(() => setFieldConfigs([]));
      return;
    }
    const stored = loadFieldConfigsFromStorage();
    const mergedFieldSet = new Set(deferredMergedFields);
    startTransition(() => {
      setFieldConfigs((prev) => {
        const source = stored && stored.length > 0 ? stored : prev;
        const kept = source.filter((c) => mergedFieldSet.has(c.name));
        const keptNames = new Set(kept.map((c) => c.name));
        const maxOrder = kept.length > 0 ? Math.max(...kept.map((c) => c.order)) : -1;
        const added: FieldConfig[] = deferredMergedFields
          .filter((f) => !keptNames.has(f))
          .map((f, i) => ({ name: f, visible: true, order: maxOrder + i + 1 }));
        const merged = [...kept, ...added].sort((a, b) => a.order - b.order);
        return merged.map((c, i) => ({ ...c, order: i }));
      });
    });
  }, [deferredMergedFields]);

  useEffect(() => {
    if (fieldConfigs.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY_FIELD_CONFIGS, JSON.stringify(fieldConfigs));
    } catch {
      /* ignore */
    }
  }, [fieldConfigs]);

  useEffect(() => {
    saveSelectedDatasetIdsToStorage(selectedDatasetIds);
  }, [selectedDatasetIds]);

  /**
   * 数据集列表变化时：
   * - 首次出现非空列表：若 localStorage 中已有有效选中则**恢复记忆**（刷新页面保持子集勾选）；若无或全部失效则默认全选。
   * - 新导入的数据集：自动加入选中，不取消用户已有勾选。
   * - 已删除的数据集：从选中移除。
   * - datasets 为空时不重置 prevDatasetIdsRef，避免「先空后有数据」时被误判为首次而强制全选。
   */
  useEffect(() => {
    if (datasets.length === 0) {
      return;
    }
    const currentIds = datasets.map((d) => d.id);
    const currentSet = new Set(currentIds);
    const prevKnown = prevDatasetIdsRef.current;
    const addedIds = currentIds.filter((id) => !prevKnown.has(id));
    prevDatasetIdsRef.current = currentSet;

    setSelectedDatasetIds((sel) => {
      const valid = sel.filter((id) => currentSet.has(id));
      const firstList = prevKnown.size === 0;
      if (firstList) {
        if (valid.length > 0) {
          const orderIdx = new Map(currentIds.map((id, i) => [id, i]));
          return [...valid].sort((a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0));
        }
        return currentIds;
      }
      if (addedIds.length > 0) {
        const merged = new Set([...valid, ...addedIds]);
        const next = currentIds.filter((id) => merged.has(id));
        if (
          next.length === sel.length &&
          next.every((id, i) => id === sel[i])
        ) {
          return sel;
        }
        return next;
      }
      if (valid.length !== sel.length) {
        return currentIds.filter((id) => valid.includes(id));
      }
      return sel;
    });
  }, [datasets]);

  const setSelectedDatasetIdsSafe = useCallback((action: SetStateAction<string[]>) => {
    startTransition(() => {
      setSelectedDatasetIds(action);
    });
  }, []);

  /** 有数据服务 Token 时从服务端同步（元数据来自 API，避免先读后写 IndexedDB 的额外等待与重复 setState） */
  useEffect(() => {
    if (!token || !readServerApiToken()) {
      setDatasetsSyncing(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setDatasetsSyncing(true);

    void (async () => {
      try {
        const metas = await listDatasetsApi(ac.signal);
        if (cancelled) return;

        const fresh = datasetsFromMetasOnly(metas);
        if (cancelled) return;
        setDatasets(fresh);
        if (fresh.length === 0) {
          setSelectedDatasetIds([]);
        }
        void saveDatasetsCache(fresh).then(reportCacheSave);
      } catch (e) {
        if (cancelled || isAbortLikeError(e)) return;
        if (
          !readServerApiToken() &&
          e instanceof Error &&
          e.message === "请先登录"
        ) {
          return;
        }
        console.error(e);
        toast.error(e instanceof Error ? e.message : "无法从数据服务同步数据集");
      } finally {
        if (!cancelled) setDatasetsSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [token]);

  const prefetchDistinctKey = useMemo(
    () => [...selectedDatasetIds].sort().join("\u0001"),
    [selectedDatasetIds],
  );

  const runServerDataPrefetch = useCallback(() => {
    if (!token || !readServerApiToken() || selectedDatasetIds.length === 0) return;
    const dr = loadDataTableDateRangeFromStorage();
    const range = dr ?? getLast3DaysRange();
    const stocks = loadDataTableSelectedStocksFromStorage() ?? [];
    prefetchServerDataViews({
      datasetIds: selectedDatasetIds,
      dateFrom: range.start || undefined,
      dateTo: range.end || undefined,
      codes: stocks.length > 0 ? stocks : undefined,
      prefetchAdmin: user?.role === "admin",
    });
  }, [token, selectedDatasetIds, user?.role]);

  useEffect(() => {
    runServerDataPrefetch();
  }, [token, prefetchDistinctKey, runServerDataPrefetch]);

  /** 停在趋势分析时利用空闲时间再预取列表/后台，减轻首次切出时的等待 */
  useEffect(() => {
    if (!token || !readServerApiToken() || selectedDatasetIds.length === 0) return;
    if (activeMenu !== "analysis") return;
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const run = () => runServerDataPrefetch();
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      timeoutHandle = window.setTimeout(run, 400);
    }
    return () => {
      if (idleHandle !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [activeMenu, token, prefetchDistinctKey, runServerDataPrefetch]);

  const handleDataImported = (dataset: Dataset) => {
    setDatasets((prev) => {
      const next = [...prev, dataset];
      if (readServerApiToken()) void saveDatasetsCache(next).then(reportCacheSave);
      return next;
    });
  };

  /** 与 listDatasetsApi 对齐；取消导入时服务端可能已写入部分数据，需刷新内存列表（否则只能刷新整页才看见） */
  const refreshDatasetListFromServer = useCallback(async () => {
    if (!readServerApiToken()) return;
    invalidateDatasetQueryCaches();
    try {
      const metas = await listDatasetsApi();
      const fresh = datasetsFromMetasOnly(metas);
      setDatasets(fresh);
      if (fresh.length === 0) {
        setSelectedDatasetIds([]);
      }
      void saveDatasetsCache(fresh).then(reportCacheSave);
    } catch (e) {
      if (isAbortLikeError(e)) return;
      console.error(e);
      toast.error(e instanceof Error ? e.message : "无法刷新数据集列表");
    }
  }, [reportCacheSave]);

  const handleSelectDataset = (datasetId: string) => {
    if (datasetId === "") {
      // 不做处理，保持当前选中状态
    } else {
      setSelectedDatasetIdsSafe((prev) => {
        if (prev[prev.length - 1] === datasetId) return prev;
        const filtered = prev.filter((id) => id !== datasetId);
        return [...filtered, datasetId];
      });
    }
  };

  const handleDeleteDataset = async (datasetId: string) => {
    if (readServerApiToken()) {
      try {
        await deleteDatasetApi(datasetId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
        return;
      }
    } else {
      const ds = datasets.find((d) => d.id === datasetId);
      if (ds?.storage === "indexeddb") {
        await deleteLocalDatasetRows(datasetId);
      }
    }
    setDatasets((prev) => {
      const next = prev.filter((ds) => ds.id !== datasetId);
      if (readServerApiToken()) {
        if (next.length === 0) void clearDatasetsCache();
        else void saveDatasetsCache(next).then(reportCacheSave);
      }
      return next;
    });
    setSelectedDatasetIdsSafe((prev) => prev.filter((id) => id !== datasetId));
    toast.success("数据集已删除");
  };

  const handleBatchDeleteDatasets = async (datasetIds: string[]) => {
    if (readServerApiToken()) {
      try {
        await Promise.all(datasetIds.map((id) => deleteDatasetApi(id)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "批量删除失败");
        return;
      }
    } else {
      await Promise.all(
        datasetIds.map(async (id) => {
          const ds = datasets.find((d) => d.id === id);
          if (ds?.storage === "indexeddb") {
            await deleteLocalDatasetRows(id);
          }
        }),
      );
    }
    setDatasets((prev) => {
      const next = prev.filter((ds) => !datasetIds.includes(ds.id));
      if (readServerApiToken()) {
        if (next.length === 0) void clearDatasetsCache();
        else void saveDatasetsCache(next).then(reportCacheSave);
      }
      return next;
    });
    setSelectedDatasetIdsSafe((prev) => prev.filter((id) => !datasetIds.includes(id)));
    toast.success(`已删除 ${datasetIds.length} 个数据集`);
  };

  const primaryDataset = useMemo(() => {
    if (selectedDatasetIds.length === 0) return undefined;
    return datasets.find((ds) => ds.id === selectedDatasetIds[selectedDatasetIds.length - 1]);
  }, [datasets, selectedDatasetIds]);

  const menuItems = useMemo(() => {
    const base: { id: MenuType; label: string; icon: typeof Upload }[] = [
      { id: "import", label: "数据导入", icon: Upload },
      { id: "data", label: "股票列表", icon: TableIcon },
      { id: "analysis", label: "趋势分析", icon: TrendingUp },
    ];
    if (user?.role === "admin") {
      base.push({ id: "admin", label: "管理后台", icon: Shield });
    }
    return base;
  }, [user?.role]);

  async function handleLogout() {
    try {
      await logoutServerApi();
    } catch {
      /* ignore */
    }
    void clearDatasetsCache();
    applyLogoutPersistenceRules();
    startTransition(() => {
      setSelectedDatasetIds([]);
    });
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background">
      <Toaster />

      <aside
        className={`${sidebarCollapsed ? "w-16" : "w-60"} shrink-0 bg-sidebar border-r border-sidebar-border flex h-full min-h-0 flex-col overflow-hidden transition-all duration-300`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
                <CandlestickBrandIcon />
              </div>
              <h1 className="text-base font-semibold text-foreground tracking-tight">量化分析</h1>
            </div>
          ) : (
            <div className="flex justify-center w-full">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <CandlestickBrandIcon />
              </div>
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              title="折叠菜单"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {sidebarCollapsed && (
          <div className="flex shrink-0 justify-center pt-3">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              title="展开菜单"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <nav className="min-h-0 flex-1 overflow-y-auto p-3 pt-2">
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenu === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setActiveMenu(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2">
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left outline-none transition-colors",
                    "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    "focus-visible:ring-2 focus-visible:ring-primary/30",
                    sidebarCollapsed && "justify-center px-0 py-2",
                  )}
                  title={sidebarCollapsed ? user.username : undefined}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary"
                    aria-hidden
                  >
                    {(user.displayName || user.username).trim().slice(0, 1).toUpperCase() || "?"}
                  </div>
                  {!sidebarCollapsed && (
                    <>
                      <div className="min-w-0 flex-1 truncate text-[14px] font-medium leading-tight">
                        {user.username}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={sidebarCollapsed ? "right" : "top"}
                align={sidebarCollapsed ? "end" : "center"}
                alignOffset={0}
                sideOffset={sidebarCollapsed ? 8 : 8}
                className={cn(
                  "w-[13.5rem] min-w-[13.5rem] max-w-[min(13.5rem,calc(100vw-1.5rem))] rounded-lg border-border/80 p-2 shadow-lg",
                  !sidebarCollapsed && "origin-bottom",
                )}
              >
                <DropdownMenuItem
                  className="gap-3 px-3 py-2.5 text-[14px] leading-snug"
                  onSelect={() => {
                    setChangePwdOpen(true);
                  }}
                >
                  <KeyRound className="h-[18px] w-[18px] shrink-0 opacity-80" />
                  修改密码
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 bg-border/70" />
                <DropdownMenuItem
                  variant="destructive"
                  className="gap-3 px-3 py-2.5 text-[14px] leading-snug"
                  onSelect={() => {
                    void handleLogout();
                  }}
                >
                  <LogOut className="h-[18px] w-[18px] shrink-0" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>

      <ChangePasswordDialog
        open={forceChangePwd || changePwdOpen}
        onOpenChange={(v) => {
          if (forceChangePwd && !v) return;
          setChangePwdOpen(v);
        }}
        forced={forceChangePwd}
      />

      <main
        className={cn(
          "flex-1 min-h-0 bg-background",
          activeMenu === "import" ? "flex flex-col overflow-hidden" : "overflow-auto",
        )}
      >
        <div
        className={cn(
          "container mx-auto px-6 py-6",
          activeMenu === "import" && "flex min-h-0 flex-1 flex-col",
        )}
      >
          {activeMenu === "import" && (
            <div className="flex min-h-0 flex-1 flex-col gap-6">
              <div className="flex shrink-0 items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl mb-1 leading-tight">数据导入</h2>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    导入Excel文件，支持.xls和.xlsx格式
                  </p>
                </div>
                <div className="flex-shrink-0 pt-1">
                  <DataImport
                    onDataImported={handleDataImported}
                    existingDatasetNames={datasets.map((d) => d.name)}
                    onServerImportSessionEnd={refreshDatasetListFromServer}
                  />
                </div>
              </div>

              <div className="relative min-h-0 flex-1 flex flex-col">
                {/* 数据导入 · 数据集管理：仅按名称搜索，不展示/不接入全局时间筛选 */}
                <DatasetManager
                  className="min-h-0 flex-1"
                  datasets={datasets}
                  listHydrating={datasetsSyncing && datasets.length === 0}
                  currentDatasetId={primaryDataset?.id}
                  onSelectDataset={handleSelectDataset}
                  onDeleteDataset={handleDeleteDataset}
                  onBatchDeleteDatasets={handleBatchDeleteDatasets}
                />
              </div>
            </div>
          )}

          {activeMenu === "data" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl mb-1 leading-tight">股票列表</h2>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    查看和管理已导入的股票数据
                  </p>
                </div>
                <div className="flex-shrink-0 pt-1">
                  <DatasetSelector
                    datasets={datasets}
                    selectedIds={selectedDatasetIds}
                    onSelectionChange={setSelectedDatasetIdsSafe}
                  />
                </div>
              </div>

              {datasets.length === 0 ? (
                <div className="flex items-center justify-center h-[600px] border-2 border-dashed border-border rounded-xl">
                  <div className="text-center text-muted-foreground">
                    <TableIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg mb-2 leading-snug">暂无数据</p>
                    <p className="text-[14px] leading-relaxed">请先导入Excel数据</p>
                  </div>
                </div>
              ) : selectedDatasetIds.length === 0 ? (
                <div className="flex items-center justify-center h-[600px] border-2 border-dashed border-border rounded-xl">
                  <div className="text-center text-muted-foreground">
                    <TableIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg mb-2 leading-snug">未选择数据集</p>
                    <p className="text-[14px] leading-relaxed">请在右上角选择至少一个数据集</p>
                  </div>
                </div>
              ) : (
                <DataTable
                  data={
                    readServerApiToken() && selectedDatasetIds.length > 0
                      ? []
                      : deferredMergedData
                  }
                  serverDatasetIds={
                    readServerApiToken() && selectedDatasetIds.length > 0
                      ? selectedDatasetIds
                      : undefined
                  }
                  localIdbDatasetIds={
                    !readServerApiToken() && selectedLocalIdbDatasetIds.length > 0
                      ? selectedLocalIdbDatasetIds
                      : undefined
                  }
                  fieldConfigs={fieldConfigs}
                  allFields={deferredMergedFields}
                  onFieldConfigsChange={setFieldConfigs}
                />
              )}
            </div>
          )}

          {activeMenu === "analysis" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl mb-1">趋势分析</h2>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    选择股票和指标，查看趋势变化
                  </p>
                </div>
                <div className="flex-shrink-0 pt-1">
                  <DatasetSelector
                    datasets={datasets}
                    selectedIds={selectedDatasetIds}
                    onSelectionChange={setSelectedDatasetIdsSafe}
                  />
                </div>
              </div>

              {selectedDatasetIds.length > 0 &&
              (readServerApiToken() ||
                mergedData.length > 0 ||
                hasLocalIdbSelection) ? (
                <StockTrendAnalysis
                  data={
                    readServerApiToken() && selectedDatasetIds.length > 0
                      ? []
                      : deferredMergedData
                  }
                  allFields={deferredMergedFields}
                  serverDatasetIds={
                    readServerApiToken() && selectedDatasetIds.length > 0
                      ? selectedDatasetIds
                      : undefined
                  }
                  localIdbDatasetIds={
                    !readServerApiToken() && selectedLocalIdbDatasetIds.length > 0
                      ? selectedLocalIdbDatasetIds
                      : undefined
                  }
                />
              ) : (
                <div className="flex items-center justify-center h-[600px] border-2 border-dashed border-border rounded-xl">
                  <div className="text-center text-muted-foreground">
                    <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg mb-2">暂无数据</p>
                    <p className="text-sm">
                      {datasets.length === 0 ? "请先导入Excel数据" : "请在右上角选择至少一个数据集"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeMenu === "admin" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl mb-1 leading-tight">管理后台</h2>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  账号管理与操作日志
                </p>
              </div>
              <AdminAccountModule />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
