import { Suspense, lazy } from "react";
import { AdminSidebar, type AdminSection } from "../components/admin/AdminSidebar";
import { useSectionRoute } from "@/hooks/useSectionRoute";
import { useTrackSection } from "@/hooks/useUsageTracker";

const AdminOverviewPanel = lazy(() =>
  import("../components/admin/AdminOverviewPanel").then((m) => ({
    default: m.AdminOverviewPanel,
  }))
);
const AdminUsersPanel = lazy(() =>
  import("../components/admin/AdminUsersPanel").then((m) => ({ default: m.AdminUsersPanel }))
);
const AdminFeaturesPanel = lazy(() =>
  import("../components/admin/AdminFeaturesPanel").then((m) => ({
    default: m.AdminFeaturesPanel,
  }))
);
const AdminMetricsPanel = lazy(() =>
  import("../components/admin/AdminMetricsPanel").then((m) => ({
    default: m.AdminMetricsPanel,
  }))
);
const AdminAuditPanel = lazy(() =>
  import("../components/admin/AdminAuditPanel").then((m) => ({ default: m.AdminAuditPanel }))
);
const SettingsPanel = lazy(() =>
  import("../components/leader/SettingsPanel").then((m) => ({ default: m.SettingsPanel }))
);

const ADMIN_SECTIONS = [
  "overview",
  "users",
  "features",
  "metrics",
  "audit",
  "settings",
] as const satisfies readonly AdminSection[];

const SECTION_TITLES: Record<AdminSection, { title: string; subtitle: string }> = {
  overview: {
    title: "Admin Overview",
    subtitle: "System health, adoption, and quick links",
  },
  users: {
    title: "Users",
    subtitle: "Create, edit roles, and enable or disable accounts",
  },
  features: {
    title: "Features",
    subtitle: "Toggle experimental features and hide capabilities per role",
  },
  metrics: {
    title: "Usage Metrics",
    subtitle: "How real people use the system",
  },
  audit: {
    title: "Audit Log",
    subtitle: "Recent activity across all maps",
  },
  settings: {
    title: "Settings",
    subtitle: "Workspace preferences and experimental features",
  },
};

export function AdminDashboardPage() {
  const [activeSection, setActiveSection] = useSectionRoute(
    "/app/admin",
    ADMIN_SECTIONS,
    "overview"
  );
  useTrackSection(activeSection);

  const { title, subtitle } = SECTION_TITLES[activeSection];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <AdminSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

      <div className="flex-1 min-w-0 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted mt-1">{subtitle}</p>
          </div>

          <Suspense fallback={<p className="text-muted">Loading...</p>}>
            {activeSection === "overview" && <AdminOverviewPanel onNavigate={setActiveSection} />}
            {activeSection === "users" && <AdminUsersPanel />}
            {activeSection === "features" && <AdminFeaturesPanel />}
            {activeSection === "metrics" && <AdminMetricsPanel />}
            {activeSection === "audit" && <AdminAuditPanel />}
            {activeSection === "settings" && <SettingsPanel />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
