import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { formatDueDate } from "../../lib/dates";
import {
  isNewMapForLeader,
  getBulkDeleteConfirmMessage,
  canDeleteMap,
  WORKFLOW_PHASE_TARGETS,
  getMapWorkflowPhaseTarget,
} from "../../lib/mapDisplay";
import type { WorkflowPhaseTarget } from "../../types";
import {
  buildBalancedInspectorAssignments,
  buildBalancedQaAssignments,
  countInspectorActiveMaps,
  summarizeQaShufflePlan,
  summarizeShufflePlan,
} from "../../lib/assignment";
import { SHIFTS, getShiftInspectors, type ShiftId } from "../../lib/shifts";
import { AssignCellButton } from "./AssignCellButton";
import { InspectorAssignModal } from "./InspectorAssignModal";
import { QaAssignModal } from "./QaAssignModal";
import { QaOverrideCell } from "./QaOverrideCell";
import { Modal } from "./Modal";

interface Props {
  maps: MapRecord[];
  team: TeamMember[];
  onRefresh: () => void;
  onMapUpdated?: (maps: MapRecord[]) => void;
}

export function NewMapsPanel({ maps, team, onRefresh, onMapUpdated }: Props) {
  function commitMap(map: MapRecord) {
    if (onMapUpdated) onMapUpdated([map]);
    else onRefresh();
  }
  const newMaps = maps.filter(isNewMapForLeader);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [phaseSavingId, setPhaseSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignInspectorMap, setAssignInspectorMap] = useState<MapRecord | null>(null);
  const [assignQaMap, setAssignQaMap] = useState<MapRecord | null>(null);
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [shuffleStep, setShuffleStep] = useState<"pick" | "preview">("pick");
  const [shuffleInspectorIds, setShuffleInspectorIds] = useState<Set<string>>(new Set());

  const inspectors = useMemo(
    () => team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR")),
    [team]
  );
  const qaMembers = useMemo(
    () => team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA")),
    [team]
  );

  const selectedMaps = useMemo(
    () => newMaps.filter((m) => selected.has(m.id)),
    [newMaps, selected]
  );

  const selectedNeedingInspector = useMemo(
    () => selectedMaps.filter((m) => !m.assignedInspector),
    [selectedMaps]
  );

  const selectedNeedingAutoQa = useMemo(
    () => selectedMaps.filter((m) => !m.assignedQa),
    [selectedMaps]
  );

  const deletableSelected = useMemo(
    () => selectedMaps.filter(canDeleteMap),
    [selectedMaps]
  );

  const assignedNewMaps = useMemo(
    () => newMaps.filter((m) => m.assignedInspector || m.assignedQa),
    [newMaps]
  );

  const assignedSelected = useMemo(
    () => selectedMaps.filter((m) => m.assignedInspector || m.assignedQa),
    [selectedMaps]
  );

  const shuffleInspectors = inspectors.filter((m) => shuffleInspectorIds.has(m.id));

  const inspectorPreviewRows = useMemo(() => {
    if (selectedNeedingInspector.length === 0 || shuffleInspectors.length === 0) return [];
    const plan = buildBalancedInspectorAssignments(
      selectedNeedingInspector,
      shuffleInspectors,
      maps
    );
    return summarizeShufflePlan(plan, shuffleInspectors, maps);
  }, [selectedNeedingInspector, shuffleInspectors, maps]);

  const qaPreviewRows = useMemo(() => {
    if (selectedNeedingAutoQa.length === 0 || qaMembers.length === 0) return [];
    const plan = buildBalancedQaAssignments(selectedNeedingAutoQa, qaMembers, maps);
    return summarizeQaShufflePlan(plan, qaMembers, maps);
  }, [selectedNeedingAutoQa, qaMembers, maps]);

  const allSelected = newMaps.length > 0 && newMaps.every((m) => selected.has(m.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(newMaps.map((m) => m.id)));
    }
  }

  function openShuffleModal() {
    setError("");
    setShuffleStep("pick");
    setShuffleInspectorIds(new Set(inspectors.map((m) => m.id)));
    setShuffleOpen(true);
  }

  function toggleShuffleInspector(id: string) {
    setShuffleInspectorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleBulkDelete() {
    if (deletableSelected.length === 0) return;
    if (!confirm(getBulkDeleteConfirmMessage(deletableSelected.length))) return;
    setError("");
    setLoading(true);
    try {
      await api.deleteMaps(deletableSelected.map((m) => m.id));
      setSelected(new Set());
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkUnassign(mapIds: string[]) {
    if (mapIds.length === 0) return;
    if (
      !confirm(
        `Unassign inspector and QA from ${mapIds.length} new map${mapIds.length === 1 ? "" : "s"}? You can shuffle-assign again after.`
      )
    ) {
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.bulkUnassignNewMaps(mapIds);
      setSelected(new Set());
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleShuffleAssign() {
    if (selectedMaps.length === 0) return;
    setError("");
    setLoading(true);
    try {
      await api.shuffleAssignNewMaps(
        selectedMaps.map((m) => m.id),
        shuffleInspectors.map((m) => m.id)
      );
      setShuffleOpen(false);
      setSelected(new Set());
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleInspectorAssign(opts: {
    mode: "individual" | "shift";
    inspectorId: string;
    shiftId?: ShiftId;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) {
    if (!assignInspectorMap) return;
    setError("");
    setLoading(true);
    try {
      const map = assignInspectorMap;
      let updated: MapRecord;
      if (opts.mode === "shift" && opts.shiftId) {
        const shift = SHIFTS.find((s) => s.id === opts.shiftId)!;
        const shiftInspectors = getShiftInspectors(team, opts.shiftId);
        updated = await api.assignInspector(map.id, opts.inspectorId, opts.attachment);
        for (const inspector of shiftInspectors) {
          await api.createTask(map.id, {
            title: `${shift.label} shift — ${map.mapNumber}`,
            description: `Assigned to ${shift.label} shift (${shift.hours})`,
            assignedToId: inspector.id,
            phase: "PREP",
          });
        }
        onRefresh();
      } else {
        updated = await api.assignInspector(map.id, opts.inspectorId, opts.attachment);
        commitMap(updated);
      }
      setAssignInspectorMap(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleInspectorUnassign() {
    if (!assignInspectorMap) return;
    setError("");
    setLoading(true);
    try {
      commitMap(await api.unassignInspector(assignInspectorMap.id));
      setAssignInspectorMap(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleQaAssign(opts: {
    qaId: string;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) {
    if (!assignQaMap) return;
    setError("");
    setLoading(true);
    try {
      commitMap(await api.assignQa(assignQaMap.id, opts.qaId, opts.attachment));
      setAssignQaMap(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleQaUnassign() {
    if (!assignQaMap) return;
    setError("");
    setLoading(true);
    try {
      commitMap(await api.unassignQa(assignQaMap.id));
      setAssignQaMap(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePhaseChange(mapId: string, workflowPhaseTarget: WorkflowPhaseTarget) {
    setError("");
    setPhaseSavingId(mapId);
    try {
      commitMap(await api.updateMapWorkflowPhaseTarget(mapId, workflowPhaseTarget));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhaseSavingId(null);
    }
  }

  async function handleSave(mapId: string) {
    setError("");
    setSavingId(mapId);
    try {
      commitMap(await api.releaseMapToPipeline(mapId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  const canShuffle =
    selectedMaps.length > 0 && selectedNeedingInspector.length > 0 && inspectors.length > 0;

  return (
    <section className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50/80 to-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-amber-200/80">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-amber-950">New maps</h2>
            <span className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
              {newMaps.length}
            </span>
          </div>
          {assignedNewMaps.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => handleBulkUnassign(assignedNewMaps.map((m) => m.id))}
              className="ml-auto px-3 py-1.5 text-sm font-semibold text-amber-950 border border-amber-300 bg-white rounded-lg hover:bg-amber-50 disabled:opacity-50"
            >
              Unassign all ({assignedNewMaps.length})
            </button>
          )}
        </div>
        <p className="text-sm text-amber-900/70 mt-1 max-w-2xl">
          Maps from CS land here first. Assign an inspector — QA is assigned automatically by
          workload balance. Use <strong>Change</strong> on the QA column to override (e.g. when
          someone is absent). Assigning an inspector moves the map to the pipeline automatically.
          Use <strong>Shuffle</strong> to distribute inspectors across selected maps.
        </p>
      </div>

      {error && (
        <p className="mx-5 mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {selectedMaps.length > 0 && (
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 bg-amber-100/60 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-amber-950">
            {selectedMaps.length} selected
          </span>

          {canShuffle && (
            <button
              type="button"
              disabled={loading}
              onClick={openShuffleModal}
              className="px-4 py-1.5 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
            >
              Shuffle assign
            </button>
          )}

          {assignedSelected.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => handleBulkUnassign(assignedSelected.map((m) => m.id))}
              className="px-4 py-1.5 text-sm font-semibold text-amber-950 border border-amber-300 bg-white rounded-lg hover:bg-amber-50 disabled:opacity-50"
            >
              Unassign selected ({assignedSelected.length})
            </button>
          )}

          {deletableSelected.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={handleBulkDelete}
              className="px-4 py-1.5 text-sm font-semibold text-red-700 border border-red-200 bg-white rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Delete selected ({deletableSelected.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted hover:text-slate-900 ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      {newMaps.length === 0 ? (
        <p className="px-5 py-10 text-sm text-muted text-center">
          No new maps right now. Add one from CS or wait for the next intake batch.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-amber-100/50 text-left text-xs text-amber-900 border-b border-amber-200/80">
                <th className="px-4 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    title="Select all new maps"
                  />
                </th>
                <th className="px-4 py-2.5 font-semibold">Map</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Jira</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 font-semibold min-w-[110px]">Phase</th>
                <th className="px-4 py-2.5 font-semibold min-w-[90px]">Inspector</th>
                <th className="px-4 py-2.5 font-semibold min-w-[90px]">QA</th>
                <th className="px-4 py-2.5 font-semibold w-[88px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {newMaps.map((map) => (
                <tr
                  key={map.id}
                  className={`bg-white/60 hover:bg-white ${selected.has(map.id) ? "ring-1 ring-inset ring-amber-300" : ""}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(map.id)}
                      onChange={() => toggleSelect(map.id)}
                      aria-label={`Select ${map.mapNumber}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/app/maps/${map.id}`}
                      className="font-mono font-semibold text-brand-600 hover:underline"
                    >
                      {map.mapNumber}
                    </Link>
                    {map.description && (
                      <p className="text-xs text-muted mt-0.5 line-clamp-1">{map.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{map.client}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {map.jiraTicketId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {map.dueDate ? formatDueDate(map.dueDate) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={getMapWorkflowPhaseTarget(map)}
                      disabled={phaseSavingId === map.id || loading}
                      onChange={(e) =>
                        handlePhaseChange(map.id, e.target.value as WorkflowPhaseTarget)
                      }
                      className="w-full min-w-[100px] border border-amber-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
                      title="Workflow phase when saved to pipeline"
                    >
                      {WORKFLOW_PHASE_TARGETS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <AssignCellButton
                      assigned={!!map.assignedInspector}
                      assigneeName={map.assignedInspector?.name}
                      tone="brand"
                      onClick={() => {
                        setError("");
                        setAssignInspectorMap(map);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <QaOverrideCell
                      map={map}
                      disabled={loading}
                      onChange={() => {
                        setError("");
                        setAssignQaMap(map);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={savingId === map.id || loading || !map.assignedInspector}
                      onClick={() => handleSave(map.id)}
                      className="w-full px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      title="Move to pipeline table (usually automatic when inspector is assigned)"
                    >
                      {savingId === map.id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assignInspectorMap && (
        <InspectorAssignModal
          map={assignInspectorMap}
          team={team}
          maps={maps}
          loading={loading}
          onClose={() => setAssignInspectorMap(null)}
          onAssign={handleInspectorAssign}
          onUnassign={handleInspectorUnassign}
        />
      )}

      {assignQaMap && (
        <QaAssignModal
          map={assignQaMap}
          team={team}
          maps={maps}
          loading={loading}
          onClose={() => setAssignQaMap(null)}
          onAssign={handleQaAssign}
          onUnassign={handleQaUnassign}
        />
      )}

      {shuffleOpen && (
        <Modal
          title={
            shuffleStep === "pick"
              ? `Shuffle assign (${selectedMaps.length} maps)`
              : `Preview shuffle (${selectedMaps.length} maps)`
          }
          onClose={() => !loading && setShuffleOpen(false)}
          wide
        >
          <div className="space-y-4">
            {shuffleStep === "pick" ? (
              <>
                <p className="text-sm text-muted">
                  Inspectors are distributed by active workload. QA is auto-assigned to the
                  least-loaded reviewer for each map without QA.
                </p>

                {selectedNeedingInspector.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">
                      Inspectors ({selectedNeedingInspector.length} maps need inspector)
                    </h4>
                    <MemberPickList
                      members={inspectors}
                      selectedIds={shuffleInspectorIds}
                      activeCount={(id) => countInspectorActiveMaps(maps, id)}
                      onToggle={toggleShuffleInspector}
                    />
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShuffleOpen(false)}
                    className="px-4 py-2 text-sm text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedNeedingInspector.length > 0 && shuffleInspectorIds.size === 0}
                    onClick={() => setShuffleStep("preview")}
                    className="px-5 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                {inspectorPreviewRows.length > 0 && (
                  <PreviewTable title="Inspector distribution" rows={inspectorPreviewRows} />
                )}
                {qaPreviewRows.length > 0 && (
                  <PreviewTable
                    title="QA auto-assignment preview"
                    rows={qaPreviewRows}
                    tone="violet"
                  />
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setShuffleStep("pick")}
                    className="px-4 py-2 text-sm text-muted"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleShuffleAssign}
                    className="px-5 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50"
                  >
                    {loading ? "Assigning…" : "Confirm shuffle"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

function MemberPickList({
  members,
  selectedIds,
  activeCount,
  onToggle,
  tone = "brand",
}: {
  members: TeamMember[];
  selectedIds: Set<string>;
  activeCount: (id: string) => number;
  onToggle: (id: string) => void;
  tone?: "brand" | "violet";
}) {
  const avatarClass =
    tone === "violet" ? "bg-violet-100 text-violet-700" : "bg-brand-100 text-brand-700";

  if (members.length === 0) {
    return <p className="text-sm text-muted">No team members available.</p>;
  }

  return (
    <ul className="rounded-xl border border-border divide-y divide-border max-h-48 overflow-y-auto">
      {members.map((member) => {
        const active = activeCount(member.id);
        const checked = selectedIds.has(member.id);
        return (
          <li key={member.id}>
            <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(member.id)}
              />
              <div
                className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${avatarClass}`}
              >
                {member.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{member.name}</div>
                <div className="text-xs text-muted">
                  {active} active map{active !== 1 ? "s" : ""}
                </div>
              </div>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function PreviewTable({
  title,
  rows,
  tone = "brand",
}: {
  title: string;
  rows: {
    inspectorId: string;
    inspectorName: string;
    currentActive: number;
    receiving: number;
    totalAfter: number;
  }[];
  tone?: "brand" | "violet";
}) {
  const highlight = tone === "violet" ? "bg-violet-50/40" : "bg-brand-50/40";
  const accent = tone === "violet" ? "text-violet-700" : "text-brand-700";

  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-muted border-b border-border">
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium text-right">Active now</th>
              <th className="px-4 py-2 font-medium text-right">Receiving</th>
              <th className="px-4 py-2 font-medium text-right">Total after</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.inspectorId} className={row.receiving > 0 ? highlight : ""}>
                <td className="px-4 py-2.5 font-medium">{row.inspectorName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.currentActive}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${accent}`}>
                  +{row.receiving}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                  {row.totalAfter}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
