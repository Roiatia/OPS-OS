import type { AdminSection } from "./AdminSidebar";

interface Props {
  onNavigate: (section: AdminSection) => void;
}

const CARDS: { section: AdminSection; title: string; description: string }[] = [
  {
    section: "users",
    title: "User management",
    description: "Create accounts, assign roles, disable access.",
  },
  {
    section: "features",
    title: "Feature flags",
    description: "Ship experimental features and hide capabilities per role.",
  },
  {
    section: "metrics",
    title: "Usage metrics",
    description: "See how real people use the system day to day.",
  },
  {
    section: "audit",
    title: "Audit log",
    description: "Review recent activity across every map.",
  },
];

export function AdminOverviewPanel({ onNavigate }: Props) {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-brand-200 bg-brand-50/60 px-5 py-4">
        <p className="text-sm text-brand-900">
          You have all-access administrator privileges. Use the tools below to manage the
          workspace.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {CARDS.map((card) => (
          <button
            key={card.section}
            type="button"
            onClick={() => onNavigate(card.section)}
            className="text-left rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-brand-300 hover:shadow transition-all"
          >
            <div className="font-semibold text-slate-900">{card.title}</div>
            <p className="text-sm text-muted mt-1">{card.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
