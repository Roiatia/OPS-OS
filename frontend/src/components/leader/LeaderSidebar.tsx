export type LeaderSection = "maps" | "team" | "company-dashboard" | "settings";

interface NavItem {
  id: LeaderSection;
  label: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "maps", label: "Maps", description: "Pipeline & assignments" },
  { id: "team", label: "Team", description: "Members & workload" },
  { id: "company-dashboard", label: "Company Dashboard", description: "Client dashboards" },
  { id: "settings", label: "Settings", description: "Preferences" },
];

interface Props {
  activeSection: LeaderSection;
  onSectionChange: (section: LeaderSection) => void;
}

export function LeaderSidebar({ activeSection, onSectionChange }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-white flex flex-col h-[calc(100vh-3.5rem)] sticky top-14">
      <div className="px-4 py-4 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Workspace</p>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSectionChange(item.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
              activeSection === item.id
                ? "bg-brand-50 text-brand-700"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <div className="text-sm font-medium">{item.label}</div>
            <div
              className={`text-xs mt-0.5 ${
                activeSection === item.id ? "text-brand-600/70" : "text-muted"
              }`}
            >
              {item.description}
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
