import { useEffect, useState } from "react";
import { api } from "../api";
import { AssignmentBoard } from "../components/leader/AssignmentBoard";
import { CompanyDashboardPanel } from "../components/leader/CompanyDashboardPanel";
import { LeaderSidebar, type LeaderSection } from "../components/leader/LeaderSidebar";
import { SettingsPanel } from "../components/leader/SettingsPanel";
import { TeamSection } from "../components/leader/TeamSection";
import { TeamWorkPanel } from "../components/leader/TeamWorkPanel";
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
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMap, setShowAddMap] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<LeaderSection>("maps");
  const [form, setForm] = useState({
    mapNumber: "",
    jiraTicketId: "",
    client: "",
    area: "",
    description: "",
  });

  function load() {
    setLoading(true);
    Promise.all([api.getMaps(), api.getTeam()])
      .then(([m, t]) => {
        setMaps(m);
        setTeam(t);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

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
      });
      setShowAddMap(false);
      setForm({ mapNumber: "", jiraTicketId: "", client: "", area: "", description: "" });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const stats = {
    total: maps.length,
    qa: maps.filter((m) => ["UPLOAD_REVIEW", "QA_REVIEW"].includes(m.phase)).length,
    inProgress: maps.filter((m) => ["PREP", "POLISH", "FIELD"].includes(m.phase)).length,
    intake: maps.filter((m) => m.phase === "INTAKE").length,
  };

  const { title, subtitle } = SECTION_TITLES[activeSection];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <LeaderSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

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
                className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
              >
                + Add map from CS
              </button>
            )}
          </div>

          {loading ? (
            <p className="text-muted">Loading...</p>
          ) : (
            <>
              {activeSection === "maps" && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "All maps", value: stats.total },
                      { label: "Awaiting assign", value: stats.intake },
                      { label: "In progress", value: stats.inProgress },
                      { label: "In QA", value: stats.qa },
                    ].map((s) => (
                      <div key={s.label} className="bg-card border border-border rounded-xl p-4">
                        <div className="text-2xl font-bold text-brand-700">{s.value}</div>
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

                  <AssignmentBoard maps={maps} team={team} onRefresh={load} />
                </>
              )}

              {activeSection === "team" && (
                <>
                  <TeamWorkPanel team={team} maps={maps} />
                  <TeamSection team={team} maps={maps} onRefresh={load} />
                </>
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
