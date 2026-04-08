import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  RefreshCw,
  ScrollText,
  Shield,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListAuditLogs,
  adminListUsers,
  adminResetPassword,
  adminSetUserDisabled,
  adminUpdateUserDisplayName,
  type AdminUserRow,
  type AuditLogRow,
} from "../api/serverApi";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { isValidNewPassword } from "../utils/passwordRules";
import { cn } from "./ui/utils";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "./ui/tooltip";

/** 与股票列表「设置筛选条件」内输入框一致：聚焦时主色边框，无 ring-[3px] 大光晕 */
const createAccountInputClass =
  "box-border h-8 w-full min-w-0 border border-solid border-border bg-background px-2 py-1 text-sm md:text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary";

/** 与纯输入框区分：浅底、指针手势；箭头用 iconClassName 加大加亮 */
const createAccountSelectTriggerClass =
  "cursor-pointer border-solid border-border bg-muted/35 px-2 shadow-none transition-colors hover:bg-muted/50 " +
  "focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary " +
  "data-[state=open]:border-primary data-[state=open]:bg-muted/45";

type Tab = "accounts" | "logs";

/** 与股票列表 / 数据集管理分页选项一致 */
const ADMIN_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function AdminPaginationBar({
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  countLabel,
}: {
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  countLabel: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const renderPageButtons = () => {
    if (totalPages <= 1) return null;
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
      ) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages.map((p, idx) =>
      p === "..." ? (
        <span key={`ellipsis-${idx}`} className="select-none px-1.5 text-sm text-muted-foreground">
          …
        </span>
      ) : (
        <button
          key={p}
          type="button"
          onClick={() => onPageChange(p)}
          className={cn(
            "h-8 min-w-8 rounded px-1 text-sm transition-colors",
            currentPage === p
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-muted",
          )}
        >
          {p}
        </button>
      ),
    );
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
      <span className="text-muted-foreground tabular-nums">
        共 <span className="font-medium text-foreground">{totalCount}</span> {countLabel}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {totalPages > 1 && (
          <>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => onPageChange(currentPage - 1)}
                className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {renderPageButtons()}
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => onPageChange(currentPage + 1)}
                className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-1 text-muted-foreground">
                第 {currentPage}/{totalPages} 页
              </span>
            </div>
            <div className="hidden h-4 w-px bg-border sm:block" />
          </>
        )}
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap text-muted-foreground">每页</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              onPageSizeChange(Number(v));
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-[5.75rem] shrink-0 border-input bg-background px-2 text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {ADMIN_PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export function AdminAccountModule() {
  const { user: currentUser, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("accounts");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [cuName, setCuName] = useState("");
  const [cuDisplay, setCuDisplay] = useState("");
  const [cuRole, setCuRole] = useState<"admin" | "user">("user");
  const [cuPwd, setCuPwd] = useState("");
  const [cuAutoPwd, setCuAutoPwd] = useState(true);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUserRow | null>(null);
  const [edDisplay, setEdDisplay] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUserRow | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<AdminUserRow | null>(null);
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(10);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(10);
  const [logsTotal, setLogsTotal] = useState(0);

  const loadTab = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "accounts") {
        const list = await adminListUsers();
        setUsers(list);
      } else {
        const res = await adminListAuditLogs({ page: logPage, pageSize: logPageSize });
        setLogs(res.logs);
        setLogsTotal(res.total);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [tab, logPage, logPageSize]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  useEffect(() => {
    if (cuAutoPwd || !createOpen) setShowInitialPassword(false);
  }, [cuAutoPwd, createOpen]);

  const adminCount = useMemo(
    () => users.filter((u) => u.role === "admin" && !u.disabled).length,
    [users],
  );

  const accountTotalPages = Math.max(1, Math.ceil(users.length / accountPageSize));
  const paginatedUsers = useMemo(() => {
    const start = (accountPage - 1) * accountPageSize;
    return users.slice(start, start + accountPageSize);
  }, [users, accountPage, accountPageSize]);

  const logTotalPages = Math.max(1, Math.ceil(logsTotal / logPageSize));

  useEffect(() => {
    if (accountPage > accountTotalPages) {
      setAccountPage(accountTotalPages);
    }
  }, [accountPage, accountTotalPages]);

  useEffect(() => {
    if (logPage > logTotalPages) {
      setLogPage(logTotalPages);
    }
  }, [logPage, logTotalPages]);

  async function handleCreate() {
    const u = cuName.trim();
    const d = cuDisplay.trim();
    if (!u || !d) {
      toast.error("请填写用户名与姓名");
      return;
    }
    if (!cuAutoPwd) {
      if (!cuPwd || !isValidNewPassword(cuPwd)) {
        toast.error("密码至少 8 位且含字母与数字");
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await adminCreateUser({
        username: u,
        displayName: d,
        role: cuRole,
        ...(cuAutoPwd ? {} : { password: cuPwd }),
      });
      if (res.initialPassword) {
        void navigator.clipboard.writeText(res.initialPassword).catch(() => {});
        toast.success(`账号已创建。初始密码：${res.initialPassword}`, { duration: 12000 });
      } else {
        toast.success("账号已创建");
      }
      setCreateOpen(false);
      setCuName("");
      setCuDisplay("");
      setCuPwd("");
      setCuRole("user");
      setCuAutoPwd(true);
      await loadTab();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  function requestResetPassword(u: AdminUserRow) {
    setResetPasswordTarget(u);
  }

  async function toggleDisabled(u: AdminUserRow) {
    const next = !u.disabled;
    if (next && u.lockDisable) {
      toast.error("不能禁用系统内置管理员账号");
      return;
    }
    if (u.role === "admin" && next && adminCount <= 1) {
      toast.error("不能禁用最后一个管理员");
      return;
    }
    try {
      await adminSetUserDisabled(u.id, next);
      toast.success(next ? "已禁用" : "已启用");
      await loadTab();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  function isSelfRow(u: AdminUserRow): boolean {
    if (!currentUser?.username) return false;
    return u.username.toLowerCase() === currentUser.username.toLowerCase();
  }

  function openEditDisplayName(u: AdminUserRow) {
    setEditTarget(u);
    setEdDisplay(u.displayName);
    setEditOpen(true);
  }

  async function handleEditDisplayNameSave() {
    if (!editTarget) return;
    const d = edDisplay.trim();
    if (!d) {
      toast.error("请输入姓名");
      return;
    }
    setEditSubmitting(true);
    try {
      await adminUpdateUserDisplayName(editTarget.id, d);
      toast.success("姓名已更新");
      if (isSelfRow(editTarget)) {
        await refreshProfile();
      }
      setEditOpen(false);
      setEditTarget(null);
      await loadTab();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setEditSubmitting(false);
    }
  }

  function requestDeleteUser(u: AdminUserRow) {
    if (isSelfRow(u)) {
      toast.error("不能删除当前登录账号");
      return;
    }
    if (u.role === "admin" && !u.disabled && adminCount <= 1) {
      toast.error("不能删除最后一个未禁用的管理员");
      return;
    }
    setDeleteUserTarget(u);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setTab("accounts")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "accounts"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          账号管理
        </button>
        <button
          type="button"
          onClick={() => setTab("logs")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "logs"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          操作日志
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void loadTab()}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          {tab === "accounts" && (
            <Button type="button" size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              新建账号
            </Button>
          )}
        </div>
      </div>

      {tab === "accounts" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              账号列表
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left">
                        <th className="px-4 py-3 font-semibold">用户名</th>
                        <th className="px-4 py-3 font-semibold">姓名</th>
                        <th className="px-4 py-3 font-semibold">角色</th>
                        <th className="px-4 py-3 font-semibold">状态</th>
                        <th className="px-4 py-3 font-semibold">创建时间</th>
                        <th className="px-4 py-3 font-semibold text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-10 text-center text-sm text-muted-foreground"
                          >
                            暂无账号
                          </td>
                        </tr>
                      ) : (
                        paginatedUsers.map((u) => (
                      <tr key={u.id} className="border-b border-border/80">
                        <td className="px-4 py-2.5 font-medium">{u.username}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{u.displayName}</td>
                        <td className="px-4 py-2.5">{u.role === "admin" ? "管理员" : "普通用户"}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              "rounded px-2 py-0.5 text-xs",
                              u.disabled ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-700",
                            )}
                          >
                            {u.disabled ? "禁用" : "启用"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{u.createdAt}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              title="编辑姓名"
                              onClick={() => openEditDisplayName(u)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => requestResetPassword(u)}
                            >
                              重置密码
                            </Button>
                            <Button
                              type="button"
                              variant={u.disabled ? "default" : "outline"}
                              size="sm"
                              className="h-8"
                              disabled={
                                !u.disabled &&
                                (Boolean(u.lockDisable) ||
                                  (u.role === "admin" && adminCount <= 1))
                              }
                              title={
                                !u.disabled && u.lockDisable
                                  ? "系统内置管理员账号不可禁用"
                                  : !u.disabled && u.role === "admin" && adminCount <= 1
                                    ? "不能禁用最后一个管理员"
                                    : undefined
                              }
                              onClick={() => void toggleDisabled(u)}
                            >
                              {u.disabled ? "启用" : "禁用"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={
                                isSelfRow(u) ||
                                (u.role === "admin" && !u.disabled && adminCount <= 1)
                              }
                              title={
                                isSelfRow(u)
                                  ? "不能删除当前登录账号"
                                  : u.role === "admin" && !u.disabled && adminCount <= 1
                                    ? "不能删除最后一个未禁用的管理员"
                                    : "永久删除该账号"
                              }
                              onClick={() => requestDeleteUser(u)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <AdminPaginationBar
                  totalCount={users.length}
                  currentPage={accountPage}
                  pageSize={accountPageSize}
                  onPageChange={setAccountPage}
                  onPageSizeChange={(n) => {
                    setAccountPageSize(n);
                    setAccountPage(1);
                  }}
                  countLabel="个账号"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "logs" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              操作日志
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                <TooltipProvider delayDuration={300}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left">
                          <th className="px-4 py-3.5 font-semibold">时间</th>
                          <th className="px-4 py-3.5 font-semibold">账号</th>
                          <th className="px-4 py-3.5 font-semibold">操作</th>
                          <th className="px-4 py-3.5 font-semibold">详情</th>
                          <th className="px-4 py-3.5 font-semibold">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-10 text-center text-sm text-muted-foreground"
                            >
                              暂无操作日志
                            </td>
                          </tr>
                        ) : (
                          logs.map((l) => (
                            <tr key={l.id} className="border-b border-border/80">
                              <td className="whitespace-nowrap px-4 py-3.5 align-middle tabular-nums text-muted-foreground">
                                {l.createdAt}
                              </td>
                              <td className="px-4 py-3.5 align-middle">{l.username}</td>
                              <td className="px-4 py-3.5 align-middle">{l.action}</td>
                              <td className="max-w-[240px] px-4 py-3.5 align-middle text-muted-foreground">
                                <TooltipRoot>
                                  <TooltipTrigger asChild>
                                    <span className="block max-w-full cursor-default truncate">
                                      {l.detail}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    align="start"
                                    sideOffset={8}
                                    className={cn(
                                      "z-50 w-max max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover px-3 py-2.5 text-left text-sm font-normal leading-relaxed text-popover-foreground shadow-md",
                                      "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                                    )}
                                  >
                                    <span className="block whitespace-pre-wrap break-words">{l.detail}</span>
                                  </TooltipContent>
                                </TooltipRoot>
                              </td>
                              <td className="px-4 py-3.5 align-middle tabular-nums text-muted-foreground">
                                {l.ip || "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </TooltipProvider>
                <AdminPaginationBar
                  totalCount={logsTotal}
                  currentPage={logPage}
                  pageSize={logPageSize}
                  onPageChange={setLogPage}
                  onPageSizeChange={(n) => {
                    setLogPageSize(n);
                    setLogPage(1);
                  }}
                  countLabel="条日志"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建账号</DialogTitle>
          </DialogHeader>
          <form
            id="admin-create-account-form"
            className="space-y-5 py-1"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <div className="space-y-2.5">
              <Label htmlFor="create-account-username">用户名（全局唯一）</Label>
              <Input
                id="create-account-username"
                name="create-account-username"
                className={createAccountInputClass}
                value={cuName}
                onChange={(e) => setCuName(e.target.value)}
                placeholder="请输入"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="create-account-display-name">姓名</Label>
              <Input
                id="create-account-display-name"
                name="create-account-display-name"
                className={createAccountInputClass}
                value={cuDisplay}
                onChange={(e) => setCuDisplay(e.target.value)}
                placeholder="请输入"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2.5">
              <Label>角色</Label>
              <Select value={cuRole} onValueChange={(v) => setCuRole(v as "admin" | "user")}>
                <SelectTrigger
                  size="sm"
                  className={createAccountSelectTriggerClass}
                  iconClassName="size-[18px] opacity-90 text-muted-foreground"
                  aria-label="选择角色"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auto-pwd"
                checked={cuAutoPwd}
                onChange={(e) => setCuAutoPwd(e.target.checked)}
                className="rounded border-input"
              />
              <Label htmlFor="auto-pwd" className="font-normal cursor-pointer">
                自动生成初始密码
              </Label>
            </div>
            {!cuAutoPwd && (
              <div className="space-y-2.5">
                <Label htmlFor="create-account-initial-password">初始密码</Label>
                <div className="relative">
                  <Input
                    id="create-account-initial-password"
                    name="create-account-initial-password"
                    className={cn(createAccountInputClass, "pr-10")}
                    type={showInitialPassword ? "text" : "password"}
                    value={cuPwd}
                    onChange={(e) => setCuPwd(e.target.value)}
                    placeholder="至少 8 位，含字母与数字"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none"
                    onClick={() => setShowInitialPassword((v) => !v)}
                    aria-label={showInitialPassword ? "隐藏密码" : "显示密码"}
                    aria-pressed={showInitialPassword}
                  >
                    {showInitialPassword ? (
                      <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            )}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" form="admin-create-account-form" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑姓名</DialogTitle>
          </DialogHeader>
          <form
            id="admin-edit-display-form"
            className="space-y-4 py-1"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void handleEditDisplayNameSave();
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">用户名</Label>
              <p className="text-sm font-medium">{editTarget?.username ?? "—"}</p>
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="edit-account-display-name">姓名</Label>
              <Input
                id="edit-account-display-name"
                name="edit-account-display-name"
                className={createAccountInputClass}
                value={edDisplay}
                onChange={(e) => setEdDisplay(e.target.value)}
                placeholder="请输入"
                autoComplete="off"
              />
            </div>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={editSubmitting}
            >
              取消
            </Button>
            <Button type="submit" form="admin-edit-display-form" disabled={editSubmitting}>
              {editSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!resetPasswordTarget}
        onClose={() => setResetPasswordTarget(null)}
        onConfirm={() => {
          const u = resetPasswordTarget;
          if (!u) return;
          void (async () => {
            try {
              const pwd = await adminResetPassword(u.id);
              void navigator.clipboard.writeText(pwd).catch(() => {});
              toast.success(`密码已重置。新初始密码：${pwd}`, { duration: 12000 });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "重置失败");
            }
          })();
        }}
        title={
          resetPasswordTarget
            ? `确认重置「${resetPasswordTarget.username}」的密码？`
            : "确认重置密码？"
        }
        description="将生成新的初始密码，用户需使用新密码重新登录。是否继续？"
        confirmLabel="重置"
        confirmDestructive
      />

      <ConfirmDeleteDialog
        open={!!deleteUserTarget}
        onClose={() => setDeleteUserTarget(null)}
        onConfirm={() => {
          const u = deleteUserTarget;
          if (!u) return;
          void (async () => {
            try {
              await adminDeleteUser(u.id);
              toast.success("已删除该账号");
              await loadTab();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "删除失败");
            }
          })();
        }}
        title={deleteUserTarget ? `确认删除账号「${deleteUserTarget.username}」？` : "确认删除账号？"}
        description="删除后账号将无法恢复。是否继续？"
      />
    </div>
  );
}
