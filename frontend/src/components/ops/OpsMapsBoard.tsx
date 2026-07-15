import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import { Badge } from "@/components/common/Badge";
import { Modal } from "@/components/common/Modal";
import { AssignSupervisorModal } from "./AssignSupervisorModal";
import { OpsActionLightLoadNote } from "./OpsActionLightLoadNote";
import { AssignMapModal } from "../leader/AssignMapModal";
import { AssignQaModal } from "../leader/AssignQaModal";
import {
  buildBalancedInspectorAssignments,
  buildBalancedSupervisorAssignments,
  countInspectorActiveMaps,
  countSupervisorActiveMaps,
  summarizeShufflePlan,
  summarizeSupervisorShufflePlan,
} from "../../lib/assignment";
import { memberIsSupervisor } from "../../lib/roles";
import {
  canAssignInspector,
  canAssignQa,
  EMPTY_COLUMN_FILTERS,
  getInspectorLabel,
  getMapDisplayState,
  getMapStation,
  getQaLabel,
  getTaskType,
  matchesColumnFilters,
  needsInspectorAssignment,
  WORKFLOW_STATES,
  workflowStateTone,
  type MapColumnFilters,
} from "../../lib/mapDisplay";
import {
  DUE_DATE_CLASS,
  formatDueDate,
  getDueDateStatus,
  toDateInputValue,
} from "../../lib/dates";
import {
  canAssignSupervisor,
  canReleaseToPolish,
  canSendToGraphics,
  canShuffleSupervisor,
  formatFieldDateTime,
  getOpsPipelineLabel,
  getOpsStatusLabel,
  getReadyToAcceptMaps,
  isReadyToRelease,
  matchesOpsQueue,
  needsSupervisorAssignment,
  OPS_QUEUE_TABS,
  opsPipelineTone,
  opsStatusTone,
  sortOpsMaps,
  type OpsMapQueue,
} from "../../lib/opsDisplay";
import { ReadyToAcceptModal } from "./ReadyToAcceptModal";
import type { OpsWorkloadAlert } from "../../lib/opsWorkload";

interface Props {
  maps: MapRecord[];
  team: TeamMember[];
  workloadAlerts: OpsWorkloadAlert[];
  /** Silent/debounced reload — fallback for bulk ops, errors, and realtime. */
  onRefresh: () => void;
  /** Patch a single updated map into parent state (mirrors MapHubBoard). */
  onPatch?: (map: MapRecord) => void;
  readyPanelOpen?: boolean;
  onReadyPanelOpenChange?: (open: boolean) => void;
}

const filterInputClass =
  "w-full border border-border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-500";

