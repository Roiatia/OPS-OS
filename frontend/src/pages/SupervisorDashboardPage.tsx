import { Suspense, lazy, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapHubBoard } from "../components/hub/MapHubBoard";
import { SettingsPanel } from "../components/leader/SettingsPanel";
import { SupervisorSidebar, type SupervisorSection } from "../components/supervisor/SupervisorSidebar";
import { ConfluencePanel } from "../components/shared/ConfluencePanel";
import { AvailabilityPanel } from "../components/shared/AvailabilityPanel";
import { AvailabilityReminderModal } from "../components/availability/AvailabilityReminderModal";

// Non-default sections are code-split so the Hub (default) paints without the
// maps board, team panel, company dashboard or availability form in the chunk.
const SupervisorMapsBoard = lazy(() =>
  import("../components/supervisor/SupervisorMapsBoard").then((m) => ({
    default: m.SupervisorMapsBoard,
  }))
);
const SupervisorTeamPanel = lazy(() =>
  import("../components/supervisor/SupervisorTeamPanel").then((m) => ({
    default: m.SupervisorTeamPanel,
  }))
);
const CompanyDashboardPanel = lazy(() =>
  import("../components/leader/CompanyDashboardPanel").then((m) => ({
    default: m.CompanyDashboardPanel,
  }))
);
import { getSupervisorFieldStatus } from "../lib/supervisorDisplay";
import { useSectionRoute } from "@/hooks/useSectionRoute";
import { useDashboardQuery } from "@/hooks/queries";
import { patchDashboardMaps, queryKeys } from "../lib/mapsCache";
import { applyMapUpsert } from "../lib/mapsLive";
import { patchMapInList } from "../lib/mapSync";
import { useAuth } from "../context/AuthContext";
import { hasSupervisorRole } from "../lib/roles";
import { useAvailabilityReminder } from "@/hooks/useAvailabilityReminder";
import type { MapRecord } from "../types";

const SUPERVISOR_SECTIONS = [
  "hub",
  "maps",
  "team",
  "company-dashboard",
  "availability",
  "confluence",
  "settings",
] as const satisfies readonly SupervisorSection[];

const SECTION_TITLES: Record<SupervisorSection, { title: string; subtitle: string }> = {
  hub: { title: "Hub", subtitle: "" },
  maps: { title: "Maps", subtitle: "" },
  team: { title: "Team", subtitle: "" },
  "company-dashboard": { title: "Dashboard", subtitle: "" },
  availability: {
    title: "Availability",
    subtitle: "",
  },
  confluence: { title: "Confluence", subtitle: "" },
  settings: { title: "Settings", subtitle: "" },
};

export function SupervisorDashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useSectionRoute(
    "/app/supervisor",
    SUPERVISOR_SECTIONS,
    "hub"
  );
  const availabilityReminder = useAvailabilityReminder(hasSupervisorRole(user));

  function openAvailability() {
    setActiveSection("availability");
    availabilityReminder.promptNow();
    void availabilityReminder.refresh();
  }

  const { data, isLoading } = useDashboardQuery();
  const maps = useMemo(() => data?.maps ?? [], [data]);
  const teamFieldMaps = useMemo(() => data?.teamFieldMaps ?? [], [data]);
  const team = useMemo(() => data?.team ?? [], [data]);
  // Only gate on the cold load; background revalidation keeps `data` populated.
  const loading = isLoading && !data;

  const load = useCallback(
    () => void qc.invalidateQueries({ queryKey: queryKeys.dashboard }),
    [qc]
  );
  const reloadMaps = load;

  const handleHubMutate = useCallback(
    (updated?: MapRecord) => {
      if (updated) {
        patchDashboardMaps(qc, (prev) => patchMapInList(prev, updated));
      }
    },
    [qc]
  );

  /** Patch a single map from a Maps-board mutation response — no full refetch. */
  const patchMap = useCallback(
    (updated: MapRecord) => {
      patchDashboardMaps(qc, (prev) => {
        const { next, needReload } = applyMapUpsert(prev, [updated]);
        if (needReload) reloadMaps();
        return next;
      });
    },
    [qc, reloadMaps]
  );

  const stats = useMemo(() => {
    const uncompleted = maps.filter((m) => getSupervisorFieldStatus(m) === "UNCOMPLETED").length;
    const completed = maps.filter((m) => getSupervisorFieldStatus(m) === "COMPLETED").length;
    const cancelled = maps.filter((m) => getSupervisorFieldStatus(m) === "CANCELLED").length;
    return { total: maps.length, uncompleted, completed, cancelled };
  }, [maps]);

  const supervisors = useMemo(
    () => team.filter((m) => m.roles.some((r) => r.role === "SUPERVISOR")),
    [team]
  );

  const { title, subtitle } = SECTION_TITLES[activeSection];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <AvailabilityReminderModal
        open={availabilityReminder.show}
        weekLabel={availabilityReminder.weekLabel}
        onDismiss={availabilityReminder.dismiss}
        onFill={() => {
          availabilityReminder.snooze();
          setActiveSection("availability");
        }}
      />
      <SupervisorSidebar
        activeSection={activeSection}
        onSectionChange={(section) => {
          if (section === "availability") openAvailability();
          else setActiveSection(section);
        }}
        activeMapCount={stats.uncompleted}
        teamCount={supervisors.length}
      />

      <div className="flex-1 min-w-0 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
          </div>

          <Suspense fallback={<p className="text-muted">Loading...</p>}>
          {activeSection === "hub" && user ? (
            <MapHubBoard
              mode="supervisor"
              currentUserId={user.id}
              onMutate={handleHubMutate}
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
                  <SupervisorMapsBoard
                    maps={maps}
                    onRefresh={load}
                    onPatch={patchMap}
                  />
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

              {activeSection === "availability" && (
                <AvailabilityPanel onAvailabilitySubmitted={() => void availabilityReminder.refresh()} />
              )}

              {activeSection === "confluence" && <ConfluencePanel />}

              {activeSection === "settings" && <SettingsPanel />}
            </>
          )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
