import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { OriientLogo } from "../components/OriientLogo";

const FEATURES = [
  {
    title: "One source of truth",
    body: "Every map lives as a single record instead of scattered spreadsheets — status, owner and history in one place.",
  },
  {
    title: "Role-based access",
    body: "Team Leader, Mapping Inspector and Graphic QA each get their own view and permissions.",
  },
  {
    title: "Full workflow tracking",
    body: "Follow each map through prep, QA upload approval, field work, polish and final QA — with a clear activity log.",
  },
];

const FLOW = ["Intake", "Prep", "QA Upload", "Field", "Polish", "QA Review", "Approved"];

export function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="w-full border-b border-border bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <OriientLogo size="md" />
          {user ? (
            <Link
              to="/app"
              className="px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition shadow-sm shadow-brand-600/20"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold hover:bg-brand-50 transition"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-orange-50" />
          <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
            <span className="inline-block px-4 py-1.5 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold mb-6">
              Graphics Team · Workflow Platform
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto text-charcoal">
              Indoor operations, without the guesswork
            </h1>
            <p className="text-muted text-lg mt-6 max-w-2xl mx-auto leading-relaxed">
              Oriient OPS gives your graphics team a single workspace to assign maps, track
              workflow, and keep every role in sync — from intake to approval.
            </p>

            <div className="mt-10 flex items-center justify-center gap-3">
              <Link
                to={user ? "/app" : "/login"}
                className="px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition shadow-lg shadow-brand-600/25"
              >
                {user ? "Go to dashboard" : "Sign in to get started"}
              </Link>
            </div>

            <div className="mt-14 flex flex-wrap items-center justify-center gap-2">
              {FLOW.map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-full bg-white border border-brand-100 text-sm text-slate-700 shadow-sm">
                    {step}
                  </span>
                  {i < FLOW.length - 1 && <span className="text-brand-300">→</span>}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24 pt-8">
          <div className="grid gap-5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-white border border-border rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-brand-200 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center mb-4">
                  <div className="w-3 h-3 rounded-full bg-brand-600" />
                </div>
                <h3 className="font-semibold text-lg text-slate-900">{f.title}</h3>
                <p className="text-muted text-sm mt-2 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="max-w-6xl mx-auto px-6 py-6 text-center text-muted text-sm">
          © Oriient — Operations Platform
        </div>
      </footer>
    </div>
  );
}
