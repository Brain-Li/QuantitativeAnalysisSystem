import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, User } from "lucide-react";
import { useAuth } from "./AuthContext";
import { loginServerApi } from "../api/serverApi";
import { Toaster } from "../components/ui/sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { CandlestickBrandIcon } from "../components/BrandMark";
import { cn } from "../components/ui/utils";
import "./login-page.css";

/** 会话有效期（与数据服务 Token 一致：8 小时） */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export default function LoginPage() {
  const { token, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const userInputRef = useRef<HTMLInputElement | null>(null);
  const passInputRef = useRef<HTMLInputElement | null>(null);

  /** 浏览器自动填充只改 DOM，受控组件 state 可能仍是空串，需同步后才能通过校验 */
  const syncAutofillFromDom = useCallback(() => {
    const u = userInputRef.current;
    const p = passInputRef.current;
    if (u && u.value.length > 0) {
      setUsername((prev) => (u.value !== prev ? u.value : prev));
    }
    if (p && p.value.length > 0) {
      setPassword((prev) => (p.value !== prev ? p.value : prev));
    }
  }, []);

  useEffect(() => {
    if (!ready || token) return;
    syncAutofillFromDom();
    const timers = [0, 50, 200, 500].map((ms) =>
      window.setTimeout(syncAutofillFromDom, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [ready, token, syncAutofillFromDom]);

  function clearLoginError() {
    setLoginError(null);
  }

  function handleUsernameInput(e: React.ChangeEvent<HTMLInputElement>) {
    setUsername(e.target.value);
    clearLoginError();
  }

  function handlePasswordInput(e: React.ChangeEvent<HTMLInputElement>) {
    setPassword(e.target.value);
    clearLoginError();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || submitLock.current) return;

    /** 提交瞬间以 DOM 为准（自动填充常不同步到 React state，部分浏览器读 value 也晚于首屏） */
    const uRaw = userInputRef.current?.value ?? username;
    const pRaw = passInputRef.current?.value ?? password;
    const usernameTrim = uRaw.trim();
    setUsername(uRaw);
    setPassword(pRaw);

    if (usernameTrim.length === 0 && pRaw.length === 0) {
      setLoginError("请输入用户名和密码");
      return;
    }
    if (usernameTrim.length === 0) {
      setLoginError("请输入用户名");
      return;
    }
    if (pRaw.length === 0) {
      setLoginError("请输入密码");
      return;
    }

    submitLock.current = true;
    setLoading(true);
    setLoginError(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const serverRes = await loginServerApi(usernameTrim, pRaw, abortRef.current.signal);

      if (!serverRes.ok) {
        setLoginError(serverRes.message);
        return;
      }

      const expiresAtMs = Date.now() + SESSION_TTL_MS;
      login({
        token: serverRes.token,
        expiresAtMs,
        username: usernameTrim,
        rememberMe: false,
        autoLogin: false,
        profile: {
          username: serverRes.user.username,
          displayName: serverRes.user.displayName,
          role: serverRes.user.role,
          forcePasswordChange: serverRes.user.forcePasswordChange,
        },
      });
      navigate(from, { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/failed to fetch|network|fetch|load failed|connrefused/i.test(raw)) {
        setLoginError(
          "无法连接数据服务。请在项目根目录执行 npm run dev:all，或另开终端进入 server 目录执行 npm run dev（监听 8787）。",
        );
      } else {
        setLoginError(raw || "网络异常");
      }
    } finally {
      setLoading(false);
      submitLock.current = false;
    }
  }

  if (!ready) {
    return (
      <div className="relative flex h-dvh min-h-0 w-full items-center justify-center overflow-hidden bg-[#F7F9FB]">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,var(--secondary)_0%,transparent_40%)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,var(--muted)_0%,transparent_40%)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-20 top-56 h-[375px] w-96 rounded-full bg-secondary opacity-20 blur-[64px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-10 top-[22rem] h-80 w-80 rounded-full bg-[color-mix(in_srgb,var(--primary)_18%,var(--secondary))] opacity-30 blur-[64px]"
          aria-hidden
        />
        <Loader2
          className="relative h-8 w-8 animate-spin text-primary"
          aria-hidden
        />
      </div>
    );
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  const fieldClass =
    "h-auto min-h-[50px] rounded-lg border-0 bg-[#F2F4F6] py-3.5 pl-11 pr-4 font-['Inter',sans-serif] text-[15px] leading-[1.47] text-[#434654] shadow-none placeholder:text-[rgba(115,118,134,0.65)] placeholder:text-[15px] focus-visible:ring-2 focus-visible:ring-primary/25";

  const year = new Date().getFullYear();

  return (
    <div className="relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-[#F7F9FB] font-['Inter',sans-serif] text-[#191C1E]">
      <Toaster
        className="login-toaster"
        position="top-center"
        richColors
        toastOptions={{
          duration: 4200,
        }}
      />

      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,var(--secondary)_0%,transparent_40%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,var(--muted)_0%,transparent_40%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-20 top-[222px] h-[375px] w-96 rounded-full bg-secondary opacity-20 blur-[64px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute right-10 top-[22rem] h-[313px] w-80 rounded-full bg-[color-mix(in_srgb,var(--primary)_18%,var(--secondary))] opacity-30 blur-[64px]"
        aria-hidden
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
        <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-[clamp(1.5rem,8vh,137px)]">
          <div className="flex w-full max-w-[448px] flex-col gap-10 rounded-[12px] border border-[rgba(195,197,215,0.15)] bg-[rgba(255,255,255,0.8)] px-8 pb-12 pt-10 shadow-[0px_20px_40px_0px_rgba(25,28,30,0.06)] backdrop-blur-[24px] sm:px-14 sm:pb-[72px] sm:pt-14">
          <div className="flex flex-col items-center gap-6 self-stretch">
            <div className="flex w-12 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[var(--primary-gradient-end)] py-3 shadow-[0px_4px_6px_-4px_rgb(21_93_252/0.2),0px_10px_15px_-3px_rgb(21_93_252/0.2)]">
              <CandlestickBrandIcon className="h-[18px] w-[18px]" />
            </div>
            <h1 className="text-center font-['Manrope',sans-serif] text-[22px] font-extrabold leading-[1.27] tracking-[-0.02em] text-[#191C1E] sm:text-[24px] sm:leading-[1.25]">
              Quantitative Analysis
            </h1>
          </div>

          <form
            className="flex flex-col gap-6 self-stretch"
            onSubmit={handleSubmit}
            noValidate
          >
            {loginError && (
              <div
                className="flex items-center justify-center gap-2 self-stretch rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-3 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                role="alert"
              >
                <AlertCircle
                  className="size-[15px] shrink-0 text-[#DC2626]"
                  strokeWidth={2}
                  aria-hidden
                />
                <p className="font-['Inter',sans-serif] text-[14px] font-medium leading-[1.43] text-[#DC2626]">
                  {loginError}
                </p>
              </div>
            )}

            <div className="flex flex-col items-end gap-2 self-stretch">
              <Label
                htmlFor="login-user"
                className="w-full text-left font-['Inter',sans-serif] text-[13px] font-semibold leading-[1.38] tracking-[0.04em] text-[#434654]"
              >
                用户名
              </Label>
              <div className="relative w-full">
                <User
                  className="pointer-events-none absolute left-[17px] top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#737686]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <Input
                  ref={userInputRef}
                  id="login-user"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={handleUsernameInput}
                  onInput={handleUsernameInput}
                  placeholder="请输入用户名"
                  disabled={loading}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 self-stretch pb-6">
              <div className="flex items-center px-1">
                <Label
                  htmlFor="login-pass"
                  className="font-['Inter',sans-serif] text-[13px] font-semibold leading-[1.38] tracking-[0.04em] text-[#434654]"
                >
                  密码
                </Label>
              </div>
              <div className="relative w-full">
                <Lock
                  className="pointer-events-none absolute left-[19px] top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#737686]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <Input
                  ref={passInputRef}
                  id="login-pass"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={handlePasswordInput}
                  onInput={handlePasswordInput}
                  placeholder="请输入密码"
                  disabled={loading}
                  className={cn(fieldClass, "pr-12")}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[#737686] transition-colors hover:bg-black/[0.04] hover:text-[#434654] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-[17px] w-[17px]" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Eye className="h-[17px] w-[17px]" strokeWidth={1.75} aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="default"
              disabled={loading}
              className={cn(
                "relative h-auto min-h-[52px] w-full cursor-pointer gap-2 rounded-lg border-0 !bg-[linear-gradient(170deg,var(--primary)_0%,var(--primary-gradient-end)_100%)] px-0 py-3.5 font-['Manrope',sans-serif] text-[15px] font-bold leading-snug !text-primary-foreground shadow-[0px_2px_4px_-2px_rgba(0,0,0,0.1),0px_4px_6px_-1px_rgba(0,0,0,0.1)] hover:!opacity-[0.97] disabled:!opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  登录中…
                </>
              ) : (
                <>
                  <span>登录</span>
                  <ArrowRight className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                </>
              )}
            </Button>
          </form>
        </div>
        </div>

        <footer className="relative flex shrink-0 flex-col items-center gap-4 self-stretch px-8 py-6 sm:py-8">
          <div
            className="flex flex-row flex-wrap items-center justify-center gap-x-8 gap-y-2"
            aria-label="页脚说明"
          >
            <span className="cursor-default select-none font-['Inter',sans-serif] text-[13px] font-normal uppercase leading-[1.38] tracking-[0.02em] text-[#64748B] opacity-85">
              隐私政策
            </span>
            <span className="cursor-default select-none font-['Inter',sans-serif] text-[13px] font-normal uppercase leading-[1.38] tracking-[0.02em] text-[#64748B] opacity-85">
              服务条款
            </span>
            <span className="cursor-default select-none font-['Inter',sans-serif] text-[13px] font-normal uppercase leading-[1.38] tracking-[0.02em] text-[#64748B] opacity-85">
              安全架构
            </span>
          </div>
          <p className="text-center font-['Inter',sans-serif] text-[13px] font-semibold leading-[1.5] text-[#64748B]">
            © {year} Quantitative Analysis · 仅供研究与学习使用
          </p>
        </footer>
      </div>
    </div>
  );
}