export function OpsMapsBoard({
  maps,
  team,
  workloadAlerts,
  onRefresh,
  onPatch,
  readyPanelOpen,
  onReadyPanelOpenChange,
}: Props) {
  const patch = (map: MapRecord) => (onPatch ? onPatch(map) : onRefresh());

  const [queue, setQueue] = useState<OpsMapQueue>("all");
  const [columnFilters, setColumnFilters] = useState<MapColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [phaseFilter, setPhaseFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dueDateSaving, setDueDateSaving] = useState<string | null>(null);
  const [assignMap, setAssignMap] = useState<MapRecord | null>(null);
  const [assignInspectorMap, setAssignInspectorMap] = useState<MapRecord | null>(null);
  const [assignQaMap, setAssignQaMap] = useState<MapRecord | null>(null);
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [inspectorShuffleOpen, setInspectorShuffleOpen] = useState(false);
  const [shuffleStep, setShuffleStep] = useState<"pick" | "preview">("pick");
  const [shuffleSupervisorIds, setShuffleSupervisorIds] = useState<Set<string>>(new Set());
  const [shuffleInspectorIds, setShuffleInspectorIds] = useState<Set<string>>(new Set());
  const [internalReadyPanelOpen, setInternalReadyPanelOpen] = useState(false);

  const readyMaps = useMemo(() => getReadyToAcceptMaps(maps), [maps]);
  const readyPanelIsOpen = readyPanelOpen ?? internalReadyPanelOpen;

  function setReadyPanelOpen(open: boolean) {
    onReadyPanelOpenChange?.(open);
    if (readyPanelOpen === undefined) {
      setInternalReadyPanelOpen(open);
    }
  }

  const supervisors = team.filter(memberIsSupervisor);
  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));

  const clients = useMemo(() => [...new Set(maps.map((m) => m.client))].sort(), [maps]);
  const phases = useMemo(
    () => [...new Set(maps.map((m) => getOpsPipelineLabel(m)))].sort(),
    [maps]
  );

  const filterOptions = useMemo(() => {
    const tasks = new Set<string>();
    const stations = new Set<string>();
    const states = new Set<string>();
    const inspectorNames = new Set<string>();
    const qaNames = new Set<string>();

    for (const map of maps) {
      tasks.add(getTaskType(map) ?? "—");
      stations.add(getMapStation(map));
      states.add(getMapDisplayState(map));
      inspectorNames.add(getInspectorLabel(map));
      qaNames.add(getQaLabel(map));
    }

    return {
      tasks: [...tasks].sort(),
      stations: [...stations].sort(),
      states: [...states].sort(),
      inspectors: [...inspectorNames].sort(),
      qa: [...qaNames].sort(),
    };
  }, [maps]);

  const filteredMaps = useMemo(
    () =>
      sortOpsMaps(
        maps.filter((map) => {
          if (!matchesOpsQueue(map, queue)) return false;
          if (phaseFilter && getOpsPipelineLabel(map) !== phaseFilter) return false;
          return matchesColumnFilters(map, columnFilters);
        })
      ),
    [maps, queue, phaseFilter, columnFilters]
  );

  const hasActiveFilters =
    phaseFilter !== "" || Object.values(columnFilters).some((v) => v !== "");

  function updateFilter(key: keyof MapColumnFilters, value: string) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setColumnFilters(EMPTY_COLUMN_FILTERS);
    setPhaseFilter("");
  }

  async function handleDueDateChange(mapId: string, value: string) {
    setDueDateSaving(mapId);
    setError("");
    try {
      const updated = await api.updateMapDueDate(mapId, value || null);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDueDateSaving(null);
    }
  }

  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        OPS_QUEUE_TABS.map((tab) => [tab.id, maps.filter((m) => matchesOpsQueue(m, tab.id)).length])
      ) as Record<OpsMapQueue, number>,
    [maps]
  );

  const selectedMaps = useMemo(
    () => maps.filter((m) => selected.has(m.id)),
    [maps, selected]
  );

  const selectedForShuffle = useMemo(
    () => selectedMaps.filter((m) => canShuffleSupervisor(m)),
    [selectedMaps]
  );

  const selectedForInspectorShuffle = useMemo(
    () => selectedMaps.filter((m) => needsInspectorAssignment(m)),
    [selectedMaps]
  );

  const shuffleSupervisors = supervisors.filter((m) => shuffleSupervisorIds.has(m.id));
  const shuffleInspectors = inspectors.filter((m) => shuffleInspectorIds.has(m.id));

  const shufflePreviewRows = useMemo(() => {
    if (selectedForShuffle.length < 1 || shuffleSupervisors.length === 0) return [];
    const plan = buildBalancedSupervisorAssignments(selectedForShuffle, shuffleSupervisors, maps);
    return summarizeSupervisorShufflePlan(plan, shuffleSupervisors, maps);
  }, [selectedForShuffle, shuffleSupervisors, maps]);

  const inspectorShufflePreviewRows = useMemo(() => {
    if (selectedForInspectorShuffle.length < 2 || shuffleInspectors.length === 0) return [];
    const plan = buildBalancedInspectorAssignments(
      selectedForInspectorShuffle,
      shuffleInspectors,
      maps
    );
    return summarizeShufflePlan(plan, shuffleInspectors, maps);
  }, [selectedForInspectorShuffle, shuffleInspectors, maps]);

  function toggleSelect(mapId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filteredMaps.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredMaps.map((m) => m.id)));
    }
  }

  function toggleShuffleSupervisor(id: string) {
    setShuffleSupervisorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  async function handleInspectorAssign(opts: {
    mode: "individual" | "shift";
    memberId?: string;
    shiftId?: import("../../lib/shifts").ShiftId;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) {
    if (!assignInspectorMap) return;
    setLoading(true);
    setError("");
    try {
      let updated: MapRecord | undefined;
      if (opts.mode === "individual" && opts.memberId) {
        updated = await api.assignInspector(assignInspectorMap.id, opts.memberId, opts.attachment);
      }
      setAssignInspectorMap(null);
      if (updated) patch(updated);
      else onRefresh();
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
    setLoading(true);
    setError("");
    try {
      const updated = await api.assignQa(assignQaMap.id, opts.qaId, opts.attachment);
      setAssignQaMap(null);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmInspectorShuffle() {
    if (selectedForInspectorShuffle.length < 2 || shuffleInspectors.length === 0) return;
    setLoading(true);
    setError("");
    try {
      await api.shuffleAssignMaps(
        selectedForInspectorShuffle.map((m) => m.id),
        shuffleInspectors.map((m) => m.id)
      );
      setInspectorShuffleOpen(false);
      setShuffleStep("pick");
      setShuffleInspectorIds(new Set());
      setSelected(new Set());
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(supervisorId: string) {
    if (!assignMap) return;
    setLoading(true);
    setError("");
    try {
      const updated = await api.assignSupervisor(assignMap.id, supervisorId);
      setAssignMap(null);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRelease(map: MapRecord) {
    if (!canReleaseToPolish(map)) return;
    setLoading(true);
    setError("");
    try {
      const updated = await api.fieldComplete(map.id);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendToGraphics(map: MapRecord) {
    setLoading(true);
    setError("");
    try {
      const updated = await api.releaseToGraphics(map.id);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmShuffle() {
    if (selectedForShuffle.length === 0 || shuffleSupervisors.length === 0) return;
    setLoading(true);
    setError("");
    try {
      await api.shuffleAssignSupervisors(
        selectedForShuffle.map((m) => m.id),
        shuffleSupervisors.map((m) => m.id)
      );
      setShuffleOpen(false);
      setShuffleStep("pick");
      setShuffleSupervisorIds(new Set());
      setSelected(new Set());
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {OPS_QUEUE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setQueue(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                queue === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-border text-slate-600 hover:bg-brand-50"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 tabular-nums opacity-80">({queueCounts[tab.id]})</span>
            </button>
          ))}
        </div>

        {readyMaps.length > 0 && (
          <button
            type="button"
            onClick={() => setReadyPanelOpen(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20"
          >
            Ready to accept ({readyMaps.length})
          </button>
        )}

        {selectedForShuffle.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setShuffleStep("pick");
              setShuffleOpen(true);
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700"
          >
            Shuffle ({selectedForShuffle.length})
          </button>
        )}
        {selectedForInspectorShuffle.length >= 2 && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setShuffleStep("pick");
              setShuffleInspectorIds(new Set(inspectors.map((m) => m.id)));
              setInspectorShuffleOpen(true);
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Shuffle ({selectedForInspectorShuffle.length})
          </button>
        )}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm text-brand-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm min-w-[1400px]">
          <thead>
            <tr className="border-b border-border bg-slate-50/80 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={filteredMaps.length > 0 && selected.size === filteredMaps.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-3 font-semibold min-w-[110px]">Map</th>
              <th className="px-3 py-3 font-semibold min-w-[90px]">Client</th>
              <th className="px-3 py-3 font-semibold min-w-[100px]">Pipeline</th>
              <th className="px-3 py-3 font-semibold min-w-[80px]">Task</th>
              <th className="px-3 py-3 font-semibold min-w-[80px]">Station</th>
              <th className="px-3 py-3 font-semibold min-w-[100px]">Graphics</th>
              <th className="px-3 py-3 font-semibold min-w-[100px]">Inspector</th>
              <th className="px-3 py-3 font-semibold min-w-[90px]">QA</th>
              <th className="px-3 py-3 font-semibold min-w-[100px]">Address</th>
              <th className="px-3 py-3 font-semibold min-w-[100px]">Supervisor</th>
              <th className="px-3 py-3 font-semibold min-w-[90px]">Mapper</th>
              <th className="px-3 py-3 font-semibold min-w-[90px]">Date</th>
              <th className="px-3 py-3 font-semibold min-w-[90px]">Status</th>
              <th className="px-3 py-3 font-semibold min-w-[110px]">Supervisor note</th>
              <th className="px-3 py-3 font-semibold min-w-[100px]">Deadline</th>
              <th className="px-3 py-3 font-semibold min-w-[120px]">Action</th>
            </tr>
            <tr className="border-b border-border bg-white text-left text-xs normal-case">
              <th className="px-3 py-2" />
              <th className="px-3 py-2">
                <input
                  type="text"
                  placeholder="Filter…"
                  value={columnFilters.map}
                  onChange={(e) => updateFilter("map", e.target.value)}
                  className={filterInputClass}
                />
              </th>
              <th className="px-3 py-2">
                <select
                  value={columnFilters.client}
                  onChange={(e) => updateFilter("client", e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2">
                <select
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {phases.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2">
                <select
                  value={columnFilters.task}
                  onChange={(e) => updateFilter("task", e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {filterOptions.tasks.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2">
                <select
                  value={columnFilters.station}
                  onChange={(e) => updateFilter("station", e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {filterOptions.stations.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2">
                <select
                  value={columnFilters.state}
                  onChange={(e) => updateFilter("state", e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  <option value="—">—</option>
                  {WORKFLOW_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2">
                <select
                  value={columnFilters.inspector}
                  onChange={(e) => updateFilter("inspector", e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {filterOptions.inspectors.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2">
                <select
                  value={columnFilters.qa}
                  onChange={(e) => updateFilter("qa", e.target.value)}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {filterOptions.qa.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-2" colSpan={6} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredMaps.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-4 py-10 text-center text-muted">
                  No maps in this queue.
                </td>
              </tr>
            ) : (
              filteredMaps.map((map) => {
                const taskType = getTaskType(map);
                const graphicsState = getMapDisplayState(map);
                const ready = isReadyToRelease(map);
                return (
                  <tr
                    key={map.id}
                    className={`align-top ${
                      map.fieldWorkStatus === "COMPLETED" && map.shiftLeaderApproved === false
                        ? "bg-rose-50/90 hover:bg-rose-50 ring-1 ring-inset ring-rose-300/70"
                        : ready
                          ? "bg-emerald-50/70 hover:bg-emerald-50 ring-1 ring-inset ring-emerald-200/60"
                          : "hover:bg-slate-50/50"
                    }`}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(map.id)}
                        onChange={() => toggleSelect(map.id)}
                        aria-label={`Select ${map.mapNumber}`}
                      />
                    </td>
                    <td className="px-3 py-3 font-medium whitespace-nowrap">
                      <Link to={`/app/maps/${map.id}`} className="text-brand-600 hover:underline">
                        {map.mapNumber}
                      </Link>
                      {map.fieldWorkStatus === "COMPLETED" && map.shiftLeaderApproved === false && (
                        <span className="ml-2 inline-block text-[10px] font-semibold text-rose-800 bg-rose-100 rounded px-1.5 py-0.5">
                          No SL approval
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">{map.client}</td>
                    <td className="px-3 py-3">
                      <Badge label={getOpsPipelineLabel(map)} tone={opsPipelineTone(map)} />
                    </td>
                    <td className="px-3 py-3">
                      {taskType ? (
                        <Badge
                          label={taskType}
                          tone={taskType === "Upload" ? "PREP" : "POLISH"}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge label={getMapStation(map)} tone={map.phase} />
                    </td>
                    <td className="px-3 py-3">
                      {graphicsState === "—" ? (
                        "—"
                      ) : (
                        <Badge label={graphicsState} tone={workflowStateTone(graphicsState)} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {map.assignedInspector?.name ?? (
                        needsInspectorAssignment(map) ? (
                          <span className="text-amber-600 text-xs font-medium">Unassigned</span>
                        ) : (
                          "—"
                        )
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {canAssignQa(map) ? (
                        map.assignedQa?.name ?? (
                          <span className="text-violet-700 text-xs font-medium">Needs QA</span>
                        )
                      ) : (
                        map.assignedQa?.name ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted text-xs max-w-[120px]">{map.area ?? "—"}</td>
                    <td className="px-3 py-3">
                      {map.assignedSupervisor?.name ?? (
                        needsSupervisorAssignment(map) ? (
                          <span className="text-amber-600 text-xs font-medium">Unassigned</span>
                        ) : (
                          "—"
                        )
                      )}
                    </td>
                    <td className="px-3 py-3">{map.mapperName ?? "—"}</td>
                    <td className="px-3 py-3 text-muted text-xs whitespace-nowrap">
                      {map.phase === "FIELD" ? formatFieldDateTime(map.fieldDate) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge label={getOpsStatusLabel(map)} tone={opsStatusTone(map)} />
                    </td>
                    <td
                      className="px-3 py-3 max-w-[140px] truncate text-xs text-muted"
                      title={map.opsManagerComment ?? ""}
                    >
                      {map.opsManagerComment ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5 min-w-[100px]">
                        <input
                          type="date"
                          value={toDateInputValue(map.dueDate)}
                          disabled={dueDateSaving === map.id}
                          onChange={(e) => handleDueDateChange(map.id, e.target.value)}
                          className="w-full border border-border rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
                          title="Set map deadline"
                        />
                        {map.dueDate && (
                          <span
                            className={`text-[10px] ${DUE_DATE_CLASS[getDueDateStatus(map.dueDate)]}`}
                          >
                            {formatDueDate(map.dueDate)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1 min-w-[120px]">
                        {canSendToGraphics(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => handleSendToGraphics(map)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                          >
                            Send to graphics
                          </button>
                        )}
                        {canAssignInspector(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setAssignInspectorMap(map)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                          >
                            Assign
                          </button>
                        )}
                        {canAssignQa(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setAssignQaMap(map)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                          >
                            Assign
                          </button>
                        )}
                        {canAssignSupervisor(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setAssignMap(map)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                          >
                            Assign
                          </button>
                        )}
                        {canReleaseToPolish(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => handleRelease(map)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            Accept &amp; send to polish
                          </button>
                        )}
                        {!canSendToGraphics(map) &&
                          !canAssignInspector(map) &&
                          !canAssignQa(map) &&
                          !canAssignSupervisor(map) &&
                          !canReleaseToPolish(map) && (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        <OpsActionLightLoadNote map={map} alerts={workloadAlerts} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {assignInspectorMap && (
        <AssignMapModal
          map={assignInspectorMap}
          team={team}
          maps={maps}
          loading={loading}
          onClose={() => setAssignInspectorMap(null)}
          onAssign={handleInspectorAssign}
        />
      )}

      {assignQaMap && (
        <AssignQaModal
          map={assignQaMap}
          team={team}
          maps={maps}
          loading={loading}
          onClose={() => setAssignQaMap(null)}
          onAssign={handleQaAssign}
        />
      )}

      {assignMap && (
        <AssignSupervisorModal
          map={assignMap}
          team={team}
          maps={maps}
          loading={loading}
          onClose={() => setAssignMap(null)}
          onAssign={handleAssign}
        />
      )}

      {shuffleOpen && (
        <Modal
          title={
            shuffleStep === "pick"
              ? `Choose supervisors for shuffle (${selectedForShuffle.length} maps)`
              : `Preview shuffle (${selectedForShuffle.length} maps)`
          }
          onClose={() => !loading && setShuffleOpen(false)}
          wide
        >
          <div className="space-y-4">
            {shuffleStep === "pick" ? (
              <>
                <p className="text-sm text-muted">
                  Select supervisors to receive field maps. Maps are split evenly — those with fewer
                  active maps get more.
                </p>
                <ul className="rounded-xl border border-border divide-y divide-border max-h-72 overflow-y-auto">
                  {supervisors.map((member) => {
                    const active = countSupervisorActiveMaps(maps, member.id);
                    const checked = shuffleSupervisorIds.has(member.id);
                    return (
                      <li key={member.id}>
                        <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleShuffleSupervisor(member.id)}
                          />
                          <div className="w-9 h-9 shrink-0 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold">
                            {member.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{member.name}</div>
                            <div className="text-xs text-muted">
                              {ROLE_LABELS.SUPERVISOR} · {active} active field map
                              {active !== 1 ? "s" : ""}
                            </div>
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShuffleOpen(false)}
                    className="px-4 py-2 text-sm text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={shuffleSupervisorIds.size === 0}
                    onClick={() => setShuffleStep("preview")}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white disabled:opacity-50"
                  >
                    Preview distribution
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {shuffleSupervisors.length} supervisor{shuffleSupervisors.length !== 1 ? "s" : ""}{" "}
                  will receive {selectedForShuffle.length} map
                  {selectedForShuffle.length !== 1 ? "s" : ""}.
                </p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs text-muted">
                        <th className="px-4 py-2">Supervisor</th>
                        <th className="px-4 py-2">Current</th>
                        <th className="px-4 py-2">Receiving</th>
                        <th className="px-4 py-2">Total after</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shufflePreviewRows.map((row) => (
                        <tr key={row.supervisorId}>
                          <td className="px-4 py-2 font-medium">{row.supervisorName}</td>
                          <td className="px-4 py-2 tabular-nums">{row.currentActive}</td>
                          <td className="px-4 py-2 tabular-nums text-violet-700 font-medium">
                            +{row.receiving}
                          </td>
                          <td className="px-4 py-2 tabular-nums font-semibold">{row.totalAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShuffleStep("pick")}
                    className="px-4 py-2 text-sm text-muted"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={confirmShuffle}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {loading ? "Assigning…" : "Confirm shuffle"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {inspectorShuffleOpen && (
        <Modal
          title={
            shuffleStep === "pick"
              ? `Choose inspectors for shuffle (${selectedForInspectorShuffle.length} maps)`
              : `Preview inspector shuffle (${selectedForInspectorShuffle.length} maps)`
          }
          onClose={() => !loading && setInspectorShuffleOpen(false)}
          wide
        >
          <div className="space-y-4">
            {shuffleStep === "pick" ? (
              <>
                <p className="text-sm text-muted">
                  Assign graphics inspectors to unassigned maps. Workload is balanced across the
                  team.
                </p>
                <ul className="rounded-xl border border-border divide-y divide-border max-h-72 overflow-y-auto">
                  {inspectors.map((member) => {
                    const active = countInspectorActiveMaps(maps, member.id);
                    const checked = shuffleInspectorIds.has(member.id);
                    return (
                      <li key={member.id}>
                        <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleShuffleInspector(member.id)}
                          />
                          <div className="w-9 h-9 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                            {member.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{member.name}</div>
                            <div className="text-xs text-muted">
                              {ROLE_LABELS.MAPPING_INSPECTOR} · {active} active map
                              {active !== 1 ? "s" : ""}
                            </div>
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectorShuffleOpen(false)}
                    className="px-4 py-2 text-sm text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={shuffleInspectorIds.size === 0}
                    onClick={() => setShuffleStep("preview")}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white disabled:opacity-50"
                  >
                    Preview distribution
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs text-muted">
                        <th className="px-4 py-2">Inspector</th>
                        <th className="px-4 py-2">Current</th>
                        <th className="px-4 py-2">Receiving</th>
                        <th className="px-4 py-2">Total after</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {inspectorShufflePreviewRows.map((row) => (
                        <tr key={row.inspectorId}>
                          <td className="px-4 py-2 font-medium">{row.inspectorName}</td>
                          <td className="px-4 py-2 tabular-nums">{row.currentActive}</td>
                          <td className="px-4 py-2 tabular-nums text-indigo-700 font-medium">
                            +{row.receiving}
                          </td>
                          <td className="px-4 py-2 tabular-nums font-semibold">{row.totalAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShuffleStep("pick")}
                    className="px-4 py-2 text-sm text-muted"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={confirmInspectorShuffle}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {loading ? "Assigning…" : "Confirm shuffle"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      <ReadyToAcceptModal
        maps={readyMaps}
        open={readyPanelIsOpen}
        onClose={() => setReadyPanelOpen(false)}
        onAccepted={onRefresh}
      />
    </section>
  );
}
