import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAuthToken } from "../api";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  loginDemo: (email: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("ops_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .getMe()
      .then(({ user }) => setUser(user))
      .catch(() => setAuthToken(null))
      .finally(() => setLoading(false));
  }, []);

  const loginDemo = useCallback(async (email: string) => {
    const { token, user } = await api.demoLogin(email);
    setAuthToken(token);
    setUser(user);
  }, []);

  const loginGoogle = useCallback(async (credential: string) => {
    const { token, user } = await api.googleLogin(credential);
    setAuthToken(token);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  // Stable value identity so consumers don't re-render on unrelated parent
  // renders — only when user/loading actually change.
  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, loginDemo, loginGoogle, logout }),
    [user, loading, loginDemo, loginGoogle, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function hasRole(user: User, ...roles: string[]) {
  return roles.some((r) => user.roles.includes(r as User["roles"][number]));
}
