import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth, hasRole } from "../context/AuthContext";
import { PhaseStepper } from "../components/PhaseStepper";
import { Badge } from "../components/Badge";
import { TaskTable } from "../components/TaskTable";
import { DeleteMapButton } from "../components/leader/DeleteMapButton";
import { InspectorAssignModal } from "../components/leader/InspectorAssignModal";
import { QaAssignModal } from "../components/leader/QaAssignModal";
import { getMapDisplayState, getWorkflowTimelineLabel, workflowStateTone, canAssignInspector, canAssignQa } from "../lib/mapDisplay";
import { toDateInputValue, formatDueDate, getDueDateStatus, DUE_DATE_CLASS } from "../lib/dates";
import { SHIFTS, getShiftInspectors } from "../lib/shifts";
import { MAP_STATUS_OPTIONS } from "../lib/activeMapsWorkflow";
import type { MapAttachment, MapRecord, TeamMember, MapStatus } from "../types";

export function MapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [map, setMap] = useState<MapRecord | null>(null);
  const [allMaps, setAllMaps] = useState<MapRecord[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "" });
  const [inspectorModalOpen, setInspectorModalOpen] = useState(false);
  const [qaModalOpen, setQaModalOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [dueDateSaving, setDueDateSaving] = useState(false);

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

  useEffect(() => {
    if (!user || !hasRole(user, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN")) return;
    Promise.all([api.getMaps(), api.getTeam()]).then(([m, t]) => {
      setAllMaps(m);
      setTeam(t);
    });
  }, [user]);

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
  const isAssignedQa = map.assignedQa?.id === user!.id;
  const canEditStatus =
    (isInspector && isAssignedInspector) || (isQa && isAssignedQa) || isLeader;

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
            {getWorkflowTimelineLabel(map.phase)}
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
                  <AttachmentRow key={att.id} attachment={att} />
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

              {canEditStatus && (
                <ActionBlock
                  title="Map status"
                  hint="One shared status — inspector and QA always see the same value."
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MAP_STATUS_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          if (value === "FIX") {
                            act(() =>
                              api.updateMapStatus(map.id, value, "Corrections needed")
                            );
                          } else {
                            act(() => api.updateMapStatus(map.id, value as MapStatus));
                          }
                        }}
                        className={`py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                          map.status === value
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

              {isLeader && map.phase === "FIELD" && (
                <ActionBlock
                  title="Uploaded to dashboard"
                  hint="Map is live on the client dashboard. Start polish when ready."
                >
                  <button
                    onClick={() => act(() => api.fieldComplete(map.id))}
                    className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
                  >
                    Start polish →
                  </button>
                </ActionBlock>
              )}

              {isLeader && !isArchived && (
                <ActionBlock title="Leader assignments" hint="Assign team members and set deadlines.">
                  <div className="space-y-3">
                    {canAssignInspector(map) && (
                      <button
                        type="button"
                        onClick={() => setInspectorModalOpen(true)}
                        className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
                      >
                        {map.assignedInspector ? "Inspector · Assigned" : "Inspector · Assign"}
                      </button>
                    )}
                    {canAssignQa(map) && (
                      <button
                        type="button"
                        onClick={() => setQaModalOpen(true)}
                        className="w-full py-2.5 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700"
                      >
                        {map.assignedQa ? "QA · Change" : "QA · Assign"}
                      </button>
                    )}
                    <label className="block">
                      <span className="text-xs text-muted">Deadline</span>
                      <input
                        type="date"
                        value={toDateInputValue(map.dueDate)}
                        disabled={dueDateSaving}
                        onChange={async (e) => {
                          setDueDateSaving(true);
                          setError("");
                          try {
                            const updated = await api.updateMapDueDate(
                              map.id,
                              e.target.value || null
                            );
                            setMap(updated);
                          } catch (err) {
                            setError((err as Error).message);
                          } finally {
                            setDueDateSaving(false);
                          }
                        }}
                        className="mt-1 w-full border border-border rounded-xl px-3 py-2 text-sm disabled:opacity-50"
                      />
                      {map.dueDate && (
                        <span
                          className={`block text-xs mt-1 ${DUE_DATE_CLASS[getDueDateStatus(map.dueDate)]}`}
                        >
                          {formatDueDate(map.dueDate)}
                        </span>
                      )}
                    </label>
                  </div>
                </ActionBlock>
              )}

              {isLeader && (
                <div className="space-y-2 pt-2 border-t border-border">
                  {!isArchived && (
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
                  <DeleteMapButton
                    map={map}
                    onDeleted={() => navigate("/app")}
                    className="w-full py-2"
                  />
                </div>
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

      {isLeader && map && inspectorModalOpen && (
        <InspectorAssignModal
          map={map}
          team={team}
          maps={allMaps}
          loading={assignLoading}
          onClose={() => setInspectorModalOpen(false)}
          onAssign={async (opts) => {
            setAssignLoading(true);
            setError("");
            try {
              if (opts.mode === "shift" && opts.shiftId) {
                const shift = SHIFTS.find((s) => s.id === opts.shiftId)!;
                const shiftInspectors = getShiftInspectors(team, opts.shiftId);
                let updated = await api.assignInspector(map.id, opts.inspectorId, opts.attachment);
                setMap(updated);
                const taskPhase =
                  map.phase === "POLISH" || map.phase === "QA_REVIEW" ? "POLISH" : "PREP";
                for (const inspector of shiftInspectors) {
                  await api.createTask(map.id, {
                    title: `${shift.label} shift — ${map.mapNumber}`,
                    description: `Assigned to ${shift.label} shift (${shift.hours})`,
                    assignedToId: inspector.id,
                    phase: taskPhase,
                  });
                }
                load();
              } else {
                const updated = await api.assignInspector(map.id, opts.inspectorId, opts.attachment);
                setMap(updated);
              }
              setInspectorModalOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setAssignLoading(false);
            }
          }}
          onUnassign={async () => {
            setAssignLoading(true);
            setError("");
            try {
              const updated = await api.unassignInspector(map.id);
              setMap(updated);
              setInspectorModalOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setAssignLoading(false);
            }
          }}
        />
      )}

      {isLeader && map && qaModalOpen && (
        <QaAssignModal
          map={map}
          team={team}
          maps={allMaps}
          loading={assignLoading}
          onClose={() => setQaModalOpen(false)}
          onAssign={async (opts) => {
            setAssignLoading(true);
            setError("");
            try {
              const updated = await api.assignQa(map.id, opts.qaId, opts.attachment);
              setMap(updated);
              setQaModalOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setAssignLoading(false);
            }
          }}
          onUnassign={async () => {
            setAssignLoading(true);
            setError("");
            try {
              const updated = await api.unassignQa(map.id);
              setMap(updated);
              setQaModalOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setAssignLoading(false);
            }
          }}
        />
      )}
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

function AttachmentRow({ attachment }: { attachment: MapAttachment }) {
  const [data, setData] = useState(attachment.data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ensureData() {
    if (data) return data;
    setLoading(true);
    setError("");
    try {
      const full = await api.getAttachment(attachment.id);
      setData(full.data);
      return full.data;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!attachment.mimeType.startsWith("image/") || data) return;
    let cancelled = false;
    setLoading(true);
    api
      .getAttachment(attachment.id)
      .then((full) => {
        if (!cancelled) setData(full.data);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.mimeType, data]);

  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-border p-3">
      {attachment.mimeType.startsWith("image/") && data ? (
        <img
          src={`data:${attachment.mimeType};base64,${data}`}
          alt={attachment.fileName}
          className="w-14 h-14 object-cover rounded-lg border border-border shrink-0"
        />
      ) : (
        <div className="w-14 h-14 rounded-lg bg-brand-50 flex items-center justify-center shrink-0 text-brand-600 text-xs font-bold">
          {loading ? "…" : "FILE"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{attachment.fileName}</p>
        <p className="text-xs text-muted">
          {attachment.uploadedBy.name} · {new Date(attachment.createdAt).toLocaleDateString()}
        </p>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      {!attachment.mimeType.startsWith("image/") && (
        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            const blobData = await ensureData();
            if (!blobData) return;
            const link = document.createElement("a");
            link.href = `data:${attachment.mimeType};base64,${blobData}`;
            link.download = attachment.fileName;
            link.click();
          }}
          className="text-xs text-brand-600 font-medium shrink-0 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Download"}
        </button>
      )}
    </div>
  );
}
