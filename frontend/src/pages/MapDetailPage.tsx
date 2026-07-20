import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import { hasSupervisorRole } from "../lib/roles";
import { useAuth, hasRole } from "../context/AuthContext";
import { PhaseStepper } from "@/components/common/PhaseStepper";
import { Badge } from "@/components/common/Badge";
import { TaskTable } from "@/components/common/TaskTable";
import { AssignMapModal } from "../components/leader/AssignMapModal";
import { AssignQaModal } from "../components/leader/AssignQaModal";
import { getMapDisplayState, workflowStateTone, canAssignInspector, canAssignQa } from "../lib/mapDisplay";
import { toDateInputValue, formatDueDate, getDueDateStatus, DUE_DATE_CLASS } from "../lib/dates";
import { SHIFTS, getShiftInspectors } from "../lib/shifts";
import type { MapRecord, TeamMember } from "../types";
import { PHASE_LABELS } from "../types";

export function MapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Return to wherever the user opened this map from (Hub, Maps board, etc.)
  // instead of bouncing to /app, which resets them to their default section.
  const goBack = () => navigate(-1);
  const [map, setMap] = useState<MapRecord | null>(null);
  const [allMaps, setAllMaps] = useState<MapRecord[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "" });
  const [assignInspectorOpen, setAssignInspectorOpen] = useState(false);
  const [assignQaOpen, setAssignQaOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [dueDateSaving, setDueDateSaving] = useState(false);

  const isLeader = hasRole(user!, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN", "OPS_MANAGER_2");
  const isOpsAdmin = hasRole(user!, "OPS_ADMIN", "OPS_MANAGER_2");
  const isInspector = hasRole(user!, "MAPPING_INSPECTOR");
  const isQa = hasRole(user!, "GRAPHIC_QA");
  const isSupervisor = hasSupervisorRole(user);
  const isArchived = map?.phase === "APPROVED" || map?.phase === "CANCELLED";

  function load() {
    if (!id) return;
    api.getMap(id).then(setMap).catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (!user || !hasRole(user, "GRAPHIC_TEAM_LEADER", "OPS_ADMIN", "OPS_MANAGER_2")) return;
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
          <button
            type="button"
            onClick={goBack}
            className="text-sm text-brand-600 hover:underline"
          >
            ← Back to maps
          </button>
          <p className="mt-4 text-muted">{error || "Loading..."}</p>
        </div>
      </div>
    );
  }

  const displayState = getMapDisplayState(map);
  const isAssignedInspector = map.assignedInspector?.id === user!.id;
  const isAssignedSupervisor = map.assignedSupervisor?.id === user!.id;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-50 to-white py-8 px-4">
      <div className="max-w-xl mx-auto">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium mb-6"
        >
          ← Back to maps
        </button>

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

              {isSupervisor && isAssignedSupervisor && map.phase === "FIELD" && map.supervisorStatus !== "DONE" && (
                <ActionBlock
                  title="Field mapping"
                  hint="Work with your mapper on-site. Mark Done when the store map is complete."
                >
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { value: "ACCEPTED", label: "Accepted" },
                        { value: "PROCESSING", label: "Mapping" },
                        { value: "DONE", label: "Done" },
                      ] as const
                    ).map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => act(() => api.updateSupervisorStatus(map.id, value))}
                        className={`py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                          map.supervisorStatus === value
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

              {isSupervisor && isAssignedSupervisor && map.phase === "FIELD" && map.supervisorStatus === "DONE" && (
                <ActionBlock title="Field mapping complete" hint="Waiting for OPS manager to release to graphics polish.">
                  <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2 text-center">
                    Submitted to OPS for review
                  </p>
                </ActionBlock>
              )}

              {isOpsAdmin && map.phase === "FIELD" && (
                <ActionBlock
                  title="OPS field review"
                  hint={
                    map.supervisorStatus === "DONE"
                      ? "Supervisor marked done. Release to graphics for polish."
                      : "Waiting for supervisor to complete field mapping."
                  }
                >
                  <button
                    onClick={() => act(() => api.fieldComplete(map.id))}
                    disabled={map.supervisorStatus !== "DONE"}
                    className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Release to graphics polish
                  </button>
                </ActionBlock>
              )}

              {isLeader && !isOpsAdmin && map.phase === "FIELD" && (
                <ActionBlock title="Field work" hint="Supervisors are mapping on-site. OPS manager releases to polish when done.">
                  <p className="text-sm text-muted text-center py-2">
                    {map.assignedSupervisor?.name ?? "Supervisor"} ·{" "}
                    {map.supervisorStatus?.toLowerCase() ?? "not started"}
                  </p>
                </ActionBlock>
              )}

              {isLeader && !isArchived && (
                <ActionBlock title="Leader assignments" hint="Assign team members and set deadlines.">
                  <div className="space-y-3">
                    {canAssignInspector(map) && (
                      <button
                        type="button"
                        onClick={() => setAssignInspectorOpen(true)}
                        className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
                      >
                        {map.assignedInspector ? "Reassign inspector" : "Assign inspector"}
                      </button>
                    )}
                    {canAssignQa(map) && (
                      <button
                        type="button"
                        onClick={() => setAssignQaOpen(true)}
                        className="w-full py-2.5 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700"
                      >
                        {map.assignedQa ? "Reassign QA" : "Assign QA"}
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

      {isLeader && map && assignInspectorOpen && (
        <AssignMapModal
          map={map}
          team={team}
          maps={allMaps}
          loading={assignLoading}
          onClose={() => setAssignInspectorOpen(false)}
          onAssign={async (opts) => {
            setAssignLoading(true);
            setError("");
            try {
              if (opts.mode === "individual" && opts.memberId) {
                const updated = await api.assignInspector(map.id, opts.memberId, opts.attachment);
                setMap(updated);
              } else if (opts.mode === "shift" && opts.shiftId) {
                const shift = SHIFTS.find((s) => s.id === opts.shiftId)!;
                const shiftInspectors = getShiftInspectors(team, opts.shiftId);
                const leadInspector = shiftInspectors[0];
                if (!leadInspector) throw new Error("No inspectors on this shift");

                const updated = await api.assignInspector(
                  map.id,
                  leadInspector.id,
                  opts.attachment
                );
                setMap(updated);

                const taskPhase =
                  map.phase === "POLISH" || map.phase === "QA_REVIEW" ? "POLISH" : "PREP";
                await Promise.all(
                  shiftInspectors.map((inspector) =>
                    api.createTask(map.id, {
                      title: `${shift.label} shift — ${map.mapNumber}`,
                      description: `Assigned to ${shift.label} shift (${shift.hours})`,
                      assignedToId: inspector.id,
                      phase: taskPhase,
                    })
                  )
                );
                load();
              }
              setAssignInspectorOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setAssignLoading(false);
            }
          }}
        />
      )}

      {isLeader && map && assignQaOpen && (
        <AssignQaModal
          map={map}
          team={team}
          maps={allMaps}
          loading={assignLoading}
          onClose={() => setAssignQaOpen(false)}
          onAssign={async (opts) => {
            setAssignLoading(true);
            setError("");
            try {
              const updated = await api.assignQa(map.id, opts.qaId, opts.attachment);
              setMap(updated);
              setAssignQaOpen(false);
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
