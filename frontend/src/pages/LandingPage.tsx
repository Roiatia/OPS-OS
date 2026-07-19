import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { OriientLogo } from "@/components/common/OriientLogo";

export function LandingPage() {
  const { logout } = useAuth();

  function goToSignIn() {
    // Always require email sign-in — don't skip into the CRM
    logout();
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="w-full border-b border-border bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <OriientLogo size="md" />
          <Link
            to="/login"
            onClick={goToSignIn}
            className="px-5 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold hover:bg-brand-50 transition"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center">
        <section className="relative overflow-hidden w-full">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-orange-50" />
          <div className="relative max-w-6xl mx-auto px-6 py-24 text-center">
            <span className="inline-block px-4 py-1.5 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold mb-6">
              OPS Team
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto text-charcoal">
              Oriient OPS
            </h1>

            <div className="mt-10 flex items-center justify-center gap-3">
              <Link
                to="/login"
                onClick={goToSignIn}
                className="px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition shadow-lg shadow-brand-600/25"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
