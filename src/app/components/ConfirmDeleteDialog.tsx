import { Button } from "./ui/button";

/** 与数据集删除等一致的简易确认层（非 Radix Dialog） */
export function ConfirmDeleteDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "删除",
  confirmDestructive = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  /** 主操作按钮文案，默认「删除」 */
  confirmLabel?: string;
  /** 是否使用危险按钮样式（红底），默认 true */
  confirmDestructive?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-50 mx-4 w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
        <h3 className="mb-2 text-base font-semibold leading-snug">{title}</h3>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant={confirmDestructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
