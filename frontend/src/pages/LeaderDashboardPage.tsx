import { useEffect, useState } from "react";
import { api } from "../api";
import { MapsPipelineTable } from "../components/leader/MapsPipelineTable";
import { TeamSection } from "../components/leader/TeamSection";
import type { MapRecord, TeamMember } from "../types";

export function LeaderDashboardPage() {
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMap, setShowAddMap] = useState(false);
  const [error, setError] = useState("");
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Graphic Team Leader</h1>
        <p className="text-muted mt-1">Overview of all graphics maps and your team</p>
      </div>

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

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">All maps</h2>
          <button
            type="button"
            onClick={() => setShowAddMap(!showAddMap)}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
          >
            + Add map
          </button>
        </div>

        {showAddMap && (
          <form
            onSubmit={handleAddMap}
            className="bg-card border border-border rounded-xl p-5 mb-4 grid sm:grid-cols-2 gap-4"
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
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg">
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

        {loading ? (
          <p className="text-muted">Loading maps...</p>
        ) : (
          <MapsPipelineTable maps={maps} />
        )}
      </section>

      <TeamSection team={team} maps={maps} onRefresh={load} />
    </div>
  );
}
