import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth, hasRole } from "../context/AuthContext";
import { PhaseStepper } from "../components/PhaseStepper";
import { Badge } from "../components/Badge";
import { TaskTable } from "../components/TaskTable";
import type { MapRecord, TaskStatus, TeamMember } from "../types";
import { PHASE_LABELS } from "../types";

export function MapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [map, setMap] = useState<MapRecord | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "" });
  const [selectedInspector, setSelectedInspector] = useState("");

  const isLeader = hasRole(user!, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN");
  const isInspector = hasRole(user!, "MAPPING_INSPECTOR");
  const isQa = hasRole(user!, "GRAPHIC_QA");

  function load() {
    if (!id) return;
    api.getMap(id).then(setMap).catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    load();
    if (isLeader) api.getTeam().then(setTeam);
  }, [id, isLeader]);

  async function act(fn: () => Promise<MapRecord>) {
    setError("");
    try {
      const updated = await fn();
      setMap(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!map) {
    return (
      <div>
        <Link to="/app" className="text-sm text-brand-600 hover:underline">← Back</Link>
        <p className="mt-4 text-muted">{error || "Loading..."}</p>
      </div>
    );
  }

  const inspectors = team.filter((t) => t.roles.some((r) => r.role === "MAPPING_INSPECTOR"));

  return (
    <div>
      <Link to="/app" className="text-sm text-brand-600 hover:underline">← All maps</Link>

      <div className="mt-4 bg-card border border-border rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{map.mapNumber}</h1>
            <p className="text-muted mt-1">
              {map.client}
              {map.area ? ` · ${map.area}` : ""}
              {map.jiraTicketId ? ` · ${map.jiraTicketId}` : ""}
            </p>
            {map.description && <p className="text-sm mt-2">{map.description}</p>}
          </div>
          <Badge label={PHASE_LABELS[map.phase]} tone={map.phase} />
        </div>

        <div className="mt-6">
          <PhaseStepper current={map.phase} />
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {map.inspectorStatus && (
            <Badge label={`Inspector: ${map.inspectorStatus}`} tone={map.inspectorStatus} />
          )}
          {map.qaStatus && <Badge label={`QA: ${map.qaStatus}`} tone={map.qaStatus} />}
          {map.uploadApproved && <Badge label="Upload approved" tone="APPROVED" />}
          {map.assignedInspector && (
            <span className="text-xs text-muted self-center">
              Inspector: {map.assignedInspector.name}
            </span>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

      {/* Leader: assign inspector */}
      {isLeader && map.phase === "INTAKE" && (
        <section className="mt-6 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-3">Assign to Mapping Inspector</h2>
          <div className="flex gap-2 flex-wrap">
            <select
              value={selectedInspector}
              onChange={(e) => setSelectedInspector(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
            >
              <option value="">Select inspector...</option>
              {inspectors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              disabled={!selectedInspector}
              onClick={() => act(() => api.assignInspector(map.id, selectedInspector))}
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        </section>
      )}

      {/* Inspector: status buttons */}
      {isInspector &&
        map.assignedInspector?.id === user!.id &&
        (map.phase === "PREP" || map.phase === "POLISH") && (
          <section className="mt-6 bg-card border border-border rounded-xl p-5">
            <h2 className="font-semibold mb-3">
              {map.phase === "PREP" ? "Initial prep" : "Polish"} — update status
            </h2>
            <div className="flex flex-wrap gap-2">
              {(["ACCEPTED", "PROCESSING", "DONE"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => act(() => api.updateInspectorStatus(map.id, s))}
                  className={`px-4 py-2 text-sm rounded-lg border ${
                    map.inspectorStatus === s
                      ? "bg-brand-600 text-white border-brand-600"
                      : "border-border hover:bg-slate-50"
                  }`}
                >
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            {map.phase === "PREP" && map.inspectorStatus === "DONE" && (
              <p className="text-sm text-muted mt-3">Submitted to QA for upload approval.</p>
            )}
            {map.phase === "POLISH" && map.inspectorStatus === "DONE" && (
              <p className="text-sm text-muted mt-3">Submitted to QA for polish review.</p>
            )}
          </section>
        )}

      {/* QA: upload approval */}
      {isQa && map.phase === "UPLOAD_REVIEW" && (
        <section className="mt-6 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-3">Approve dashboard upload?</h2>
          <p className="text-sm text-muted mb-4">
            Inspector finished initial prep. Approve before supervisors can work on this map in the field.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => act(() => api.uploadReview(map.id, true))}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg"
            >
              Approve upload
            </button>
            <button
              onClick={() => act(() => api.uploadReview(map.id, false, "Needs revision"))}
              className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg"
            >
              Reject — send back
            </button>
          </div>
        </section>
      )}

      {/* Leader: stub field complete */}
      {isLeader && map.phase === "FIELD" && (
        <section className="mt-6 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-3">Field work (supervisors)</h2>
          <p className="text-sm text-muted mb-4">
            Supervisors are working on this map in the field. For the demo, mark field work as complete to
            start the polish phase.
          </p>
          <button
            onClick={() => act(() => api.fieldComplete(map.id))}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg"
          >
            Mark field complete → start polish
          </button>
        </section>
      )}

      {/* QA: polish review */}
      {isQa && map.phase === "QA_REVIEW" && (
        <section className="mt-6 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-3">Polish QA review</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => act(() => api.qaReview(map.id, "approved"))}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg"
            >
              Approved
            </button>
            <button
              onClick={() => act(() => api.qaReview(map.id, "fix", "Corrections needed"))}
              className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg"
            >
              Fix
            </button>
          </div>
        </section>
      )}

      {/* Inspector: fix done */}
      {isInspector && map.qaStatus === "FIX" && map.phase === "POLISH" && (
        <section className="mt-6 bg-card border border-amber-300 bg-amber-50 rounded-xl p-5">
          <h2 className="font-semibold mb-3">QA requested fixes</h2>
          <p className="text-sm text-muted mb-4">Complete the fixes and mark as fix done for QA.</p>
          <button
            onClick={() => act(() => api.qaReview(map.id, "fix_done"))}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg"
          >
            Fix done
          </button>
        </section>
      )}

      {/* QA: approve after fix done */}
      {isQa && map.qaStatus === "FIX_DONE" && (
        <section className="mt-6 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-3">Inspector marked fix done</h2>
          <button
            onClick={() => act(() => api.qaReview(map.id, "approved"))}
            className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg"
          >
            Final approve
          </button>
        </section>
      )}

      {map.phase === "APPROVED" && (
        <div className="mt-6 p-5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 font-medium">
          Map approved and workflow complete.
        </div>
      )}

      {/* Tasks spreadsheet */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Tasks (spreadsheet view)</h2>
        </div>

        {(isLeader || isQa) && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await act(async () => {
                await api.createTask(map.id, {
                  title: taskForm.title,
                  description: taskForm.description || undefined,
                  phase: map.phase === "POLISH" || map.phase === "QA_REVIEW" ? "POLISH" : "PREP",
                });
                const refreshed = await api.getMap(map.id);
                setMap(refreshed);
                return refreshed;
              });
              setTaskForm({ title: "", description: "" });
            }}
            className="flex flex-wrap gap-2 mb-4"
          >
            <input
              required
              placeholder="Task for inspector..."
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              className="border border-border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
            />
            <input
              placeholder="Details (optional)"
              value={taskForm.description}
              onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              className="border border-border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
            />
            <button type="submit" className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg">
              Add task
            </button>
          </form>
        )}

        <TaskTable
          tasks={map.tasks}
          mapNumber={map.mapNumber}
          canEdit={isInspector && map.assignedInspector?.id === user!.id}
          onStatusChange={async (taskId, status) => {
            await api.updateTaskStatus(taskId, status);
            load();
          }}
        />
      </section>

      {/* Event log */}
      <section className="mt-8">
        <h2 className="font-semibold mb-3">Activity log</h2>
        <div className="space-y-2">
          {map.events.map((ev) => (
            <div key={ev.id} className="text-sm flex gap-3 py-2 border-b border-border last:border-0">
              <span className="text-muted shrink-0 w-36">
                {new Date(ev.createdAt).toLocaleString()}
              </span>
              <span className="font-medium shrink-0">{ev.user.name}</span>
              <span className="text-muted">{ev.action}</span>
              {ev.note && <span>— {ev.note}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
