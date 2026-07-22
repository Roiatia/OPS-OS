import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth, hasRole } from "./context/AuthContext";
import { useConfigQuery } from "./hooks/queries";
import { hasOpsManagerRole, hasSupervisorRole, hasSuperAdminRole } from "./lib/roles";
import type { User } from "./types";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { Layout } from "@/components/common/Layout";

// Heavy, role-specific views are code-split so each role only downloads its own
// dashboard (and the map detail view) on demand, shrinking first paint.
const LeaderDashboardPage = lazy(() =>
  import("./pages/LeaderDashboardPage").then((m) => ({ default: m.LeaderDashboardPage }))
);
const OpsManagerDashboardPage = lazy(() =>
  import("./pages/OpsManagerDashboardPage").then((m) => ({ default: m.OpsManagerDashboardPage }))
);
const SupervisorDashboardPage = lazy(() =>
  import("./pages/SupervisorDashboardPage").then((m) => ({ default: m.SupervisorDashboardPage }))
);
const InspectorDashboardPage = lazy(() =>
  import("./pages/InspectorDashboardPage").then((m) => ({ default: m.InspectorDashboardPage }))
);
const QaDashboardPage = lazy(() =>
  import("./pages/InspectorDashboardPage").then((m) => ({ default: m.QaDashboardPage }))
);
const MapDetailPage = lazy(() =>
  import("./pages/MapDetailPage").then((m) => ({ default: m.MapDetailPage }))
);
const AdminDashboardPage = lazy(() =>
  import("./pages/AdminDashboardPage").then((m) => ({ default: m.AdminDashboardPage }))
);

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center text-muted">Loading...</div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Restricts a role-prefixed route to users with the matching role. */
function RoleRoute({
  allow,
  children,
}: {
  allow: (user: User) => boolean;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  // Super admin has all-access and bypasses every per-role route guard.
  if (hasSuperAdminRole(user)) return <>{children}</>;
  if (!allow(user)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route path="leader" element={<Navigate to="/app/leader/maps" replace />} />
        <Route
          path="leader/:section"
          element={
            <RoleRoute allow={(u) => hasRole(u, "GRAPHIC_TEAM_LEADER")}>
              <LeaderDashboardPage />
            </RoleRoute>
          }
        />

        <Route path="admin" element={<Navigate to="/app/admin/overview" replace />} />
        <Route
          path="admin/:section"
          element={
            <RoleRoute allow={hasSuperAdminRole}>
              <AdminDashboardPage />
            </RoleRoute>
          }
        />

        <Route path="ops" element={<Navigate to="/app/ops/hub" replace />} />
        <Route
          path="ops/:section"
          element={
            <RoleRoute allow={hasOpsManagerRole}>
              <OpsManagerDashboardPage />
            </RoleRoute>
          }
        />

        <Route path="supervisor" element={<Navigate to="/app/supervisor/hub" replace />} />
        <Route
          path="supervisor/:section"
          element={
            <RoleRoute allow={hasSupervisorRole}>
              <SupervisorDashboardPage />
            </RoleRoute>
          }
        />

        <Route
          path="inspector"
          element={
            <RoleRoute allow={(u) => hasRole(u, "MAPPING_INSPECTOR")}>
              <InspectorDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="qa"
          element={
            <RoleRoute allow={(u) => hasRole(u, "GRAPHIC_QA")}>
              <QaDashboardPage />
            </RoleRoute>
          }
        />

        <Route path="maps/:id" element={<MapDetailPage />} />

        {/* Unknown paths under /app (typos, stale deep links, extra segments)
            fall back to the index, which re-resolves the role default instead
            of rendering the Layout shell with an empty outlet. */}
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  const { data: config } = useConfigQuery();
  const googleClientId = config?.googleClientId ?? null;

  const inner = (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );

  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <BrowserRouter>{inner}</BrowserRouter>
      </GoogleOAuthProvider>
    );
  }

  return <BrowserRouter>{inner}</BrowserRouter>;
}
