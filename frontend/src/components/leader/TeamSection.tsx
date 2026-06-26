import { useState } from "react";
import type { MapRecord, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import { countMapsForMember } from "../../lib/mapDisplay";
import { api } from "../../api";

interface Props {
  team: TeamMember[];
  maps: MapRecord[];
  onRefresh: () => void;
}

export function TeamSection({ team, maps, onRefresh }: Props) {
  const [assignMapOpen, setAssignMapOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [assignForm, setAssignForm] = useState({ mapId: "", inspectorId: "" });
  const [taskForm, setTaskForm] = useState({
    mapId: "",
    memberId: "",
    title: "",
    description: "",
  });

  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));
  const qaMembers = team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"));
  const assignableMembers = [...inspectors, ...qaMembers];
  const unassignedMaps = maps.filter((m) => m.phase === "INTAKE");

  async function handleAssignMap(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.assignInspector(assignForm.mapId, assignForm.inspectorId);
      setAssignMapOpen(false);
      setAssignForm({ mapId: "", inspectorId: "" });
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignTask(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const map = maps.find((m) => m.id === taskForm.mapId);
      await api.createTask(taskForm.mapId, {
        title: taskForm.title,
        description: taskForm.description || undefined,
        assignedToId: taskForm.memberId,
        phase: map?.phase === "POLISH" || map?.phase === "QA_REVIEW" ? "POLISH" : "PREP",
      });
      setTaskOpen(false);
      setTaskForm({ mapId: "", memberId: "", title: "", description: "" });
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold">Graphics team</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setError("");
              setAssignMapOpen(true);
            }}
            className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-slate-50"
          >
            Assign map
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setTaskOpen(true);
            }}
            className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700"
          >
            Assign task
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Active maps</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assignableMembers.map((member) => (
              <tr key={member.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium">{member.name}</td>
                <td className="px-4 py-3">
                  {member.roles.map((r) => ROLE_LABELS[r.role]).join(", ")}
                </td>
                <td className="px-4 py-3 text-muted">{member.email}</td>
                <td className="px-4 py-3">{countMapsForMember(maps, member.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {assignMapOpen && (
        <Modal title="Assign map to inspector" onClose={() => setAssignMapOpen(false)}>
          <form onSubmit={handleAssignMap} className="space-y-4">
            <label className="block">
              <span className="text-sm text-muted">Map</span>
              <select
                required
                value={assignForm.mapId}
                onChange={(e) => setAssignForm({ ...assignForm, mapId: e.target.value })}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select map...</option>
                {unassignedMaps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.mapNumber} — {m.client}
                  </option>
                ))}
              </select>
              {unassignedMaps.length === 0 && (
                <p className="text-xs text-muted mt-1">No maps in intake. Add a new map first.</p>
              )}
            </label>
            <label className="block">
              <span className="text-sm text-muted">Mapping Inspector</span>
              <select
                required
                value={assignForm.inspectorId}
                onChange={(e) => setAssignForm({ ...assignForm, inspectorId: e.target.value })}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select inspector...</option>
                {inspectors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setAssignMapOpen(false)}
                className="px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || unassignedMaps.length === 0}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          </form>
        </Modal>
      )}

      {taskOpen && (
        <Modal title="Assign task to team member" onClose={() => setTaskOpen(false)}>
          <form onSubmit={handleAssignTask} className="space-y-4">
            <label className="block">
              <span className="text-sm text-muted">Map</span>
              <select
                required
                value={taskForm.mapId}
                onChange={(e) => setTaskForm({ ...taskForm, mapId: e.target.value })}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select map...</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.mapNumber} — {m.client}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-muted">Team member</span>
              <select
                required
                value={taskForm.memberId}
                onChange={(e) => setTaskForm({ ...taskForm, memberId: e.target.value })}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select member...</option>
                {assignableMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.roles.map((r) => ROLE_LABELS[r.role]).join(", ")})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-muted">Task</span>
              <input
                required
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                placeholder="What needs to be done?"
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm text-muted">Details (optional)</span>
              <textarea
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                rows={2}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setTaskOpen(false)}
                className="px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
              >
                Create task
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-md p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-slate-900 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
