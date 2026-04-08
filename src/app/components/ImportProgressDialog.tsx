import {
  Ban,
  CheckCircle2,
  Circle as CircleIcon,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { cn } from "./ui/utils";

export type ImportLineStatus =
  | "pending"
  | "active"
  | "success"
  | "error"
  | "cancelled";

export interface ImportLine {
  id: string;
  fileName: string;
  status: ImportLineStatus;
  message?: string;
}

interface ImportProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  lines: ImportLine[];
  running: boolean;
  mode: "server" | "client";
  onCancel?: () => void;
}

function doneCount(lines: ImportLine[]) {
  return lines.filter(
    (l) =>
      l.status === "success" ||
      l.status === "error" ||
      l.status === "cancelled",
  ).length;
}

function countByStatus(lines: ImportLine[]) {
  const success = lines.filter((l) => l.status === "success").length;
  const error = lines.filter((l) => l.status === "error").length;
  const cancelled = lines.filter((l) => l.status === "cancelled").length;
  return { success, error, cancelled };
}

export function ImportProgressDialog({
  open,
  onOpenChange,
  title = "导入进度",
  lines,
  running,
  mode,
  onCancel,
}: ImportProgressDialogProps) {
  const total = lines.length;
  const finished = doneCount(lines);
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);
  const { success: okCount, error: errCount, cancelled: cancelCount } =
    countByStatus(lines);
  const single = total === 1;

  const handleOpenChange = (next: boolean) => {
    if (!next && running) return;
    onOpenChange(next);
  };

  const description = running
    ? mode === "server"
      ? "上传并处理中…"
      : "本地解析中…"
    : single
      ? errCount > 0
        ? "导入失败"
        : cancelCount > 0
          ? "已取消导入"
          : "导入成功"
      : cancelCount === total
        ? "已全部取消"
        : errCount === 0 && cancelCount === 0
          ? "全部成功"
          : okCount === 0 && cancelCount === 0
            ? "全部失败"
            : [
                okCount > 0 ? `${okCount} 成功` : null,
                errCount > 0 ? `${errCount} 失败` : null,
                cancelCount > 0 ? `${cancelCount} 已取消` : null,
              ]
                .filter(Boolean)
                .join(" · ");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName="bg-black/60"
        className={cn(
          "gap-0 overflow-hidden p-0 sm:max-w-lg",
          "[&>button]:hidden",
        )}
        onPointerDownOutside={(e) => running && e.preventDefault()}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
      >
        <div
          className={cn(
            "border-b border-border/60 px-6 pt-5 pb-3",
            !running && single && "pb-2",
          )}
        >
          <DialogHeader className="gap-1 text-left">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Upload className="h-4 w-4" aria-hidden />
              </div>
              <DialogTitle>{title}</DialogTitle>
            </div>
            <DialogDescription className="text-[13px] leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              "space-y-1.5",
              running ? "mt-3" : single ? "mt-2" : "mt-3",
            )}
          >
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {finished} / {total} 已处理
              </span>
              <span>{pct}%</span>
            </div>
            <Progress
              value={pct}
              className={cn(
                "h-1.5",
                !running &&
                  pct === 100 &&
                  errCount === 0 &&
                  "bg-emerald-500/15 [&>[data-slot=progress-indicator]]:!bg-emerald-600",
                !running &&
                  errCount > 0 &&
                  "bg-amber-500/10 [&>[data-slot=progress-indicator]]:!bg-amber-600",
              )}
            />
          </div>
        </div>

        <div
          className={cn(
            "max-h-[min(48vh,280px)] overflow-y-auto px-6",
            running ? "py-3" : single ? "py-2.5" : "py-3",
          )}
          role="list"
          aria-label="文件导入列表"
        >
          <ul className={cn("space-y-2.5", single && "space-y-0")}>
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex gap-3 text-sm"
                role="listitem"
              >
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {line.status === "pending" && (
                    <CircleIcon className="h-4 w-4 text-muted-foreground/40" />
                  )}
                  {line.status === "active" && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  )}
                  {line.status === "success" && (
                    <CheckCircle2
                      className="h-4 w-4 text-primary"
                      aria-hidden
                    />
                  )}
                  {line.status === "error" && (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  {line.status === "cancelled" && (
                    <Ban className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    title={line.fileName}
                    className="break-words font-medium leading-snug text-foreground line-clamp-2 sm:line-clamp-none"
                  >
                    {line.fileName}
                  </p>
                  {line.message && (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                      {line.message}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {running && onCancel && (
          <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-3 sm:justify-center">
            <Button
              type="button"
              variant="outline"
              className="min-w-[120px] cursor-pointer"
              onClick={onCancel}
            >
              取消导入
            </Button>
          </DialogFooter>
        )}
        {!running && (
          <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-3 sm:justify-center">
            <Button
              type="button"
              className="min-w-[120px] cursor-pointer"
              onClick={() => onOpenChange(false)}
            >
              完成
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
