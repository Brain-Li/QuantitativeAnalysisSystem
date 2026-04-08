import { filterSortStockRows } from "../utils/tableDataPipeline";
import type { StockData } from "../types";
import type {
  FieldFilterCondition,
  FieldFilterLogic,
} from "../utils/fieldFilter";

export type WorkerRequest = {
  id: number;
  rows: StockData[];
  dateField: string | null;
  dateRange: { start: string; end: string };
  stockCodeField: string | null;
  selectedStocks: string[];
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
  totalScoreField?: string | null;
  fieldConditions?: FieldFilterCondition[];
  fieldLogic?: FieldFilterLogic;
};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const d = e.data;
  try {
    const filtered = filterSortStockRows({
      rows: d.rows,
      dateField: d.dateField,
      dateRange: d.dateRange,
      stockCodeField: d.stockCodeField,
      selectedStocks: d.selectedStocks,
      sortField: d.sortField,
      sortDirection: d.sortDirection,
      totalScoreField: d.totalScoreField ?? null,
      fieldConditions: d.fieldConditions,
      fieldLogic: d.fieldLogic,
    });
    (self as unknown as Worker).postMessage({
      id: d.id,
      ok: true,
      filtered,
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: d.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
