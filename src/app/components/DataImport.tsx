import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload } from "lucide-react";
import { Button } from "./ui/button";
import type { StockData, Dataset } from "../types";
import { readServerApiToken } from "../api/serverToken";
import { uploadExcelToServer } from "../api/serverApi";
import {
  ImportProgressDialog,
  type ImportLine,
} from "./ImportProgressDialog";
import {
  LOCAL_IDB_ROW_THRESHOLD,
  deleteLocalDatasetRows,
  saveLocalDatasetRows,
} from "../api/localDatasetIdb";
import { toast } from "sonner";

interface DataImportProps {
  onDataImported: (dataset: Dataset) => void;
  existingDatasetNames: string[];
  /** 服务端导入会话结束（成功/失败/取消）后拉齐列表，避免取消后服务端已有部分数据但前端未刷新 */
  onServerImportSessionEnd?: () => void | Promise<void>;
}

function newLineId() {
  return crypto.randomUUID();
}

function readFileAsBinaryString(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsBinaryString(file);
  });
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

/** 服务端多文件上传并发数（平衡总耗时与浏览器/服务端内存、连接数） */
const SERVER_UPLOAD_CONCURRENCY = 2;

export function DataImport({
  onDataImported,
  existingDatasetNames,
  onServerImportSessionEnd,
}: DataImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressRunning, setProgressRunning] = useState(false);
  const [progressMode, setProgressMode] = useState<"server" | "client">("server");
  const [importLines, setImportLines] = useState<ImportLine[]>([]);
  const importAbortRef = useRef<AbortController | null>(null);
  const importCancelledRef = useRef(false);

  const existingNamesSet = useMemo(
    () => new Set(existingDatasetNames),
    [existingDatasetNames],
  );

  const buildPlan = useCallback(
    (files: File[]) => {
      const lines: ImportLine[] = [];
      const tasks: { file: File; lineId: string }[] = [];

      for (const file of files) {
        const lineId = newLineId();
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension !== "xls" && extension !== "xlsx") {
          lines.push({
            id: lineId,
            fileName: file.name,
            status: "error",
            message: "仅支持.xls或.xlsx格式",
          });
          continue;
        }
        if (existingNamesSet.has(file.name)) {
          lines.push({
            id: lineId,
            fileName: file.name,
            status: "error",
            message: "同名数据集已存在",
          });
          continue;
        }
        lines.push({ id: lineId, fileName: file.name, status: "pending" });
        tasks.push({ file, lineId });
      }

      return { lines, tasks };
    },
    [existingNamesSet],
  );

  const setLine = useCallback((lineId: string, update: Partial<ImportLine>) => {
    setImportLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, ...update } : l)),
    );
  }, []);

  const finalizeCancelledImportLines = useCallback(() => {
    setImportLines((prev) =>
      prev.map((l) => {
        if (
          l.status === "success" ||
          l.status === "error" ||
          l.status === "cancelled"
        ) {
          return l;
        }
        if (l.status === "pending") {
          return { ...l, status: "cancelled", message: "未导入（已取消）" };
        }
        return {
          ...l,
          status: "cancelled",
          message: "已取消导入",
        };
      }),
    );
  }, []);

  const cancelImport = useCallback(() => {
    if (importCancelledRef.current) return;
    importCancelledRef.current = true;
    importAbortRef.current?.abort();
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const list = Array.from(files);
    const useServer = !!readServerApiToken();
    if (useServer) {
      void runServerUpload(list);
    } else {
      void runClientParse(list);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  async function runServerUpload(files: File[]) {
    const { lines, tasks } = buildPlan(files);
    if (lines.length === 0) return;

    importAbortRef.current = new AbortController();
    importCancelledRef.current = false;
    const signal = importAbortRef.current.signal;

    setImportLines(lines);
    setProgressMode("server");
    setProgressRunning(true);
    setProgressOpen(true);
    setUploading(true);

    try {
      let taskPtr = 0;
      async function runOneServerFile(task: { file: File; lineId: string }) {
        const { file, lineId } = task;
        if (importCancelledRef.current) {
          setLine(lineId, {
            status: "cancelled",
            message: "未导入（已取消）",
          });
          return;
        }
        setLine(lineId, { status: "active", message: undefined });
        try {
          const dataset = await uploadExcelToServer(file, signal);
          setLine(lineId, {
            status: "success",
            message: `共 ${dataset.dataCount} 条数据`,
          });
        } catch (err) {
          if (isAbortError(err) || signal.aborted) {
            setLine(lineId, {
              status: "cancelled",
              message: "已取消，部分可能已导入",
            });
            return;
          }
          console.error(err);
          setLine(lineId, {
            status: "error",
            message: err instanceof Error ? err.message : "上传失败",
          });
        }
      }
      async function worker() {
        while (true) {
          if (importCancelledRef.current) break;
          const i = taskPtr++;
          if (i >= tasks.length) break;
          await runOneServerFile(tasks[i]!);
        }
      }
      const n = Math.min(SERVER_UPLOAD_CONCURRENCY, Math.max(1, tasks.length));
      await Promise.all(Array.from({ length: n }, () => worker()));
    } finally {
      if (importCancelledRef.current) {
        finalizeCancelledImportLines();
      }
      importAbortRef.current = null;
      importCancelledRef.current = false;
      setProgressRunning(false);
      setUploading(false);
      if (readServerApiToken()) {
        void Promise.resolve(onServerImportSessionEnd?.()).catch(() => {});
      }
    }
  }

  async function runClientParse(files: File[]) {
    const { lines, tasks } = buildPlan(files);
    if (lines.length === 0) return;

    importAbortRef.current = null;
    importCancelledRef.current = false;

    setImportLines(lines);
    setProgressMode("client");
    setProgressRunning(true);
    setProgressOpen(true);
    setUploading(true);

    try {
      for (const { file, lineId } of tasks) {
        if (importCancelledRef.current) {
          setLine(lineId, {
            status: "cancelled",
            message: "未导入（已取消）",
          });
          continue;
        }
        setLine(lineId, { status: "active", message: undefined });
        try {
          const data = await readFileAsBinaryString(file);
          if (importCancelledRef.current) {
            setLine(lineId, {
              status: "cancelled",
              message: "已取消导入",
            });
            break;
          }
          const workbook = XLSX.read(data, { type: "binary" });

          if (importCancelledRef.current) {
            setLine(lineId, {
              status: "cancelled",
              message: "已取消导入",
            });
            break;
          }

          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];

          const jsonData: StockData[] = XLSX.utils.sheet_to_json(worksheet, {
            raw: false,
            dateNF: "yyyy-mm-dd",
          });

          if (jsonData.length === 0) {
            setLine(lineId, { status: "error", message: "文件中没有数据" });
            continue;
          }

          const fields = Object.keys(jsonData[0]);

          const baseId = `dataset_${Date.now()}_${Math.random()}`;
          let dataset: Dataset;

          if (jsonData.length >= LOCAL_IDB_ROW_THRESHOLD) {
            const ok = await saveLocalDatasetRows(baseId, jsonData);
            if (importCancelledRef.current) {
              await deleteLocalDatasetRows(baseId);
              setLine(lineId, {
                status: "cancelled",
                message: "已取消，部分可能已导入",
              });
              break;
            }
            if (ok) {
              dataset = {
                id: baseId,
                name: file.name,
                importTime: new Date(),
                dataCount: jsonData.length,
                fields,
                data: [],
                storage: "indexeddb",
              };
            } else {
              toast.warning(
                "无法写入本地数据库，已改为在内存中保留全表（可能占用较多内存）。",
                { duration: 6000 },
              );
              dataset = {
                id: baseId,
                name: file.name,
                importTime: new Date(),
                dataCount: jsonData.length,
                fields,
                data: jsonData,
                storage: "inline",
              };
            }
          } else {
            if (importCancelledRef.current) {
              setLine(lineId, {
                status: "cancelled",
                message: "已取消导入",
              });
              break;
            }
            dataset = {
              id: baseId,
              name: file.name,
              importTime: new Date(),
              dataCount: jsonData.length,
              fields,
              data: jsonData,
              storage: "inline",
            };
          }

          if (importCancelledRef.current) {
            if (dataset.storage === "indexeddb") {
              await deleteLocalDatasetRows(baseId);
            }
            setLine(lineId, {
              status: "cancelled",
              message: "已取消，部分可能已导入",
            });
            break;
          }

          onDataImported(dataset);
          setLine(lineId, {
            status: "success",
            message: `共 ${jsonData.length} 条数据`,
          });
        } catch (error) {
          console.error("Excel解析错误:", error);
          setLine(lineId, {
            status: "error",
            message:
              error instanceof Error ? error.message : "文件解析或读取失败",
          });
        }
      }
    } finally {
      if (importCancelledRef.current) {
        finalizeCancelledImportLines();
      }
      importCancelledRef.current = false;
      setProgressRunning(false);
      setUploading(false);
    }
  }

  return (
    <>
      <ImportProgressDialog
        open={progressOpen}
        onOpenChange={setProgressOpen}
        lines={importLines}
        running={progressRunning}
        mode={progressMode}
        onCancel={progressRunning ? cancelImport : undefined}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xls,.xlsx"
        onChange={handleFileSelect}
        className="hidden"
        multiple
        disabled={uploading}
      />
      <Button
        onClick={() => fileInputRef.current?.click()}
        size="default"
        disabled={uploading}
      >
        <Upload className="mr-2 h-4 w-4" />
        {uploading ? "处理中…" : "选择Excel文件（可多选）"}
      </Button>
    </>
  );
}
