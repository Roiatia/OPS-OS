import { useAuth, hasRole } from "../context/AuthContext";
import { hasOpsManagerRole, hasSupervisorRole } from "../lib/roles";
import { LeaderDashboardPage } from "./LeaderDashboardPage";
import { OpsManagerDashboardPage } from "./OpsManagerDashboardPage";
import { InspectorDashboardPage, QaDashboardPage } from "./InspectorDashboardPage";
import { SupervisorDashboardPage } from "./SupervisorDashboardPage";

export function DashboardPage() {
  const { user } = useAuth();

  if (hasOpsManagerRole(user)) {
    return <OpsManagerDashboardPage />;
  }
  if (hasRole(user!, "GRAPHIC_TEAM_LEADER")) {
    return <LeaderDashboardPage />;
  }
  if (hasRole(user!, "MAPPING_INSPECTOR")) {
    return <InspectorDashboardPage />;
  }
  if (hasRole(user!, "GRAPHIC_QA")) {
    return <QaDashboardPage />;
  }
  if (hasSupervisorRole(user)) {
    return <SupervisorDashboardPage />;
  }

  return (
    <div className="text-muted">
      No dashboard configured for your role. Contact your administrator.
    </div>
  );
}
