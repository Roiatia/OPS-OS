import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useConfigQuery } from "../hooks/queries";
import { OriientLogo } from "@/components/common/OriientLogo";

/** Fallback when /auth/demo-users is unavailable — keep in sync with prisma/seed/seed.ts */
const KNOWN_DEMO_USERS = [
  { email: "leader@ops-demo.local", name: "Sarah Cohen", label: "Graphic Team Leader" },
  { email: "inspector@ops-demo.local", name: "David Levi", label: "Mapping Inspector" },
  { email: "inspector2@ops-demo.local", name: "Yossi Barak", label: "Mapping Inspector" },
  { email: "inspector3@ops-demo.local", name: "Noa Mizrahi", label: "Mapping Inspector" },
  { email: "inspector4@ops-demo.local", name: "Amir Goldberg", label: "Mapping Inspector" },
  { email: "qa@ops-demo.local", name: "Maya Rosen", label: "Graphic QA" },
  { email: "qa2@ops-demo.local", name: "Rina Shalev", label: "Graphic QA" },
  { email: "qa3@ops-demo.local", name: "Tomer Avivi", label: "Graphic QA" },
  { email: "supervisor@ops-demo.local", name: "Alex Ben-Ami", label: "Supervisor" },
  { email: "supervisor2@ops-demo.local", name: "Dana Weiss", label: "Supervisor Shift Leader" },
  { email: "supervisor3@ops-demo.local", name: "Noam Katz", label: "Supervisor" },
  { email: "supervisor4@ops-demo.local", name: "Lior Hadad", label: "Supervisor" },
  { email: "ops@ops-demo.local", name: "Rachel Ops", label: "OPS Manager" },
  { email: "ops2@ops-demo.local", name: "Miriam Levy", label: "OPS Manager 2" },
];

type DemoHint = { email: string; name: string; label: string };

function roleRank(label: string): number {
  if (label.includes("Leader") && label.includes("Graphic")) return 0;
  if (label.includes("OPS Manager")) return 1;
  if (label.includes("Inspector")) return 2;
  if (label.includes("QA")) return 3;
  if (label.includes("Shift Leader")) return 4;
  if (label.includes("Supervisor")) return 5;
  return 6;
}

export function LoginPage() {
  const { user, loginDemo, loginGoogle } = useAuth();
  const navigate = useNavigate();
  const [demoUsers, setDemoUsers] = useState<
    { email: string; name: string; roles: { label: string }[] }[]
  >([]);
  const { data: config } = useConfigQuery();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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

  const hints: DemoHint[] = (
    demoUsers.length > 0
      ? demoUsers.map((u) => ({
          email: u.email,
          name: u.name,
          label: u.roles.map((r) => r.label).join(" · ") || "Demo user",
        }))
      : KNOWN_DEMO_USERS
  ).slice().sort((a, b) => {
    const byRole = roleRank(a.label) - roleRank(b.label);
    return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
  });

  const showDemoAccounts = config?.demoMode === true;

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
                list={showDemoAccounts ? "demo-user-emails" : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@ops-demo.local"
                autoFocus
                autoComplete="username"
                className="mt-1 w-full border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              {showDemoAccounts && (
                <datalist id="demo-user-emails">
                  {hints.map((h) => (
                    <option key={h.email} value={h.email}>
                      {h.name} — {h.label}
                    </option>
                  ))}
                </datalist>
              )}
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

          {showDemoAccounts && (
            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-xs text-muted mb-2">
                Demo accounts ({hints.length}) — click to fill:
              </p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {hints.map((h) => (
                  <button
                    key={h.email}
                    type="button"
                    onClick={() => setEmail(h.email)}
                    className="w-full flex items-center justify-between gap-3 text-left text-sm px-3 py-2.5 rounded-xl hover:bg-brand-50 transition border border-transparent hover:border-brand-100"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-800 truncate">{h.name}</span>
                      <span className="block text-xs text-slate-500 truncate">{h.email}</span>
                    </span>
                    <span className="text-muted text-xs shrink-0 text-right">{h.label}</span>
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
