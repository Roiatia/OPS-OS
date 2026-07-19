import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { CompanyDashboardPanel } from "../components/leader/CompanyDashboardPanel";
import { SettingsPanel } from "../components/leader/SettingsPanel";
import { MapHubBoard } from "../components/hub/MapHubBoard";
import { OpsHistoryPanel } from "../components/ops/OpsHistoryPanel";
import { OpsMapsBoard } from "../components/ops/OpsMapsBoard";
import { SpreadsheetSyncPanel } from "../components/ops/SpreadsheetSyncPanel";
import { OpsReportsPanel } from "../components/ops/OpsReportsPanel";
import { OpsUpdatesPanel } from "../components/ops/OpsUpdatesPanel";
import { OpsManagerSidebar, type OpsSection } from "../components/ops/OpsManagerSidebar";
import { OpsTeamPanel } from "../components/ops/OpsTeamPanel";
import { ConfluencePanel } from "../components/shared/ConfluencePanel";
import { AvailabilityPanel } from "../components/shared/AvailabilityPanel";
import {
  isAtGraphics,
  isReadyToRelease,
  matchesOpsQueue,
} from "../lib/opsDisplay";
import { getOpsWorkloadAlerts } from "../lib/opsWorkload";
import { useSectionRoute } from "@/hooks/useSectionRoute";
import { useDashboardQuery, useHistoryQuery } from "@/hooks/queries";
import { patchDashboardMaps, queryKeys } from "../lib/mapsCache";
import { applyMapUpsert } from "../lib/mapsLive";
import { patchMapInList, normalizeMapRecord } from "../lib/mapSync";
import { useOpsUpdates } from "@/hooks/useOpsUpdates";
import { useAuth } from "../context/AuthContext";
import type { MapRecord } from "../types";

const OPS_SECTIONS = [
  "hub",
  "updates",
  "maps",
  "team",
  "history",
  "reports",
  "company-dashboard",
  "availability",
  "confluence",
  "settings",
] as const satisfies readonly OpsSection[];

const SECTION_TITLES: Record<OpsSection, { title: string; subtitle: string }> = {
  hub: { title: "Hub", subtitle: "" },
  updates: { title: "Updates", subtitle: "" },
  maps: { title: "Maps", subtitle: "" },
  team: { title: "Team", subtitle: "" },
  history: { title: "History", subtitle: "" },
  reports: { title: "Reports", subtitle: "" },
  "company-dashboard": { title: "Dashboard", subtitle: "" },
  availability: { title: "Availability", subtitle: "" },
  confluence: { title: "Confluence", subtitle: "" },
  settings: { title: "Settings", subtitle: "" },
};

