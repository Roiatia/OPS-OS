import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth, hasRole } from "../context/AuthContext";
import { ROLE_LABELS } from "../types";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const primaryRole = user.roles[0];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2 font-bold text-brand-700">
            <span className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center text-sm">
              O
            </span>
            OPS-OS
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted hidden sm:inline">
              {ROLE_LABELS[primaryRole]}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold">
                {user.name.charAt(0)}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{user.name}</span>
            </div>
            <button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="text-sm text-muted hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <Outlet context={{ user, hasRole: (...r: string[]) => hasRole(user, ...r) }} />
      </main>
    </div>
  );
}
