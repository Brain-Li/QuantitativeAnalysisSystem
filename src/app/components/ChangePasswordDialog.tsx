import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { changePasswordApi } from "../api/serverApi";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { isValidNewPassword, newPasswordHint } from "../utils/passwordRules";
import { useNavigate } from "react-router";
import { cn } from "./ui/utils";

/** 与管理后台「新建账号」输入框一致：聚焦主色边框，无 ring-[3px] 大光晕 */
const accountFormInputClass =
  "box-border h-8 w-full min-w-0 border border-solid border-border bg-background px-2 py-1 text-sm md:text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary";

const passwordToggleBtnClass =
  "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 首次登录强制改密：不允许关闭弹窗 */
  forced?: boolean;
};

export function ChangePasswordDialog({ open, onOpenChange, forced = false }: Props) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (!open) {
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      setShowOldPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    }
  }, [open]);

  const newOk = useMemo(() => isValidNewPassword(newPassword), [newPassword]);
  const canSubmit = useMemo(() => {
    if (!oldPassword || submitting) return false;
    if (!newOk) return false;
    if (newPassword === oldPassword) return false;
    if (newPassword !== confirm) return false;
    return true;
  }, [oldPassword, newPassword, confirm, newOk, submitting]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await changePasswordApi(oldPassword, newPassword);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("密码修改成功，请重新登录");
      logout();
      onOpenChange(false);
      navigate("/login", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (forced && !v) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        className={cn("sm:max-w-md", forced && "[&>button:last-child]:hidden")}
        onPointerDownOutside={(e) => {
          if (forced) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (forced) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{forced ? "请修改初始密码" : "修改密码"}</DialogTitle>
          <DialogDescription>
            {forced
              ? "管理员已重置您的密码，请设置新密码后继续使用系统。"
              : "修改成功后需重新登录。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2.5">
            <Label htmlFor="pwd-old">原密码</Label>
            <div className="relative">
              <Input
                id="pwd-old"
                className={cn(accountFormInputClass, "hide-native-password-reveal pr-10")}
                type={showOldPassword ? "text" : "password"}
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className={passwordToggleBtnClass}
                onClick={() => setShowOldPassword((v) => !v)}
                aria-label={showOldPassword ? "隐藏密码" : "显示密码"}
                aria-pressed={showOldPassword}
                disabled={submitting}
              >
                {showOldPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </div>
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="pwd-new">新密码</Label>
            <div className="relative">
              <Input
                id="pwd-new"
                className={cn(accountFormInputClass, "pr-10")}
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
                placeholder={newPasswordHint()}
              />
              <button
                type="button"
                className={passwordToggleBtnClass}
                onClick={() => setShowNewPassword((v) => !v)}
                aria-label={showNewPassword ? "隐藏密码" : "显示密码"}
                aria-pressed={showNewPassword}
                disabled={submitting}
              >
                {showNewPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </div>
            {newPassword.length > 0 && !newOk && (
              <p className="text-xs text-destructive">{newPasswordHint()}</p>
            )}
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="pwd-confirm">确认新密码</Label>
            <div className="relative">
              <Input
                id="pwd-confirm"
                className={cn(accountFormInputClass, "hide-native-password-reveal pr-10")}
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className={passwordToggleBtnClass}
                onClick={() => setShowConfirmPassword((v) => !v)}
                aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
                aria-pressed={showConfirmPassword}
                disabled={submitting}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </div>
            {confirm.length > 0 && confirm !== newPassword && (
              <p className="text-xs text-destructive">两次输入的新密码不一致</p>
            )}
            {newOk && newPassword === oldPassword && oldPassword.length > 0 && (
              <p className="text-xs text-destructive">新密码不能与原密码相同</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {!forced && (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
            )}
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  提交中
                </>
              ) : (
                "确认修改"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
