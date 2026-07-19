import { Outlet, Link, useNavigate } from "react-router-dom";
import { hasSupervisorRole } from "@/lib/roles";
import { useAuth, hasRole } from "@/context/AuthContext";
import { OriientLogo } from "@/components/common/OriientLogo";
import { useRealtimeCacheBridge } from "@/hooks/useMapsRealtime";
import { ROLE_LABELS } from "@/types";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // One socket for the whole authed app — feeds the shared query cache.
  useRealtimeCacheBridge();

  if (!user) return null;

  const primaryRole = user.roles[0];
  const isLeader = hasRole(user, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN", "OPS_MANAGER_2");
  const isSupervisor = hasSupervisorRole(user);
  const useFullWidth = isLeader || isSupervisor;

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="bg-white border-b border-border sticky top-0 z-10 shadow-sm">
        <div
          className={`${useFullWidth ? "w-full" : "max-w-6xl mx-auto"} px-5 h-16 flex items-center justify-between`}
        >
          <Link to="/app" className="hover:opacity-90 transition-opacity">
            <OriientLogo size="md" />
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted hidden sm:inline px-3 py-1 rounded-full bg-slate-50">
              {ROLE_LABELS[primaryRole]}
            </span>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold ring-2 ring-brand-50">
                {user.name.charAt(0)}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{user.name}</span>
            </div>
            <button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="text-sm text-muted hover:text-brand-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full">
        {useFullWidth ? (
          <Outlet context={{ user, hasRole: (...r: string[]) => hasRole(user, ...r) }} />
        ) : (
          <div className="max-w-[1400px] mx-auto px-5 py-6">
            <Outlet context={{ user, hasRole: (...r: string[]) => hasRole(user, ...r) }} />
          </div>
        )}
      </main>
    </div>
  );
}
