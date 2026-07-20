import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../context/AuthContext";
import { useConfigQuery, useDemoUsersQuery } from "../hooks/queries";
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
  if (label.includes("OPS Manager")) return 0;
  if (label.includes("Shift Leader")) return 1;
  if (label.includes("Supervisor")) return 2;
  if (label.includes("Leader") && label.includes("Graphic")) return 3;
  if (label.includes("Inspector")) return 4;
  if (label.includes("QA")) return 5;
  return 6;
}

export function LoginPage() {
  const { user, loginDemo, loginGoogle } = useAuth();
  const navigate = useNavigate();
  const { data: config } = useConfigQuery();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);

  // Show the picker whenever DEMO_MODE isn't explicitly disabled.
  const showDemoAccounts = config?.demoMode !== false;

  const {
    data: demoUsers = [],
    isLoading: demoUsersLoading,
    isError: demoUsersError,
  } = useDemoUsersQuery(showDemoAccounts);

  useEffect(() => {
    if (user) navigate("/app", { replace: true });
  }, [user, navigate]);

  const hints: DemoHint[] = useMemo(() => {
    const raw =
      demoUsers.length > 0
        ? demoUsers.map((u) => ({
            email: u.email,
            name: u.name,
            label: u.roles.map((r) => r.label).join(" · ") || "Demo user",
          }))
        : KNOWN_DEMO_USERS;
    return raw.slice().sort((a, b) => {
      const byRole = roleRank(a.label) - roleRank(b.label);
      return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
    });
  }, [demoUsers]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return hints;
    return hints.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.email.toLowerCase().includes(q) ||
        h.label.toLowerCase().includes(q)
    );
  }, [filter, hints]);

  // Only flag the fallback list once the fetch has actually failed to deliver
  // live users — not while the first request (or its retries) is still in
  // flight — so the badge is a true "backend unreachable" signal.
  const usingFallback = demoUsersError || (!demoUsersLoading && demoUsers.length === 0);

  async function enterAs(email: string) {
    setError("");
    setLoadingEmail(email);
    try {
      await loginDemo(email);
    } catch (err) {
      const msg = (err as Error).message;
      // One automatic retry — backend may still be coming up after a restart
      if (/500|unavailable|restarting|Cannot reach/i.test(msg)) {
        try {
          await new Promise((r) => setTimeout(r, 800));
          await loginDemo(email);
          return;
        } catch (err2) {
          setError((err2 as Error).message);
          return;
        }
      }
      setError(msg);
    } finally {
      setLoadingEmail(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-brand-50 via-white to-orange-50">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block hover:opacity-90 transition-opacity">
            <OriientLogo size="lg" className="justify-center mx-auto" />
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-6">Welcome back</h1>
          <p className="text-muted mt-2">Pick a demo user to enter the workspace</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-brand-600/5 p-6 sm:p-8 border border-border">
          {error && (
            <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
          )}

          {showDemoAccounts && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  All demo users ({hints.length})
                </p>
                {usingFallback && (
                  <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    Showing fallback list
                  </span>
                )}
              </div>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search name, email, or role…"
                autoFocus
                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              <div className="space-y-1 max-h-[min(28rem,55vh)] overflow-y-auto pr-1 -mx-1 px-1">
                {filtered.map((h) => {
                  const busy = loadingEmail === h.email;
                  return (
                    <button
                      key={h.email}
                      type="button"
                      disabled={Boolean(loadingEmail)}
                      onClick={() => void enterAs(h.email)}
                      className="w-full flex items-center justify-between gap-3 text-left text-sm px-3 py-2.5 rounded-xl hover:bg-brand-50 transition border border-transparent hover:border-brand-100 disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-800 truncate">{h.name}</span>
                        <span className="block text-xs text-slate-500 truncate">{h.email}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs text-muted">{h.label}</span>
                        <span className="block text-[11px] font-semibold text-brand-700 mt-0.5">
                          {busy ? "Signing in…" : "Enter →"}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="text-sm text-muted text-center py-8">No users match “{filter}”.</p>
                )}
              </div>
            </div>
          )}

          {!showDemoAccounts && (
            <p className="text-sm text-muted text-center">
              Demo login is disabled. Use Google sign-in if configured.
            </p>
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
