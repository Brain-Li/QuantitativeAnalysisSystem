import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { clearAllAuthStorage, readTokenSession, saveSession } from "./authStorage";

type AuthContextValue = {
  token: string | null;
  ready: boolean;
  login: (args: {
    token: string;
    expiresAtMs: number;
    username: string;
    rememberMe: boolean;
    autoLogin: boolean;
  }) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = readTokenSession();
    if (session) setToken(session.token);
    setReady(true);
  }, []);

  const login = useCallback((args: Parameters<AuthContextValue["login"]>[0]) => {
    saveSession({
      token: args.token,
      expiresAtMs: args.expiresAtMs,
      username: args.username,
      rememberMe: args.rememberMe,
      autoLogin: args.autoLogin,
    });
    setToken(args.token);
  }, []);

  const logout = useCallback(() => {
    clearAllAuthStorage();
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      ready,
      login,
      logout,
    }),
    [token, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
