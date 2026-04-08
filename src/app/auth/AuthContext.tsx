import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearAllAuthStorage,
  mergeProfileIntoStoredSession,
  readTokenSession,
  saveSession,
  type StoredUserProfile,
} from "./authStorage";
import { fetchMeApi, invalidateDatasetQueryCaches } from "../api/serverApi";

type AuthContextValue = {
  token: string | null;
  user: StoredUserProfile | null;
  ready: boolean;
  login: (args: {
    token: string;
    expiresAtMs: number;
    username: string;
    rememberMe: boolean;
    autoLogin: boolean;
    profile: StoredUserProfile;
  }) => void;
  logout: () => void;
  /** 从服务端拉取最新资料并写回状态与本地存储（如管理员在后台修改了自己的姓名） */
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StoredUserProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = readTokenSession();
    if (session) {
      setToken(session.token);
      setUser(session.profile);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const me = await fetchMeApi(ac.signal);
        if (ac.signal.aborted) return;
        if (me) setUser(me);
      } catch (e) {
        if (ac.signal.aborted) return;
        console.error(e);
      }
    })();
    return () => ac.abort();
  }, [ready, token]);

  useEffect(() => {
    function on401() {
      invalidateDatasetQueryCaches();
      clearAllAuthStorage();
      setToken(null);
      setUser(null);
      const path = window.location.pathname;
      if (path !== "/login") {
        window.location.assign("/login");
      }
    }
    window.addEventListener("qas:auth-401", on401);
    return () => window.removeEventListener("qas:auth-401", on401);
  }, []);

  const login = useCallback((args: Parameters<AuthContextValue["login"]>[0]) => {
    invalidateDatasetQueryCaches();
    saveSession({
      token: args.token,
      expiresAtMs: args.expiresAtMs,
      username: args.username,
      rememberMe: args.rememberMe,
      autoLogin: args.autoLogin,
      profile: args.profile,
    });
    setToken(args.token);
    setUser(args.profile);
  }, []);

  const logout = useCallback(() => {
    invalidateDatasetQueryCaches();
    clearAllAuthStorage();
    setToken(null);
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    const me = await fetchMeApi();
    if (!me) return;
    setUser(me);
    mergeProfileIntoStoredSession(me);
  }, [token]);

  const value = useMemo(
    () => ({
      token,
      user,
      ready,
      login,
      logout,
      refreshProfile,
    }),
    [token, user, ready, login, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
