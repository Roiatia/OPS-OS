import { useCallback, useEffect, useMemo, useState } from "react";
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
import { patchMapInList, normalizeMapRecord } from "../lib/mapSync";
import { useOpsUpdates } from "../lib/useOpsUpdates";
import { useAuth } from "../context/AuthContext";
import type { MapRecord, TeamMember } from "../types";

const SECTION_TITLES: Record<OpsSection, { title: string; subtitle: string }> = {
  hub: {
    title: "Hub",
    subtitle: "Only supervisors & shift leaders on shift today — assign maps and track status",
  },
  updates: {
    title: "Updates",
    subtitle: "Map milestones from graphics and ops — stage done, complete, or incomplete",
  },
  maps: {
    title: "Maps",
    subtitle: "Full pipeline — graphics and field ops in one view",
  },
  team: {
    title: "Team",
    subtitle: "Who is working today — field shift + graphics under OPS",
  },
  history: {
    title: "History",
    subtitle: "All maps — active pipeline, completed, and on-shift wrap-up",
  },
  reports: {
    title: "Reports",
    subtitle: "End-of-day summaries — generated daily at 23:00",
  },
  "company-dashboard": {
    title: "Dashboard",
    subtitle: "Pipeline overview and coverage",
  },
  availability: {
    title: "Availability",
    subtitle: "Supervisor & shift leader shifts — plan coverage vs CS map volume",
  },
  confluence: {
    title: "Confluence",
    subtitle: "",
  },
  settings: {
    title: "Settings",
    subtitle: "Workspace preferences",
  },
};

export function OpsManagerDashboardPage() {
  const { user } = useAuth();
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [historyMaps, setHistoryMaps] = useState<MapRecord[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMap, setShowAddMap] = useState(false);
  const [readyPanelOpen, setReadyPanelOpen] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<OpsSection>("hub");
  const [form, setForm] = useState({
    mapNumber: "",
    jiraTicketId: "",
    client: "",
    area: "",
    description: "",
    dueDate: "",
  });

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Promise.all([api.getMaps(), api.getHistoryMaps(), api.getTeam()])
      .then(([m, h, t]) => {
        setMaps(m);
        setHistoryMaps(h);
        setTeam(t);
      })
      .catch(() => {
        if (!silent) {
          return Promise.all([api.getMaps(), api.getTeam()]).then(([m, t]) => {
            setMaps(m);
            setTeam(t);
          });
        }
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Keep Maps table in sync with Hub — own actions + supervisors on shift */
  useEffect(() => {
    const interval = setInterval(() => load(true), 20_000);
    return () => clearInterval(interval);
  }, [load]);

  const opsUpdates = useOpsUpdates(() => load(true));

  const handleHubMutate = useCallback(
    (updated?: MapRecord) => {
      if (!updated) return;
      const normalized = normalizeMapRecord(updated);
      setMaps((prev) => patchMapInList(prev, updated));
      // Refresh Updates for hub status moves and when a map becomes ready to accept
      if (updated.onHubStatusBoard || isReadyToRelease(normalized)) {
        void opsUpdates.refresh();
      }
    },
    [opsUpdates]
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
              <p className="text-muted mt-1">{subtitle}</p>
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

          {activeSection === "maps" && (
            <p className="text-xs text-muted -mt-4">
              Stays in sync with Hub — supervisor complete / incomplete / cancelled updates appear here within seconds.
            </p>
          )}

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
              isDemoPreview={opsUpdates.isDemoPreview}
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
                      load();
                      void opsUpdates.refresh();
                    }}
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
