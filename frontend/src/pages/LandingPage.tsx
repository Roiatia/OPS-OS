import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-brand-700 text-white">
      <header className="w-full">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">O</span>
            OPS-OS
          </div>
          {user ? (
            <Link
              to="/app"
              className="px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-slate-100 transition"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <span className="inline-block px-3 py-1 rounded-full bg-white/10 text-xs font-medium mb-6">
            Graphics Team · Workflow Demo
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
            Run the OPS Graphics team without spreadsheets
          </h1>
          <p className="text-slate-300 text-lg mt-6 max-w-2xl mx-auto">
            A single system for mapping inspectors, QA and team leaders — track every map from
            intake to approval with the right access for each role.
          </p>

          <div className="mt-10 flex items-center justify-center gap-3">
            <Link
              to={user ? "/app" : "/login"}
              className="px-6 py-3 rounded-xl bg-white text-brand-700 font-semibold hover:bg-slate-100 transition shadow-lg"
            >
              {user ? "Go to dashboard" : "Sign in to get started"}
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-center gap-2">
            {FLOW.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full bg-white/10 text-sm">{step}</span>
                {i < FLOW.length - 1 && <span className="text-slate-500">→</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="grid gap-5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur"
              >
                <h3 className="font-semibold text-lg">{f.title}</h3>
                <p className="text-slate-300 text-sm mt-2 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-6 text-center text-slate-400 text-sm">
          OPS-OS — internal operations system
        </div>
      </footer>
    </div>
  );
}
