import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MapDetailPage } from "./pages/MapDetailPage";
import { Layout } from "./components/Layout";
import { api } from "./api";

/** Redirects unauthenticated users to the login page. */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Defines public and authenticated application routes. */
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
        <Route path="maps/:id" element={<MapDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Root app: OAuth provider, router, and auth wrapper. */
export default function App() {
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  // Client id comes from the API so demo mode can run without Google configured.
  useEffect(() => {
    api.getConfig().then((c) => setGoogleClientId(c.googleClientId));
  }, []);

  const inner = (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );

  // Wrap with GoogleOAuthProvider only when a client id exists (otherwise demo login only).
  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <BrowserRouter>{inner}</BrowserRouter>
      </GoogleOAuthProvider>
    );
  }

  return <BrowserRouter>{inner}</BrowserRouter>;
}
