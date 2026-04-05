import { sha256Hex } from "./crypto";

/** 演示账号：admin / admin123（密码仅保存 SHA-256 摘要用于比对） */
const USER_PASSWORD_SHA256: Record<string, string> = {
  admin: "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
};

export type LoginApiError = "ACCOUNT_NOT_FOUND" | "WRONG_PASSWORD" | "TIMEOUT" | "ABORTED";

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; error: LoginApiError };

const REQUEST_TIMEOUT_MS = 15_000;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mock 登录：仅比对用户名与密码摘要；真实环境应替换为 HTTPS 接口。
 */
export async function loginWithPasswordHash(params: {
  username: string;
  passwordPlain: string;
  signal?: AbortSignal;
}): Promise<LoginResult> {
  const passwordHash = await sha256Hex(params.passwordPlain);
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const onUserAbort = () => ctrl.abort();
  params.signal?.addEventListener("abort", onUserAbort);

  try {
    await delay(400 + Math.random() * 400, ctrl.signal);

    const expected = USER_PASSWORD_SHA256[params.username.trim()];
    if (expected === undefined) {
      return { ok: false, error: "ACCOUNT_NOT_FOUND" };
    }
    if (expected !== passwordHash) {
      return { ok: false, error: "WRONG_PASSWORD" };
    }

    return {
      ok: true,
      token: randomToken(),
    };
  } catch (e) {
    if (params.signal?.aborted) return { ok: false, error: "ABORTED" };
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "TIMEOUT" };
    }
    throw e;
  } finally {
    window.clearTimeout(t);
    params.signal?.removeEventListener("abort", onUserAbort);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
