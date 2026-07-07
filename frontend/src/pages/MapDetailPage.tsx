import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth, hasRole } from "../context/AuthContext";
import { PhaseStepper } from "../components/PhaseStepper";
import { Badge } from "../components/Badge";
import { TaskTable } from "../components/TaskTable";
import { getMapDisplayState, workflowStateTone } from "../lib/mapDisplay";
import type { MapRecord } from "../types";
import { PHASE_LABELS } from "../types";

export function MapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [map, setMap] = useState<MapRecord | null>(null);
  const [error, setError] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "" });

  const isLeader = hasRole(user!, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN");
  const isInspector = hasRole(user!, "MAPPING_INSPECTOR");
  const isQa = hasRole(user!, "GRAPHIC_QA");
  const isArchived = map?.phase === "APPROVED" || map?.phase === "CANCELLED";

  function load() {
    if (!id) return;
    api.getMap(id).then(setMap).catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    load();
  }, [id]);

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
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Link to="/app" className="text-sm text-brand-600 hover:underline">
            ← Back to maps
          </Link>
          <p className="mt-4 text-muted">{error || "Loading..."}</p>
        </div>
      </div>
    );
  }

  const displayState = getMapDisplayState(map);
  const isAssignedInspector = map.assignedInspector?.id === user!.id;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-50 to-white py-8 px-4">
      <div className="max-w-xl mx-auto">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium mb-6"
        >
          ← Back to maps
        </Link>

        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-2">
            {PHASE_LABELS[map.phase]}
          </p>
          <h1 className="text-3xl font-bold text-slate-900">{map.mapNumber}</h1>
          <p className="text-muted mt-2">
            {map.client}
            {map.area ? ` · ${map.area}` : ""}
          </p>
          {map.jiraTicketId && (
            <p className="text-xs text-muted mt-1 font-mono">{map.jiraTicketId}</p>
          )}
          {map.description && (
            <p className="text-sm text-slate-600 mt-3 max-w-md mx-auto">{map.description}</p>
          )}
        </div>

        {/* Main card */}
        <div className="bg-white rounded-3xl border border-border shadow-sm overflow-hidden">
          {/* Status strip */}
          <div className="flex flex-wrap items-center justify-center gap-2 px-6 py-4 bg-slate-50 border-b border-border">
            {displayState !== "—" && (
              <Badge label={displayState} tone={workflowStateTone(displayState)} />
            )}
            {map.uploadApproved && <Badge label="Upload approved" tone="APPROVED" />}
            {map.phase === "APPROVED" && (
              <Badge label="Complete" tone="APPROVED" />
            )}
            {map.phase === "CANCELLED" && (
              <Badge label="Cancelled" tone="CANCELLED" />
            )}
          </div>

          {/* Team */}
          <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
            <div className="px-6 py-4 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">
                Inspector
              </p>
              <p className="text-sm font-medium text-slate-800">
                {map.assignedInspector?.name ?? "—"}
              </p>
            </div>
            <div className="px-6 py-4 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">
                QA
              </p>
              <p className="text-sm font-medium text-slate-800">
                {map.assignedQa?.name ?? "—"}
              </p>
            </div>
          </div>

          {/* Phase timeline */}
          <div className="px-6 py-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted text-center mb-6">
              Workflow timeline
            </h2>
            <PhaseStepper
              current={map.phase}
              phaseHistory={map.phaseHistory ?? []}
              variant="vertical"
            />
          </div>

          {/* Attachments */}
          {(map.attachments?.length ?? 0) > 0 && (
            <div className="px-6 py-6 border-t border-border bg-slate-50/50">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
                Attachments
              </h2>
              <div className="space-y-3">
                {map.attachments!.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-3 bg-white rounded-xl border border-border p-3"
                  >
                    {att.mimeType.startsWith("image/") ? (
                      <img
                        src={`data:${att.mimeType};base64,${att.data}`}
                        alt={att.fileName}
                        className="w-14 h-14 object-cover rounded-lg border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-brand-50 flex items-center justify-center shrink-0 text-brand-600 text-xs font-bold">
                        FILE
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{att.fileName}</p>
                      <p className="text-xs text-muted">
                        {att.uploadedBy.name} · {new Date(att.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {!att.mimeType.startsWith("image/") && (
                      <a
                        href={`data:${att.mimeType};base64,${att.data}`}
                        download={att.fileName}
                        className="text-xs text-brand-600 font-medium shrink-0"
                      >
                        Download
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Role actions */}
          {!isArchived && (
            <div className="px-6 py-6 border-t border-border space-y-4">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 text-center">{error}</p>
              )}

              {isInspector && isAssignedInspector && map.qaStatus === "FIX" && map.phase === "POLISH" && (
                <ActionBlock title="Fix requested by QA" hint="Complete fixes and mark FixDone.">
                  <button
                    onClick={() => act(() => api.qaReview(map.id, "fix_done"))}
                    className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
                  >
                    Mark FixDone
                  </button>
                </ActionBlock>
              )}

              {isInspector &&
                isAssignedInspector &&
                map.qaStatus !== "FIX" &&
                (map.phase === "PREP" || map.phase === "POLISH") && (
                  <ActionBlock
                    title={map.phase === "PREP" ? "Upload prep" : "Polish work"}
                    hint="Update your workflow state."
                  >
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { value: "ACCEPTED", label: "Accepted" },
                          { value: "PROCESSING", label: "Processing" },
                          { value: "DONE", label: "Done" },
                        ] as const
                      ).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => act(() => api.updateInspectorStatus(map.id, value))}
                          className={`py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                            map.inspectorStatus === value
                              ? "bg-brand-600 text-white border-brand-600"
                              : "border-border hover:bg-slate-50 text-slate-700"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </ActionBlock>
                )}

              {isQa && map.phase === "UPLOAD_REVIEW" && (
                <ActionBlock
                  title="Upload approval"
                  hint="Inspector finished prep. Approve before field work."
                >
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => act(() => api.uploadReview(map.id, true))}
                      className="py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => act(() => api.uploadReview(map.id, false, "Needs revision"))}
                      className="py-2.5 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-200 hover:bg-red-100"
                    >
                      Reject
                    </button>
                  </div>
                </ActionBlock>
              )}

              {isLeader && map.phase === "FIELD" && (
                <ActionBlock title="Field work" hint="Mark complete to start polish.">
                  <button
                    onClick={() => act(() => api.fieldComplete(map.id))}
                    className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
                  >
                    Field complete → start polish
                  </button>
                </ActionBlock>
              )}

              {isQa && map.phase === "QA_REVIEW" && !map.qaStatus && (
                <ActionBlock title="Polish QA review" hint="Approve or request fixes.">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => act(() => api.qaReview(map.id, "approved"))}
                      className="py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700"
                    >
                      Approved
                    </button>
                    <button
                      onClick={() => act(() => api.qaReview(map.id, "fix", "Corrections needed"))}
                      className="py-2.5 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-200 hover:bg-red-100"
                    >
                      Fix
                    </button>
                  </div>
                </ActionBlock>
              )}

              {isQa && map.qaStatus === "FIX_DONE" && (
                <ActionBlock title="Fixes completed" hint="Inspector marked FixDone.">
                  <button
                    onClick={() => act(() => api.qaReview(map.id, "approved"))}
                    className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700"
                  >
                    Approved
                  </button>
                </ActionBlock>
              )}

              {isLeader && (
                <button
                  onClick={() => {
                    if (confirm(`Cancel ${map.mapNumber}? It will move to History.`)) {
                      act(() => api.cancelMap(map.id));
                    }
                  }}
                  className="w-full py-2 text-xs text-red-500 hover:text-red-700"
                >
                  Cancel this map
                </button>
              )}
            </div>
          )}

          {map.phase === "APPROVED" && (
            <div className="px-6 py-5 bg-emerald-50 border-t border-emerald-100 text-center text-sm text-emerald-800 font-medium">
              Map approved — workflow complete
            </div>
          )}

          {map.phase === "CANCELLED" && (
            <div className="px-6 py-5 bg-red-50 border-t border-red-100 text-center text-sm text-red-800 font-medium">
              This map was cancelled
            </div>
          )}
        </div>

        {/* Tasks */}
        {!isArchived && (isLeader || isQa || (isInspector && isAssignedInspector)) && (
          <div className="mt-6 bg-white rounded-3xl border border-border shadow-sm p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
              Tasks
            </h2>

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
                className="space-y-2 mb-4"
              >
                <input
                  required
                  placeholder="Task title..."
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm"
                />
                <input
                  placeholder="Details (optional)"
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 bg-slate-800 text-white text-sm font-medium rounded-xl"
                >
                  Add task
                </button>
              </form>
            )}

            <TaskTable
              tasks={map.tasks}
              mapNumber={map.mapNumber}
              canEdit={isInspector && isAssignedInspector}
              onStatusChange={async (taskId, status) => {
                await api.updateTaskStatus(taskId, status);
                load();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBlock({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-muted mt-0.5 mb-3">{hint}</p>
      {children}
    </div>
  );
}
