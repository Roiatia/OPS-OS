import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setAuthToken } from "../api";
import type { User } from "../types";
import type { Permission } from "../lib/permissions";

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

  async function loginDemo(email: string) {
    const { token, user } = await api.demoLogin(email);
    setAuthToken(token);
    setUser(user);
  }

  async function loginGoogle(credential: string) {
    const { token, user } = await api.googleLogin(credential);
    setAuthToken(token);
    setUser(user);
  }

  function logout() {
    setAuthToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginDemo, loginGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function hasRole(user: User, ...roles: string[]) {
  return roles.some((r) => user.roles.includes(r as User["roles"][number]));
}

/** True when the user holds at least one of the given permissions. */
export function hasPermission(
  user: User | null | undefined,
  ...perms: Permission[]
): boolean {
  if (!user?.permissions) return false;
  return perms.some((p) => user.permissions!.includes(p));
}