export function OpsManagerDashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showAddMap, setShowAddMap] = useState(false);
  const [readyPanelOpen, setReadyPanelOpen] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useSectionRoute("/app/ops", OPS_SECTIONS, "hub");
  const [form, setForm] = useState({
    mapNumber: "",
    jiraTicketId: "",
    client: "",
    area: "",
    description: "",
    dueDate: "",
  });

  const { data, isLoading } = useDashboardQuery();
  const maps = useMemo(() => data?.maps ?? [], [data]);
  const team = useMemo(() => data?.team ?? [], [data]);
  const loading = isLoading;

  // History is heavy at scale — load it lazily the first time the History tab
  // opens (the shared cache keeps it live via realtime after that).
  const { data: historyData } = useHistoryQuery(activeSection === "history");
  const historyMaps = useMemo(() => historyData ?? [], [historyData]);

  const load = useCallback(
    () => void qc.invalidateQueries({ queryKey: queryKeys.dashboard }),
    [qc]
  );
  const reloadMaps = load;

  // Live-poll updates only while viewing the sections that surface them; the
  // badge still gets an initial load on other sections.
  const opsUpdates = useOpsUpdates(
    load,
    activeSection === "updates" || activeSection === "hub"
  );

  const handleHubMutate = useCallback(
    (updated?: MapRecord) => {
      if (!updated) return;
      const normalized = normalizeMapRecord(updated);
      patchDashboardMaps(qc, (prev) => patchMapInList(prev, updated));
      // Refresh Updates for hub status moves and when a map becomes ready to accept
      if (updated.onHubStatusBoard || isReadyToRelease(normalized)) {
        void opsUpdates.refresh();
      }
    },
    [qc, opsUpdates]
  );

  /** Patch a single map from a Maps-board mutation response — no full refetch. */
  const handleBoardPatch = useCallback(
    (updated: MapRecord) => {
      const normalized = normalizeMapRecord(updated);
      patchDashboardMaps(qc, (prev) => {
        const { next, needReload } = applyMapUpsert(prev, [normalized]);
        if (needReload) reloadMaps();
        return next;
      });
      if (normalized.onHubStatusBoard || isReadyToRelease(normalized)) {
        void opsUpdates.refresh();
      }
    },
    [qc, reloadMaps, opsUpdates]
  );

  async function handleAddMap(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createMap({
        mapNumber: form.mapNumber,
        jiraTicketId: form.jiraTicketId || undefined,
        client: form.client,
        area: form.area || undefined,
        description: form.description || undefined,
        dueDate: form.dueDate || undefined,
      });
      setShowAddMap(false);
      setForm({ mapNumber: "", jiraTicketId: "", client: "", area: "", description: "", dueDate: "" });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const stats = useMemo(
    () => ({
      total: maps.length,
      newFromCs: maps.filter((m) => matchesOpsQueue(m, "new_from_cs")).length,
      atGraphics: maps.filter((m) => isAtGraphics(m)).length,
      fieldOps: maps.filter((m) => m.phase === "FIELD").length,
      ready: maps.filter((m) => isReadyToRelease(m)).length,
    }),
    [maps]
  );

  const allMaps = useMemo(() => {
    const byId = new Map<string, MapRecord>();
    for (const m of [...maps, ...historyMaps]) byId.set(m.id, m);
    return [...byId.values()];
  }, [maps, historyMaps]);

  const workloadAlerts = useMemo(
    () => getOpsWorkloadAlerts(team, maps, allMaps),
    [team, maps, allMaps]
  );

  const { title, subtitle } = SECTION_TITLES[activeSection];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <OpsManagerSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        fieldCount={stats.fieldOps}
        readyCount={stats.ready}
        lightLoadCount={workloadAlerts.length}
        updateCount={opsUpdates.unreadCount}
      />

      <div className="flex-1 min-w-0 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{title}</h1>
              {subtitle ? <p className="text-muted mt-1">{subtitle}</p> : null}
            </div>
            {activeSection === "maps" && (
              <button
                type="button"
                onClick={() => setShowAddMap(!showAddMap)}
                className="px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 shadow-sm shadow-brand-600/20 transition-colors"
              >
                + Add map from CS
              </button>
            )}
          </div>

          {activeSection === "hub" && user ? (
            <MapHubBoard
              mode="ops"
              currentUserId={user.id}
              onMutate={handleHubMutate}
            />
          ) : activeSection === "updates" ? (
            <OpsUpdatesPanel
              updates={opsUpdates.updates}
              shiftAlerts={opsUpdates.shiftAlerts}
              dismissedUpdates={opsUpdates.dismissedUpdates}
              dismissedAlerts={opsUpdates.dismissedAlerts}
              dismissedCount={opsUpdates.dismissedCount}
              onDismiss={opsUpdates.dismiss}
              onDismissAll={opsUpdates.dismissAll}
              onRestore={opsUpdates.restore}
              onRestoreAll={opsUpdates.restoreAll}
              onRefresh={opsUpdates.refresh}
            />
          ) : activeSection === "reports" ? (
            <OpsReportsPanel />
          ) : loading ? (
            <p className="text-muted">Loading...</p>
          ) : (
            <>
              {activeSection === "maps" && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "All maps", value: stats.total },
                      { label: "New from CS", value: stats.newFromCs },
                      { label: "At graphics", value: stats.atGraphics },
                      { label: "maps in field ops", value: stats.fieldOps },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="bg-card border border-border rounded-2xl p-4 shadow-sm"
                      >
                        <div className="text-2xl font-bold text-brand-600">{s.value}</div>
                        <div className="text-sm text-muted">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <SpreadsheetSyncPanel onSynced={load} />

                  {showAddMap && (
                    <form
                      onSubmit={handleAddMap}
                      className="bg-card border border-border rounded-xl p-5 grid sm:grid-cols-2 gap-4"
                    >
                      <input
                        required
                        placeholder="Map number (e.g. MAP-2024-0110)"
                        value={form.mapNumber}
                        onChange={(e) => setForm({ ...form, mapNumber: e.target.value })}
                        className="border border-border rounded-lg px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Jira ticket (e.g. OPS-4610)"
                        value={form.jiraTicketId}
                        onChange={(e) => setForm({ ...form, jiraTicketId: e.target.value })}
                        className="border border-border rounded-lg px-3 py-2 text-sm"
                      />
                      <input
                        required
                        placeholder="Client"
                        value={form.client}
                        onChange={(e) => setForm({ ...form, client: e.target.value })}
                        className="border border-border rounded-lg px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Area"
                        value={form.area}
                        onChange={(e) => setForm({ ...form, area: e.target.value })}
                        className="border border-border rounded-lg px-3 py-2 text-sm"
                      />
                      <textarea
                        placeholder="Description"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        className="border border-border rounded-lg px-3 py-2 text-sm sm:col-span-2"
                        rows={2}
                      />
                      <label className="block sm:col-span-2">
                        <span className="text-sm text-muted">Deadline (optional)</span>
                        <input
                          type="date"
                          value={form.dueDate}
                          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                          className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
                        />
                      </label>
                      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
                      <div className="sm:col-span-2 flex gap-2">
                        <button
                          type="submit"
                          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg"
                        >
                          Save map
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddMap(false)}
                          className="px-4 py-2 text-sm text-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  <OpsMapsBoard
                    maps={maps}
                    team={team}
                    workloadAlerts={workloadAlerts}
                    onRefresh={() => {
                      void load();
                      void opsUpdates.refresh();
                    }}
                    onPatch={handleBoardPatch}
                    readyPanelOpen={readyPanelOpen}
                    onReadyPanelOpenChange={setReadyPanelOpen}
                  />
                </>
              )}

              {activeSection === "team" && (
                <OpsTeamPanel team={team} maps={maps} />
              )}

              {activeSection === "history" && (
                <OpsHistoryPanel activeMaps={maps} historyMaps={historyMaps} team={team} />
              )}

              {activeSection === "company-dashboard" && <CompanyDashboardPanel />}

              {activeSection === "availability" && <AvailabilityPanel />}

              {activeSection === "confluence" && <ConfluencePanel />}

              {activeSection === "settings" && <SettingsPanel />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
