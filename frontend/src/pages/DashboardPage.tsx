import { useAuth, hasRole } from "../context/AuthContext";
import { LeaderDashboardPage } from "./LeaderDashboardPage";
import { InspectorDashboardPage, QaDashboardPage } from "./InspectorDashboardPage";

/** Routes the signed-in user to the dashboard for their role. */
export function DashboardPage() {
  const { user } = useAuth();

  if (hasRole(user!, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN")) {
    return <LeaderDashboardPage />;
  }
  if (hasRole(user!, "MAPPING_INSPECTOR")) {
    return <InspectorDashboardPage />;
  }
  if (hasRole(user!, "GRAPHIC_QA")) {
    return <QaDashboardPage />;
  }

  return (
    <div className="text-muted">
      No dashboard configured for your role. Contact your administrator.
    </div>
  );
}
