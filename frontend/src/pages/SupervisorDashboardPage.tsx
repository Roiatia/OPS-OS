import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { MapHubBoard } from "../components/hub/MapHubBoard";
import { CompanyDashboardPanel } from "../components/leader/CompanyDashboardPanel";
import { SettingsPanel } from "../components/leader/SettingsPanel";
import { SupervisorMapsBoard } from "../components/supervisor/SupervisorMapsBoard";
import { SupervisorSidebar, type SupervisorSection } from "../components/supervisor/SupervisorSidebar";
import { SupervisorTeamPanel } from "../components/supervisor/SupervisorTeamPanel";
import { ConfluencePanel } from "../components/shared/ConfluencePanel";
import { getSupervisorFieldStatus } from "../lib/supervisorDisplay";
import { useAuth } from "../context/AuthContext";
import type { MapRecord, TeamMember } from "../types";

const SECTION_TITLES: Record<SupervisorSection, { title: string; subtitle: string }> = {
  hub: { title: "Hub", subtitle: "Drag your assigned maps — shift leaders can move any map" },
  maps: { title: "Maps", subtitle: "" },
  team: { title: "Team", subtitle: "All supervisors on the field ops team" },
  "company-dashboard": { title: "Dashboard", subtitle: "Field ops metrics and coverage" },
  availability: { title: "Availability", subtitle: "" },
  confluence: { title: "Confluence", subtitle: "" },
  settings: { title: "Settings", subtitle: "Workspace preferences" },
};

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <section className="rounded-xl border border-dashed border-border bg-white p-12 text-center">
      <p className="text-lg font-semibold text-slate-800">{title}</p>
      <p className="text-sm text-muted mt-2">Coming soon — we&apos;ll build this together.</p>
    </section>
  );
}

export function SupervisorDashboardPage() {
  const { user } = useAuth();
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [teamFieldMaps, setTeamFieldMaps] = useState<MapRecord[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SupervisorSection>("hub");

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Promise.all([api.getMaps(), api.getTeamFieldMaps(), api.getTeam()])
      .then(([m, tf, t]) => {
        setMaps(m);
        setTeamFieldMaps(tf);
        setTeam(t);
      })
      .catch(() => api.getMaps().then(setMaps))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const uncompleted = maps.filter((m) => getSupervisorFieldStatus(m) === "UNCOMPLETED").length;
    const completed = maps.filter((m) => getSupervisorFieldStatus(m) === "COMPLETED").length;
    const cancelled = maps.filter((m) => getSupervisorFieldStatus(m) === "CANCELLED").length;
    return { total: maps.length, uncompleted, completed, cancelled };
  }, [maps]);

  const supervisors = team.filter((m) => m.roles.some((r) => r.role === "SUPERVISOR"));

  const { title, subtitle } = SECTION_TITLES[activeSection];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <SupervisorSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        activeMapCount={stats.uncompleted}
        teamCount={supervisors.length}
      />

      <div className="flex-1 min-w-0 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
          </div>

          {activeSection === "hub" && user ? (
            <MapHubBoard
              mode="supervisor"
              currentUserId={user.id}
              onMutate={(updated) => {
                if (updated) {
                  setMaps((prev) =>
                    prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
                  );
                }
                void load(true);
              }}
            />
          ) : loading ? (
            <p className="text-muted">Loading...</p>
          ) : (
            <>
              {activeSection === "maps" && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "All maps", value: stats.total },
                      { label: "Uncompleted", value: stats.uncompleted },
                      { label: "Completed", value: stats.completed },
                      { label: "Cancelled", value: stats.cancelled },
                    ].map((s) => (
                      <div key={s.label} className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                        <div className="text-2xl font-bold text-brand-600">
                          {s.value}
                        </div>
                        <div className="text-sm text-muted">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <SupervisorMapsBoard maps={maps} onRefresh={load} />
                </>
              )}

              {activeSection === "team" && (
                <SupervisorTeamPanel
                  team={team}
                  teamFieldMaps={teamFieldMaps}
                  myMaps={maps}
                  onRefresh={load}
                />
              )}

              {activeSection === "company-dashboard" && <CompanyDashboardPanel />}

              {activeSection === "availability" && <PlaceholderPanel title="Availability" />}

              {activeSection === "confluence" && <ConfluencePanel />}

              {activeSection === "settings" && <SettingsPanel />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
