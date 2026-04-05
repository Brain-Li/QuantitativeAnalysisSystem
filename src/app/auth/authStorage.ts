import { clearServerApiToken } from "../api/serverToken";

const K = {
  TOKEN: "qas_auth_token",
  EXPIRES_AT: "qas_auth_expires_at",
  USERNAME: "qas_auth_saved_username",
} as const;

function pickStorage(rememberMe: boolean, autoLogin: boolean): Storage {
  if (rememberMe && autoLogin) return localStorage;
  return sessionStorage;
}

export function clearAllAuthStorage(): void {
  clearServerApiToken();
  [localStorage, sessionStorage].forEach((s) => {
    Object.values(K).forEach((key) => s.removeItem(key));
  });
}

export function saveSession(params: {
  token: string;
  expiresAtMs: number;
  username: string;
  rememberMe: boolean;
  autoLogin: boolean;
}): void {
  clearAllAuthStorage();
  const store = pickStorage(params.rememberMe, params.autoLogin);
  store.setItem(K.TOKEN, params.token);
  store.setItem(K.EXPIRES_AT, String(params.expiresAtMs));
  if (params.rememberMe) {
    localStorage.setItem(K.USERNAME, params.username);
  }
}

/** 先读 session（同标签刷新），再读 local（若曾使用「记住」类能力写入） */
export function readTokenSession(): { token: string; expiresAtMs: number } | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const token = store.getItem(K.TOKEN);
      const exp = store.getItem(K.EXPIRES_AT);
      if (token && exp) {
        const expiresAtMs = Number(exp);
        if (Number.isFinite(expiresAtMs) && Date.now() < expiresAtMs) {
          return { token, expiresAtMs };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
