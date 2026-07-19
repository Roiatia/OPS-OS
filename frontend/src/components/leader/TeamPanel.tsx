import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import { getIdleInspectors, getIdleQaMembers } from "../../lib/assignment";
import {
  DUE_DATE_CLASS,
  formatDueDate,
  getDueDateStatus,
} from "../../lib/dates";
import {
  getActiveWorkForMember,
  getMapDisplayState,
  getMapStation,
  getTaskType,
  workflowStateTone,
} from "../../lib/mapDisplay";
import { Badge } from "@/components/common/Badge";
import { Modal } from "@/components/common/Modal";

interface Props {
  team: TeamMember[];
  maps: MapRecord[];
  onRefresh: () => void;
}

export function TeamPanel({ team, maps, onRefresh }: Props) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskForm, setTaskForm] = useState({ mapId: "", title: "", description: "" });

  const assignableTeam = team.filter((m) =>
    m.roles.some((r) => r.role === "MAPPING_INSPECTOR" || r.role === "GRAPHIC_QA")
  );

  const idleInspectors = useMemo(() => getIdleInspectors(team, maps), [team, maps]);
  const idleQaMembers = useMemo(() => getIdleQaMembers(team, maps), [team, maps]);

  const filteredTeam = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignableTeam;
    return assignableTeam.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.roles.some((r) => ROLE_LABELS[r.role].toLowerCase().includes(q))
    );
  }, [assignableTeam, search]);

  const selectedMember = assignableTeam.find((m) => m.id === selectedMemberId) ?? null;
  const selectedWork = selectedMember ? getActiveWorkForMember(maps, selectedMember.id) : [];

  const sortedSelectedWork = useMemo(
    () =>
      [...selectedWork].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }),
    [selectedWork]
  );

  async function handleAssignTask(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMember) return;
    setError("");
    setLoading(true);
    try {
      const map = maps.find((m) => m.id === taskForm.mapId);
      await api.createTask(taskForm.mapId, {
        title: taskForm.title,
        description: taskForm.description || undefined,
        assignedToId: selectedMember.id,
        phase: map?.phase === "POLISH" || map?.phase === "QA_REVIEW" ? "POLISH" : "PREP",
      });
      setTaskOpen(false);
      setTaskForm({ mapId: "", title: "", description: "" });
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      {idleInspectors.length > 0 && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          role="alert"
        >
          <p className="text-sm font-semibold text-amber-900">
            {idleInspectors.length} inspector{idleInspectors.length !== 1 ? "s" : ""} with little
            or no work
          </p>
          <p className="text-xs text-amber-800 mt-1">
            These team members have 0–1 active maps and may be waiting for assignments:
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {idleInspectors.map(({ member, activeCount }) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => setSelectedMemberId(member.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 transition-colors"
                >
                  {member.name}
                  <span className="tabular-nums text-amber-700">
                    ({activeCount} map{activeCount !== 1 ? "s" : ""})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {idleQaMembers.length > 0 && (
        <div
          className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3"
          role="alert"
        >
          <p className="text-sm font-semibold text-violet-900">
            {idleQaMembers.length} QA member{idleQaMembers.length !== 1 ? "s" : ""} with little
            or no work
          </p>
          <p className="text-xs text-violet-800 mt-1">
            These QA reviewers have 0–1 active maps and may be waiting for assignments:
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {idleQaMembers.map(({ member, activeCount }) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => setSelectedMemberId(member.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-violet-200 px-2.5 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100 transition-colors"
                >
                  {member.name}
                  <span className="tabular-nums text-violet-700">
                    ({activeCount} map{activeCount !== 1 ? "s" : ""})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="space-y-3">
          <label className="block">
            <span className="sr-only">Search team members</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team members..."
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>

          <ul className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden shadow-sm max-h-[520px] overflow-y-auto">
            {filteredTeam.length === 0 ? (
              <li className="px-4 py-8 text-sm text-muted text-center">
                {search ? "No team members match your search." : "No team members found."}
              </li>
            ) : (
              filteredTeam.map((member) => {
                const workCount = getActiveWorkForMember(maps, member.id).length;
                const isInspector = member.roles.some((r) => r.role === "MAPPING_INSPECTOR");
                const isQa = member.roles.some((r) => r.role === "GRAPHIC_QA");
                const isIdle = (isInspector || isQa) && workCount <= 1;
                const primaryRole = member.roles.find(
                  (r) => r.role === "MAPPING_INSPECTOR" || r.role === "GRAPHIC_QA"
                );
                const isSelected = selectedMemberId === member.id;

                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedMemberId(isSelected ? null : member.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all ${
                        isSelected
                          ? "bg-brand-50 border-l-[3px] border-l-brand-600"
                          : "hover:bg-orange-50/50 border-l-[3px] border-l-transparent"
                      }`}
                    >
                      <div
                        className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
                          isSelected
                            ? "bg-brand-600 text-white"
                            : "bg-brand-100 text-brand-700"
                        }`}
                      >
                        {member.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate flex items-center gap-1.5">
                          {member.name}
                          {isIdle && (
                            <span
                              className="shrink-0 w-2 h-2 rounded-full bg-amber-500"
                              title="Low workload — consider assigning maps"
                            />
                          )}
                        </div>
                        <div className="text-xs text-muted truncate">
                          {primaryRole ? ROLE_LABELS[primaryRole.role] : ""}
                        </div>
                      </div>
                      <span
                        className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${
                          isIdle
                            ? "bg-amber-100 text-amber-800"
                            : isSelected
                              ? "bg-brand-600 text-white"
                              : "bg-slate-100 text-muted"
                        }`}
                      >
                        {workCount}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="bg-card border border-border rounded-2xl min-h-[280px] shadow-sm overflow-hidden">
          {!selectedMember ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[280px] px-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700">Select a team member</p>
              <p className="text-sm text-muted mt-1 max-w-xs">
                Tap a name to view their profile, assigned maps, deadlines, and assign tasks
              </p>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-brand-50 to-white flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-600 text-white flex items-center justify-center text-lg font-semibold">
                    {selectedMember.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{selectedMember.name}</p>
                    <p className="text-sm text-muted">{selectedMember.email}</p>
                    <p className="text-xs text-brand-700 font-medium mt-0.5">
                      {selectedMember.roles
                        .filter((r) => r.role === "MAPPING_INSPECTOR" || r.role === "GRAPHIC_QA")
                        .map((r) => ROLE_LABELS[r.role])
                        .join(" · ")}
                    </p>
                    {selectedWork.length <= 1 &&
                      (selectedMember.roles.some((r) => r.role === "MAPPING_INSPECTOR") ||
                        selectedMember.roles.some((r) => r.role === "GRAPHIC_QA")) && (
                        <p className="text-xs text-amber-700 font-medium mt-1">
                          Low workload — assign more maps to keep them busy
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right mr-2">
                    <div className="text-2xl font-bold text-brand-700">{selectedWork.length}</div>
                    <div className="text-xs text-muted">active maps</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setTaskForm({ mapId: "", title: "", description: "" });
                      setTaskOpen(true);
                    }}
                    className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                  >
                    Assign task
                  </button>
                </div>
              </div>

              {error && (
                <p className="mx-5 mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              {selectedWork.length === 0 ? (
                <p className="px-5 py-10 text-sm text-muted text-center">No active maps assigned</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sortedSelectedWork.map((map) => {
                    const taskType = getTaskType(map);
                    const state = getMapDisplayState(map);
                    const asInspector = map.assignedInspector?.id === selectedMember.id;
                    const asQa = map.assignedQa?.id === selectedMember.id;
                    const dueStatus = getDueDateStatus(map.dueDate);

                    return (
                      <li key={map.id} className="px-5 py-4 hover:bg-orange-50/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              to={`/app/maps/${map.id}`}
                              className="font-mono font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {map.mapNumber}
                            </Link>
                            <div className="text-sm text-muted mt-0.5">{map.client}</div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {taskType && (
                                <Badge
                                  label={taskType}
                                  tone={taskType === "Upload" ? "PREP" : taskType === "Uploaded" ? "UPLOAD_REVIEW" : "POLISH"}
                                />
                              )}
                              <Badge
                                label={getMapStation(map)}
                                tone={map.station === "OPS" ? "FIELD" : "PREP"}
                              />
                              {state !== "—" && (
                                <Badge label={state} tone={workflowStateTone(state)} />
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 space-y-1">
                            <span className="block text-xs font-medium text-muted px-2 py-1 rounded-md bg-slate-50">
                              {asInspector && asQa ? "Inspector + QA" : asInspector ? "Inspector" : "QA"}
                            </span>
                            {map.dueDate ? (
                              <span className={`block text-xs ${DUE_DATE_CLASS[dueStatus]}`}>
                                Due {formatDueDate(map.dueDate)}
                                {dueStatus === "overdue" && " · Overdue"}
                                {dueStatus === "soon" && " · Soon"}
                              </span>
                            ) : (
                              <span className="block text-xs text-slate-400">No deadline</span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {taskOpen && selectedMember && (
        <Modal title={`Assign task to ${selectedMember.name}`} onClose={() => setTaskOpen(false)}>
          <form onSubmit={handleAssignTask} className="space-y-4">
            <label className="block">
              <span className="text-sm text-muted">Map</span>
              <select
                required
                value={taskForm.mapId}
                onChange={(e) => setTaskForm({ ...taskForm, mapId: e.target.value })}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none"
              >
                <option value="">Select map...</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.mapNumber} — {m.client}
                    {m.dueDate ? ` (due ${formatDueDate(m.dueDate)})` : ""}
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
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm text-muted">Details (optional)</span>
              <textarea
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                rows={2}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setTaskOpen(false)} className="px-4 py-2 text-sm text-muted">
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
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
