import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth, hasRole } from "./context/AuthContext";
import { hasOpsManagerRole, hasSupervisorRole } from "./lib/roles";
import type { User } from "./types";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LeaderDashboardPage } from "./pages/LeaderDashboardPage";
import { OpsManagerDashboardPage } from "./pages/OpsManagerDashboardPage";
import { SupervisorDashboardPage } from "./pages/SupervisorDashboardPage";
import { InspectorDashboardPage, QaDashboardPage } from "./pages/InspectorDashboardPage";
import { MapDetailPage } from "./pages/MapDetailPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { Layout } from "@/components/common/Layout";
import { api } from "./api";

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
  if (!allow(user)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
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

        <Route
          path="admin/users"
          element={
            <RoleRoute allow={hasOpsManagerRole}>
              <AdminUsersPage />
            </RoleRoute>
          }
        />

        <Route path="maps/:id" element={<MapDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => setGoogleClientId(c.googleClientId));
  }, []);

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
