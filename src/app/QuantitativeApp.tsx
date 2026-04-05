import { useState, useMemo, useEffect } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import type { Dataset, FieldConfig, StockData } from "./types";
import { useAuth } from "./auth/AuthContext";
import { CandlestickBrandIcon } from "./components/BrandMark";
import { cn } from "./components/ui/utils";
import { readServerApiToken } from "./api/serverToken";
import { deleteDatasetApi, loadFullDatasetsFromServer } from "./api/serverApi";

type MenuType = "import" | "data" | "analysis";

const STORAGE_KEY_FIELD_CONFIGS = "datatable_field_configs_v1";

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
  const { logout, token } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const [activeMenu, setActiveMenu] = useState<MenuType>("import");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const mergedFields = useMemo(() => {
    const fieldSet = new Set<string>();
    datasets
      .filter((ds) => selectedDatasetIds.includes(ds.id))
      .forEach((ds) => ds.fields.forEach((f) => fieldSet.add(f)));
    return Array.from(fieldSet);
  }, [datasets, selectedDatasetIds]);

  const mergedData = useMemo<StockData[]>(() => {
    return datasets
      .filter((ds) => selectedDatasetIds.includes(ds.id))
      .flatMap((ds) => ds.data);
  }, [datasets, selectedDatasetIds]);

  useEffect(() => {
    if (mergedFields.length === 0) {
      setFieldConfigs([]);
      return;
    }
    const stored = loadFieldConfigsFromStorage();
    const mergedFieldSet = new Set(mergedFields);
    setFieldConfigs((prev) => {
      const source = stored && stored.length > 0 ? stored : prev;
      const kept = source.filter((c) => mergedFieldSet.has(c.name));
      const keptNames = new Set(kept.map((c) => c.name));
      const maxOrder = kept.length > 0 ? Math.max(...kept.map((c) => c.order)) : -1;
      const added: FieldConfig[] = mergedFields
        .filter((f) => !keptNames.has(f))
        .map((f, i) => ({ name: f, visible: true, order: maxOrder + i + 1 }));
      const merged = [...kept, ...added].sort((a, b) => a.order - b.order);
      return merged.map((c, i) => ({ ...c, order: i }));
    });
  }, [mergedFields]);

  useEffect(() => {
    if (fieldConfigs.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY_FIELD_CONFIGS, JSON.stringify(fieldConfigs));
    } catch {
      /* ignore */
    }
  }, [fieldConfigs]);

  /** 有数据服务 Token 时从服务端同步；依赖 token 以便重新登录后再次拉取（不仅靠组件重挂载） */
  useEffect(() => {
    if (!token || !readServerApiToken()) return;
    let cancelled = false;
    loadFullDatasetsFromServer()
      .then((list) => {
        if (!cancelled) setDatasets(list);
      })
      .catch((e) => {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "无法从数据服务同步数据集");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleDataImported = (dataset: Dataset) => {
    setDatasets((prev) => [...prev, dataset]);
  };

  const handleSelectDataset = (datasetId: string) => {
    if (datasetId === "") {
      // 不做处理，保持当前选中状态
    } else {
      setSelectedDatasetIds((prev) => {
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
    }
    setDatasets((prev) => prev.filter((ds) => ds.id !== datasetId));
    setSelectedDatasetIds((prev) => prev.filter((id) => id !== datasetId));
    toast.success("数据集已删除");
  };

  const handleBatchDeleteDatasets = async (datasetIds: string[]) => {
    if (readServerApiToken()) {
      try {
        for (const id of datasetIds) {
          await deleteDatasetApi(id);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "批量删除失败");
        return;
      }
    }
    setDatasets((prev) => prev.filter((ds) => !datasetIds.includes(ds.id)));
    setSelectedDatasetIds((prev) => prev.filter((id) => !datasetIds.includes(id)));
    toast.success(`已删除 ${datasetIds.length} 个数据集`);
  };

  const primaryDataset = useMemo(() => {
    if (selectedDatasetIds.length === 0) return undefined;
    return datasets.find((ds) => ds.id === selectedDatasetIds[selectedDatasetIds.length - 1]);
  }, [datasets, selectedDatasetIds]);

  const menuItems = [
    { id: "import" as MenuType, label: "数据导入", icon: Upload },
    { id: "data" as MenuType, label: "股票列表", icon: TableIcon },
    { id: "analysis" as MenuType, label: "趋势分析", icon: TrendingUp },
  ];

  function handleLogout() {
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

        <div className="shrink-0 border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors ${
              sidebarCollapsed ? "justify-center" : ""
            }`}
            title={sidebarCollapsed ? "退出登录" : undefined}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-sm">退出登录</span>}
          </button>
        </div>
      </aside>

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
                  />
                </div>
              </div>

              <DatasetManager
                className="min-h-0 flex-1"
                datasets={datasets}
                currentDatasetId={primaryDataset?.id}
                onSelectDataset={handleSelectDataset}
                onDeleteDataset={handleDeleteDataset}
                onBatchDeleteDatasets={handleBatchDeleteDatasets}
              />
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
                    onSelectionChange={setSelectedDatasetIds}
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
                  data={mergedData}
                  fieldConfigs={fieldConfigs}
                  allFields={mergedFields}
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
                    onSelectionChange={setSelectedDatasetIds}
                  />
                </div>
              </div>

              {mergedData.length > 0 ? (
                <StockTrendAnalysis data={mergedData} allFields={mergedFields} />
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
        </div>
      </main>
    </div>
  );
}
