import { Navigate } from "react-router-dom";
import { useAuth, hasRole } from "../context/AuthContext";
import { hasOpsManagerRole, hasSuperAdminRole, hasSupervisorRole } from "../lib/roles";
import { loadWorkspaceSettings } from "../components/leader/SettingsPanel";

/** Redirects `/app` to the current user's default role-prefixed section. */
export function DashboardPage() {
  const { user } = useAuth();

  if (!user) return null;

  const preferMaps = loadWorkspaceSettings().defaultViewMaps;

  if (hasSuperAdminRole(user)) {
    return <Navigate to="/app/admin/overview" replace />;
  }
  if (hasOpsManagerRole(user)) {
    return <Navigate to={preferMaps ? "/app/ops/maps" : "/app/ops/hub"} replace />;
  }
  if (hasRole(user, "GRAPHIC_TEAM_LEADER")) {
    return <Navigate to="/app/leader/maps" replace />;
  }
  if (hasRole(user, "MAPPING_INSPECTOR")) {
    return <Navigate to="/app/inspector" replace />;
  }
  if (hasRole(user, "GRAPHIC_QA")) {
    return <Navigate to="/app/qa" replace />;
  }
  if (hasSupervisorRole(user)) {
    return <Navigate to="/app/supervisor/hub" replace />;
  }

  return (
    <div className="text-muted">
      No dashboard configured for your role. Contact your administrator.
    </div>
  );
}
