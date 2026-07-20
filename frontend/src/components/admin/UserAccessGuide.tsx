import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * In-app help panel for the User Access page. Mirrors docs/user-access-guide.md
 * so admins can understand roles vs. overrides without leaving the app.
 */
export function UserAccessGuide({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="User access guide"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-white px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">User access — quick guide</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            aria-label="Close guide"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 px-5 py-5 text-sm text-slate-700">
          <p>
            This page decides <strong>who can do what</strong> in OPS-OS. Every person
            has two tabs: <strong>Simple (roles)</strong> and{" "}
            <strong>Advanced (overrides)</strong>.
          </p>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Simple — Roles</h3>
            <p>
              Pick one or more <strong>ready-made roles</strong>. Each role is a bundle
              of permissions — this is all most users ever need.
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Assigning <strong>multiple roles</strong> is safe: the person gets the
              combination of everything those roles allow. Roles only ever add access —
              they never take it away.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Advanced — Overrides</h3>
            <p>Fine-tune one person, one permission at a time. Each has three states:</p>
            <ul className="space-y-1.5">
              <li className="flex gap-2">
                <span className="mt-0.5 inline-block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Default
                </span>
                <span>Inherit — use whatever the person's roles decide.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 inline-block rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Grant
                </span>
                <span>Give this permission even if no role includes it.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Deny
                </span>
                <span>Remove this permission even if a role includes it.</span>
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">How the final set is calculated</h3>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 text-[11px] leading-relaxed text-slate-100">
{`Effective = permissions from roles
          + granted overrides
          − denied overrides`}
            </pre>
            <p>
              <strong>Key rule:</strong> an override always wins over a role. A{" "}
              <strong>Deny</strong> removes a permission the role would otherwise give.
              If someone is missing an expected permission, check the Advanced tab for a
              Deny.
            </p>
            <p className="text-xs text-muted">
              The green dot means the permission is currently effective; the label below
              it explains why (role, override, or not granted).
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">You can't create a conflict</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Two roles can never contradict each other — they only add up.</li>
              <li>
                A permission can't be both Granted and Denied — the UI allows one state
                and the server rejects contradictions.
              </li>
              <li>The Effective list shown is exactly what the system enforces.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Safety guardrails</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>You can't remove your own admin access (Manage users).</li>
              <li>The system always keeps at least one admin.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Quick recipes</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Standard access:</strong> Simple tab → tick the role → Save.
              </li>
              <li>
                <strong>One extra ability:</strong> Advanced tab → set it to Grant → Save.
              </li>
              <li>
                <strong>Take one away:</strong> Advanced tab → set it to Deny → Save.
              </li>
              <li>
                <strong>Reset to roles:</strong> set every override back to Default → Save.
              </li>
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
