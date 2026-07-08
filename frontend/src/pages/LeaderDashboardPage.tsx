import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AssignmentBoard } from "../components/leader/AssignmentBoard";
import { NewMapsPanel } from "../components/leader/NewMapsPanel";
import { CompanyDashboardPanel } from "../components/leader/CompanyDashboardPanel";
import { HistoryPanel } from "../components/leader/HistoryPanel";
import { LeaderSidebar, type LeaderSection } from "../components/leader/LeaderSidebar";
import { SettingsPanel } from "../components/leader/SettingsPanel";
import { TeamPanel } from "../components/leader/TeamPanel";
import { getIdleInspectors } from "../lib/assignment";
import { useMapsPolling } from "../lib/useMapsPolling";
import { isNewMapForLeader, isPipelineMapForLeader, needsQaAssignment } from "../lib/mapDisplay";
import type { MapRecord, TeamMember } from "../types";

const SECTION_TITLES: Record<LeaderSection, { title: string; subtitle: string }> = {
  maps: {
    title: "Maps",
    subtitle: "Assign, filter, and manage the graphics pipeline",
  },
  team: {
    title: "Team",
    subtitle: "Monitor workload and what each member is working on",
  },
  history: {
    title: "History",
    subtitle: "Approved and cancelled maps — full archive with phase timeline",
  },
  "company-dashboard": {
    title: "Company Dashboard",
    subtitle: "Maps on or heading to client dashboards",
  },
  settings: {
    title: "Settings",
    subtitle: "Workspace preferences and configuration",
  },
};

export function LeaderDashboardPage() {
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [historyMaps, setHistoryMaps] = useState<MapRecord[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddMap, setShowAddMap] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<LeaderSection>("maps");
  const [form, setForm] = useState({
    mapNumber: "",
    jiraTicketId: "",
    client: "",
    area: "",
    description: "",
    dueDate: "",
  });

  function load(opts?: { soft?: boolean }) {
    if (opts?.soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([api.getMaps(), api.getHistoryMaps(), api.getTeam()])
      .then(([m, h, t]) => {
        setMaps(m);
        setHistoryMaps(h);
        setTeam(t);
      })
      .catch(() => {
        Promise.all([api.getMaps(), api.getTeam()]).then(([m, t]) => {
          setMaps(m);
          setTeam(t);
        });
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    load();
  }, []);

  useMapsPolling((opts) => load(opts));

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
      load({ soft: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const newMaps = useMemo(() => maps.filter(isNewMapForLeader), [maps]);
  const pipelineMaps = useMemo(() => maps.filter(isPipelineMapForLeader), [maps]);

  const stats = {
    total: maps.length,
    newMaps: newMaps.length,
    qa: maps.filter((m) => ["UPLOAD_REVIEW", "QA_REVIEW"].includes(m.phase)).length,
    needsQa: maps.filter((m) => needsQaAssignment(m) && isPipelineMapForLeader(m)).length,
    inProgress: maps.filter((m) => ["PREP", "POLISH"].includes(m.phase)).length,
    onDashboard: maps.filter((m) => m.phase === "FIELD").length,
  };

  const idleInspectorCount = useMemo(
    () => getIdleInspectors(team, maps).length,
    [team, maps]
  );

  const newMapsCount = newMaps.length;

  const needsQaCount = useMemo(
    () => pipelineMaps.filter((m) => needsQaAssignment(m)).length,
    [pipelineMaps]
  );

  const { title, subtitle } = SECTION_TITLES[activeSection];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <LeaderSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        idleInspectorCount={idleInspectorCount}
        needsQaCount={needsQaCount}
        newMapsCount={newMapsCount}
      />

      <div className="flex-1 min-w-0 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{title}</h1>
              <p className="text-muted mt-1">{subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              {refreshing && (
                <span className="text-xs font-medium text-brand-700 bg-brand-100 px-2.5 py-1 rounded-full animate-pulse">
                  Updating…
                </span>
              )}
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
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
              <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
              <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
            </div>
          ) : (
            <>
              {activeSection === "maps" && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                      { label: "All maps", value: stats.total },
                      { label: "New maps", value: stats.newMaps, highlight: stats.newMaps > 0 },
                      { label: "Inspector work", value: stats.inProgress },
                      { label: "On dashboard", value: stats.onDashboard },
                      { label: "In QA", value: stats.qa },
                      { label: "Needs QA assign", value: stats.needsQa, highlight: stats.needsQa > 0 },
                    ].map((s) => (
                      <div key={s.label} className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                        <div className={`text-2xl font-bold ${s.highlight ? "text-violet-600" : "text-brand-600"}`}>
                          {s.value}
                        </div>
                        <div className="text-sm text-muted">{s.label}</div>
                      </div>
                    ))}
                  </div>

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

                  <NewMapsPanel maps={maps} team={team} onRefresh={() => load({ soft: true })} />

                  <AssignmentBoard
                    maps={pipelineMaps}
                    allMaps={maps}
                    team={team}
                    onRefresh={() => load({ soft: true })}
                  />
                </>
              )}

              {activeSection === "team" && (
                <TeamPanel team={team} maps={maps} onRefresh={() => load({ soft: true })} />
              )}

              {activeSection === "history" && (
                <HistoryPanel maps={historyMaps} onRefresh={() => load({ soft: true })} />
              )}

              {activeSection === "company-dashboard" && <CompanyDashboardPanel />}

              {activeSection === "settings" && <SettingsPanel />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
