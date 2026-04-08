import { clearServerApiToken, saveServerApiToken } from "../api/serverToken";

const K = {
  TOKEN: "qas_auth_token",
  EXPIRES_AT: "qas_auth_expires_at",
  USERNAME: "qas_auth_saved_username",
  PROFILE: "qas_auth_profile",
} as const;

export type StoredUserProfile = {
  username: string;
  displayName: string;
  role: "admin" | "user";
  forcePasswordChange: boolean;
};

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
  profile: StoredUserProfile;
}): void {
  clearAllAuthStorage();
  saveServerApiToken(params.token);
  const store = pickStorage(params.rememberMe, params.autoLogin);
  store.setItem(K.TOKEN, params.token);
  store.setItem(K.EXPIRES_AT, String(params.expiresAtMs));
  store.setItem(K.PROFILE, JSON.stringify(params.profile));
  if (params.rememberMe) {
    localStorage.setItem(K.USERNAME, params.username);
  }
}

/** 在已有登录会话的存储中更新 profile（用于管理员改自己姓名等场景） */
export function mergeProfileIntoStoredSession(profile: StoredUserProfile): void {
  const json = JSON.stringify(profile);
  for (const store of [sessionStorage, localStorage]) {
    const token = store.getItem(K.TOKEN);
    if (token) {
      store.setItem(K.PROFILE, json);
      return;
    }
  }
}

export function readTokenSession(): {
  token: string;
  expiresAtMs: number;
  profile: StoredUserProfile | null;
} | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const token = store.getItem(K.TOKEN);
      const exp = store.getItem(K.EXPIRES_AT);
      const profileRaw = store.getItem(K.PROFILE);
      if (token && exp) {
        const expiresAtMs = Number(exp);
        if (Number.isFinite(expiresAtMs) && Date.now() < expiresAtMs) {
          let profile: StoredUserProfile | null = null;
          if (profileRaw) {
            try {
              const p = JSON.parse(profileRaw) as StoredUserProfile;
              if (p && typeof p.username === "string" && typeof p.role === "string") {
                profile = {
                  username: p.username,
                  displayName: typeof p.displayName === "string" ? p.displayName : "",
                  role: p.role === "admin" ? "admin" : "user",
                  forcePasswordChange: Boolean(p.forcePasswordChange),
                };
              }
            } catch {
              /* ignore */
            }
          }
          return { token, expiresAtMs, profile };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
