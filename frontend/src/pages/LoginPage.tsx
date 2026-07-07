import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { OriientLogo } from "../components/OriientLogo";

const KNOWN_DEMO_EMAILS = [
  { email: "leader@ops-demo.local", label: "Graphic Team Leader" },
  { email: "inspector@ops-demo.local", label: "Mapping Inspector" },
  { email: "qa@ops-demo.local", label: "Graphic QA" },
];

export function LoginPage() {
  const { user, loginDemo, loginGoogle } = useAuth();
  const navigate = useNavigate();
  const [demoUsers, setDemoUsers] = useState<
    { email: string; name: string; roles: { label: string }[] }[]
  >([]);
  const [config, setConfig] = useState<{ demoMode: boolean; googleClientId: string | null } | null>(
    null
  );
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getConfig().then(setConfig);
    api.getDemoUsers().then(setDemoUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) navigate("/app", { replace: true });
  }, [user, navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setLoading(true);
    try {
      await loginDemo(email.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hints = demoUsers.length > 0
    ? demoUsers.map((u) => ({ email: u.email, label: u.roles.map((r) => r.label).join(" · ") }))
    : KNOWN_DEMO_EMAILS;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-brand-50 via-white to-orange-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block hover:opacity-90 transition-opacity">
            <OriientLogo size="lg" className="justify-center mx-auto" />
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-6">Welcome back</h1>
          <p className="text-muted mt-2">Sign in to your Oriient workspace</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-brand-600/5 p-8 border border-border">
          <form onSubmit={handleSignIn} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@ops-demo.local"
                autoFocus
                className="mt-1 w-full border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full px-4 py-3 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 transition disabled:opacity-50 shadow-sm shadow-brand-600/20"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
          )}

          {config?.demoMode && (
            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-xs text-muted mb-2">Demo accounts — click to fill:</p>
              <div className="space-y-1.5">
                {hints.map((h) => (
                  <button
                    key={h.email}
                    type="button"
                    onClick={() => setEmail(h.email)}
                    className="w-full flex items-center justify-between text-left text-sm px-3 py-2.5 rounded-xl hover:bg-brand-50 transition border border-transparent hover:border-brand-100"
                  >
                    <span className="font-medium text-slate-700">{h.email}</span>
                    <span className="text-muted text-xs">{h.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {config?.googleClientId && (
            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-muted mb-3 text-center">Or sign in with Google</p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={(res) => {
                    if (res.credential) {
                      loginGoogle(res.credential).catch((e) => setError((e as Error).message));
                    }
                  }}
                  onError={() => setError("Google sign-in failed")}
                  theme="outline"
                  size="large"
                  width="320"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
