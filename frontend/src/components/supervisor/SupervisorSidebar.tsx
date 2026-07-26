
export type SupervisorSection =
  | "hub"
  | "maps"
  | "team"
  | "company-dashboard"
  | "availability"
  | "confluence"
  | "settings";

interface NavItem {
  id: SupervisorSection;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "hub", label: "Hub", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" },
  { id: "maps", label: "Maps", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
  { id: "team", label: "Team", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "company-dashboard", label: "Dashboard", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
  { id: "availability", label: "Availability", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "confluence", label: "Confluence", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

interface Props {
  activeSection: SupervisorSection;
  onSectionChange: (section: SupervisorSection) => void;
  activeMapCount?: number;
  teamCount?: number;
  visibleIds?: readonly SupervisorSection[];
}

export function SupervisorSidebar({
  activeSection,
  onSectionChange,
  activeMapCount = 0,
  teamCount = 0,
  visibleIds,
}: Props) {
  const items = visibleIds
    ? NAV_ITEMS.filter((item) => visibleIds.includes(item.id))
    : NAV_ITEMS;

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-white flex flex-col h-[calc(100vh-4rem)] sticky top-16 shadow-sm">
      <div className="px-4 py-4 border-b border-border">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Navigation
        </p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                active
                  ? "bg-brand-600 text-white shadow-md shadow-brand-600/20"
                  : "text-slate-600 hover:bg-brand-50 hover:text-brand-700"
              }`}
            >
              <svg
                className={`w-5 h-5 shrink-0 ${active ? "text-white" : "text-brand-500"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="text-sm font-medium">{item.label}</span>
              {item.id === "confluence" && (
                <span
                  className={`ml-auto text-[10px] font-semibold uppercase tracking-wide ${
                    active ? "text-white/80" : "text-muted"
                  }`}
                >
                  Coming soon
                </span>
              )}
              {item.id === "maps" && activeMapCount > 0 && (
                <span
                  className={`ml-auto text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${
                    active ? "bg-white/20 text-white" : "bg-brand-100 text-brand-800"
                  }`}
                >
                  {activeMapCount}
                </span>
              )}
              {item.id === "team" && teamCount > 0 && (
                <span
                  className={`ml-auto text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${
                    active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {teamCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
