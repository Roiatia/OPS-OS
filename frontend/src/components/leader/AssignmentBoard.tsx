import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { Badge } from "@/components/common/Badge";
import { SpreadsheetDateInput } from "@/components/common/SpreadsheetDateInput";
import { BoardTextInput } from "@/components/common/BoardTextInput";
import { AssignMapModal } from "./AssignMapModal";
import { AssignQaModal } from "./AssignQaModal";
import { Modal } from "@/components/common/Modal";
import {
  buildBalancedInspectorAssignments,
  countInspectorActiveMaps,
  countQaActiveMaps,
  summarizeShufflePlan,
  withOptimisticInspector,
  withUnassignedInspector,
} from "../../lib/assignment";
import {
  DUE_DATE_CLASS,
  formatDueDate,
  getDueDateStatus,
  toDateInputValue,
} from "../../lib/dates";
import {
  canAssignInspector,
  canAssignQa,
  EMPTY_COLUMN_FILTERS,
  getInspectorLabel,
  getMapDisplayState,
  getMapReceivedStatus,
  getMapStation,
  getQaLabel,
  getTaskType,
  MAP_STATION_OPTIONS,
  MAP_TASK_OPTIONS,
  mapReceivedSelectClass,
  matchesColumnFilters,
  matchesQueue,
  needsInspectorAssignment,
  needsQaAssignment,
  WORKFLOW_STATES,
  workflowStateTone,
  type AssignmentQueue,
  type MapColumnFilters,
} from "../../lib/mapDisplay";
import { getLeaderStatusOptions, type StatusOption } from "../../lib/activeMapsWorkflow";
import { SHIFTS, getShiftInspectors, type ShiftId } from "../../lib/shifts";
import {
  getMappingCompletionLabel,
  getPipelineStage,
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
} from "../../lib/pipeline";
import { ROLE_LABELS, type MapStation, type MapTask } from "../../types";

const PIPELINE_OPTIONS: PipelineStage[] = ["UPLOAD", "MAPPING", "POLISH", "ACTIVATION"];
const selectClass =
  "w-full text-xs font-medium rounded-md border border-border bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50";

interface Props {
  maps: MapRecord[];
  team: TeamMember[];
  /** Silent/debounced reload — fallback for bulk ops, errors, and realtime. */
  onRefresh: () => void;
  /** Patch a single updated map into parent state (mirrors MapHubBoard). */
  onPatch?: (map: MapRecord) => void;
}

const QUEUE_TABS: { id: AssignmentQueue; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unassigned", label: "Unassigned" },
  { id: "needs_qa", label: "Needs QA" },
  { id: "in_progress", label: "In progress" },
  { id: "in_qa", label: "In QA" },
];

const filterInputClass =
  "w-full border border-border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-500";

export function AssignmentBoard({ maps, team, onRefresh, onPatch }: Props) {
  const patch = (map: MapRecord) => (onPatch ? onPatch(map) : onRefresh());

  const [queue, setQueue] = useState<AssignmentQueue>("all");
  const [columnFilters, setColumnFilters] = useState<MapColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkInspectorId, setBulkInspectorId] = useState("");
  const [bulkTask, setBulkTask] = useState<MapTask | "">("");
  const [bulkStation, setBulkStation] = useState<MapStation | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assignMap, setAssignMap] = useState<MapRecord | null>(null);
  const [assignQaMap, setAssignQaMap] = useState<MapRecord | null>(null);
  const [bulkQaId, setBulkQaId] = useState("");
  const [dueDateSaving, setDueDateSaving] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [taskStationSaving, setTaskStationSaving] = useState<string | null>(null);
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [shuffleStep, setShuffleStep] = useState<"pick" | "preview">("pick");
  const [shuffleInspectorIds, setShuffleInspectorIds] = useState<Set<string>>(new Set());
  const [shufflingCount, setShufflingCount] = useState(0);
  const [unassigningCount, setUnassigningCount] = useState(0);

  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));
  const qaMembers = team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"));

  const filterOptions = useMemo(() => {
    const clients = new Set<string>();
    const batches = new Set<string>();
    const tasks = new Set<string>();
    const stations = new Set<string>();
    const states = new Set<string>();
    const inspectorNames = new Set<string>();
    const qaNames = new Set<string>();

    for (const map of maps) {
      clients.add(map.client);
      batches.add(map.batch?.trim() || "—");
      tasks.add(getTaskType(map));
      stations.add(getMapStation(map));
      states.add(getMapDisplayState(map));
      inspectorNames.add(getInspectorLabel(map));
      qaNames.add(getQaLabel(map));
    }

    return {
      clients: [...clients].sort(),
      batches: [...batches].sort(),
      tasks: [...tasks].sort(),
      stations: [...stations].sort(),
      states: [...states].sort(),
      inspectors: [...inspectorNames].sort(),
      qa: [...qaNames].sort(),
    };
  }, [maps]);

  const filteredMaps = useMemo(
    () =>
      maps
        .filter(
          (map) => matchesQueue(map, queue) && matchesColumnFilters(map, columnFilters)
        )
        .sort((a, b) => {
          const aCancelled = a.phase === "CANCELLED" ? 1 : 0;
          const bCancelled = b.phase === "CANCELLED" ? 1 : 0;
          if (aCancelled !== bCancelled) return aCancelled - bCancelled;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        }),
    [maps, queue, columnFilters]
  );

  const hasActiveFilters = Object.values(columnFilters).some((v) => v !== "");

  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        QUEUE_TABS.map((tab) => [tab.id, maps.filter((m) => matchesQueue(m, tab.id)).length])
      ) as Record<AssignmentQueue, number>,
    [maps]
  );

  const selectedForShuffle = useMemo(
    () =>
      filteredMaps.filter(
        (m) => selected.has(m.id) && needsInspectorAssignment(m)
      ),
    [filteredMaps, selected]
  );

  const selectedNeedingQa = useMemo(
    () =>
      filteredMaps.filter(
        (m) => selected.has(m.id) && needsQaAssignment(m)
      ),
    [filteredMaps, selected]
  );

  const selectedForUnassign = useMemo(
    () =>
      filteredMaps.filter(
        (m) => selected.has(m.id) && m.phase === "PREP" && !!m.assignedInspector
      ),
    [filteredMaps, selected]
  );

  const assignableSelected = selectedForShuffle;

  useEffect(() => {
    if (inspectors.length === 0) return;
    setShuffleInspectorIds((prev) => {
      if (prev.size > 0) {
        const next = new Set([...prev].filter((id) => inspectors.some((m) => m.id === id)));
        for (const m of inspectors) next.add(m.id);
        return next;
      }
      return new Set(inspectors.map((m) => m.id));
    });
  }, [inspectors]);

  function updateFilter(key: keyof MapColumnFilters, value: string) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setColumnFilters(EMPTY_COLUMN_FILTERS);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const selectable = filteredMaps.filter(canSelectMap);
    if (selectable.length > 0 && selectable.every((m) => selected.has(m.id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectable.forEach((m) => next.delete(m.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        selectable.forEach((m) => next.add(m.id));
        return next;
      });
    }
  }

  async function handleAssign(opts: {
    mode: "individual" | "shift";
    memberId?: string;
    shiftId?: ShiftId;
    task?: MapTask;
    station?: MapStation;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) {
    if (!assignMap) return;
    setError("");
    setLoading(true);
    try {
      const map = assignMap;
      let updated: MapRecord | undefined;

      if (opts.task || opts.station) {
        updated = await api.setMapTaskStation(map.id, {
          ...(opts.task ? { task: opts.task } : {}),
          ...(opts.station ? { station: opts.station } : {}),
        });
      }

      if (opts.mode === "individual" && opts.memberId) {
        updated = await api.assignInspector(map.id, opts.memberId, opts.attachment);
      } else if (opts.mode === "shift" && opts.shiftId) {
        const shift = SHIFTS.find((s) => s.id === opts.shiftId)!;
        const shiftInspectors = getShiftInspectors(team, opts.shiftId);
        const leadInspector = shiftInspectors[0];
        if (!leadInspector) throw new Error("No inspectors on this shift");

        updated = await api.assignInspector(map.id, leadInspector.id, opts.attachment);

        const taskPhase =
          (opts.task ?? map.task) === "POLISH" || map.phase === "POLISH" || map.phase === "QA_REVIEW"
            ? "POLISH"
            : "PREP";
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
      }

      setAssignMap(null);
      setSelected(new Set());
      if (updated) patch(updated);
      else onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkAssign() {
    if (!bulkInspectorId || assignableSelected.length === 0) return;
    setError("");
    setLoading(true);
    try {
      // Assign in parallel rather than serializing one round-trip per map.
      const updates = await Promise.all(
        assignableSelected.map((map) => api.assignInspector(map.id, bulkInspectorId))
      );
      for (const updated of updates) patch(updated);
      setSelected(new Set());
      setBulkInspectorId("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const shuffleInspectors = inspectors.filter((m) => shuffleInspectorIds.has(m.id));

  const shufflePreviewRows = useMemo(() => {
    if (assignableSelected.length < 2 || shuffleInspectors.length === 0) return [];
    const plan = buildBalancedInspectorAssignments(
      assignableSelected,
      shuffleInspectors,
      maps
    );
    return summarizeShufflePlan(plan, shuffleInspectors, maps);
  }, [assignableSelected, shuffleInspectors, maps]);

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

  async function handleShuffleAssign() {
    if (assignableSelected.length < 2 || shuffleInspectors.length === 0) return;

    const plan = buildBalancedInspectorAssignments(assignableSelected, shuffleInspectors, maps);
    const inspectorById = new Map(shuffleInspectors.map((m) => [m.id, m]));
    const originals = assignableSelected;
    const prevSelected = selected;

    // Optimistically reflect the pending assignment so the UI feels instant
    // even for large shuffles; the server's broadcastMapsInvalidate() triggers
    // a realtime refetch that reconciles the true distribution.
    for (const { mapId, inspectorId } of plan) {
      const original = originals.find((m) => m.id === mapId);
      const inspector = inspectorById.get(inspectorId);
      if (original && inspector) patch(withOptimisticInspector(original, inspector));
    }

    setError("");
    setShuffleOpen(false);
    setSelected(new Set());
    setShufflingCount(originals.length);
    setLoading(true);
    try {
      await api.shuffleAssignMaps(
        originals.map((m) => m.id),
        shuffleInspectors.map((m) => m.id)
      );
      // No refetch: the server broadcasts the exact changed rows (maps:upsert)
      // which the realtime cache bridge patches in place.
    } catch (err) {
      // Roll back the optimistic patches and restore the prior selection.
      for (const original of originals) patch(original);
      setSelected(prevSelected);
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setShufflingCount(0);
    }
  }

  async function handleUnassignInspectors() {
    const originals = selectedForUnassign;
    if (originals.length === 0) return;
    const prevSelected = selected;

    // Optimistically send the maps back to the unassigned queue (PREP → INTAKE);
    // the server's broadcastMapsInvalidate() reconciles via realtime.
    for (const original of originals) patch(withUnassignedInspector(original));

    setError("");
    setSelected(new Set());
    setUnassigningCount(originals.length);
    setLoading(true);
    try {
      await api.unassignInspectors(originals.map((m) => m.id));
      // No refetch: realtime maps:upsert reconciles the changed rows.
    } catch (err) {
      // Roll back the optimistic patches and restore the prior selection.
      for (const original of originals) patch(original);
      setSelected(prevSelected);
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setUnassigningCount(0);
    }
  }

  async function handleBulkQaAssign() {
    if (!bulkQaId || selectedNeedingQa.length === 0) return;
    setError("");
    setLoading(true);
    try {
      const updates = await Promise.all(
        selectedNeedingQa.map((map) => api.assignQa(map.id, bulkQaId))
      );
      for (const updated of updates) patch(updated);
      setSelected(new Set());
      setBulkQaId("");
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
      const updated = await api.assignQa(assignQaMap.id, opts.qaId, opts.attachment);
      setAssignQaMap(null);
      setSelected(new Set());
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(map: MapRecord, option: StatusOption) {
    setError("");
    setStatusSaving(map.id);
    try {
      const updated = await api.setLeaderStatus(map.id, option.action);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStatusSaving(null);
    }
  }

  async function handleTaskStationChange(
    map: MapRecord,
    patchFields: { task?: MapTask; station?: MapStation }
  ) {
    setError("");
    setTaskStationSaving(map.id);
    try {
      const updated = await api.setMapTaskStation(map.id, patchFields);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaskStationSaving(null);
    }
  }

  async function handleMapReceivedChange(map: MapRecord, received: boolean) {
    setError("");
    setTaskStationSaving(map.id);
    try {
      const updated = await api.setMapReceived(map.id, received);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaskStationSaving(null);
    }
  }


  async function handleSpreadsheetDateChange(
    map: MapRecord,
    patchFields: Parameters<typeof api.updateMapSpreadsheetDates>[1]
  ) {
    setError("");
    setTaskStationSaving(map.id);
    try {
      const updated = await api.updateMapSpreadsheetDates(map.id, patchFields);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaskStationSaving(null);
    }
  }

  async function handlePipelineChange(map: MapRecord, stage: PipelineStage) {
    setError("");
    setTaskStationSaving(map.id);
    try {
      const updated = await api.setMapPipeline(map.id, stage);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaskStationSaving(null);
    }
  }

  async function handleBulkTaskStation() {
    if (selected.size === 0 || (!bulkTask && !bulkStation)) return;
    setError("");
    setLoading(true);
    try {
      const result = await api.bulkSetMapTaskStation([...selected], {
        ...(bulkTask ? { task: bulkTask } : {}),
        ...(bulkStation ? { station: bulkStation } : {}),
      });
      for (const m of result.maps) patch(m);
      setSelected(new Set());
      setBulkTask("");
      setBulkStation("");
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDueDateChange(mapId: string, value: string) {
    setError("");
    setDueDateSaving(mapId);
    try {
      const updated = await api.updateMapDueDate(mapId, value || null);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDueDateSaving(null);
    }
  }

  const assignableInView = filteredMaps.filter(canSelectMap);
  const allAssignableSelected =
    assignableInView.length > 0 && assignableInView.every((m) => selected.has(m.id));

  /** Any active map can be selected for bulk task/station (and assign when eligible). */
  function canSelectMap(map: MapRecord) {
    return map.phase !== "APPROVED" && map.phase !== "CANCELLED";
  }

  function canShowInspectorAssign(map: MapRecord) {
    return canAssignInspector(map);
  }

  function canShowQaAssign(map: MapRecord) {
    return canAssignQa(map);
  }

  const selectedMaps = useMemo(
    () => filteredMaps.filter((m) => selected.has(m.id)),
    [filteredMaps, selected]
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Maps</h2>
          <p className="text-sm text-muted">
            {filteredMaps.length} of {maps.filter((m) => matchesQueue(m, queue)).length} maps
            {hasActiveFilters && " (column filters active)"}
          </p>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm text-brand-600 hover:underline"
          >
            Clear column filters
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

      {shufflingCount > 0 && (
        <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg p-3 flex items-center gap-2">
          <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Assigning {shufflingCount} map{shufflingCount !== 1 ? "s" : ""}…
        </p>
      )}

      {unassigningCount > 0 && (
        <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg p-3 flex items-center gap-2">
          <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Unassigning {unassigningCount} map{unassigningCount !== 1 ? "s" : ""}…
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {QUEUE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setQueue(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              queue === tab.id
                ? "bg-brand-600 text-white border-brand-600"
                : "border-border hover:bg-slate-50"
            }`}
          >
            {tab.label}
            <span
              className={`ml-1.5 text-xs ${queue === tab.id ? "text-brand-100" : "text-muted"}`}
            >
              {queueCounts[tab.id]}
            </span>
          </button>
        ))}
      </div>

      {(selected.size > 0 ||
        selectedForShuffle.length > 0 ||
        selectedNeedingQa.length > 0 ||
        selectedForUnassign.length > 0) && (
        <div className="space-y-2">
          {selectedMaps.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-border rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-slate-800">
                {selectedMaps.length} map{selectedMaps.length !== 1 ? "s" : ""} selected
              </span>
              <select
                value={bulkTask}
                onChange={(e) => setBulkTask(e.target.value as MapTask | "")}
                className="border border-border rounded-lg px-2 py-1.5 text-sm bg-white"
              >
                <option value="">Task…</option>
                {MAP_TASK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={bulkStation}
                onChange={(e) => setBulkStation(e.target.value as MapStation | "")}
                className="border border-border rounded-lg px-2 py-1.5 text-sm bg-white"
              >
                <option value="">Station…</option>
                {MAP_STATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={loading || (!bulkTask && !bulkStation)}
                onClick={handleBulkTaskStation}
                className="px-4 py-1.5 text-sm font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50"
              >
                Apply task / station
              </button>
            </div>
          )}

          {selectedForUnassign.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-amber-800">
                {selectedForUnassign.length} assigned map
                {selectedForUnassign.length !== 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={handleUnassignInspectors}
                className="px-4 py-1.5 text-sm font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                Unassign
              </button>
            </div>
          )}

          {selectedForShuffle.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-brand-800">
                {selectedForShuffle.length} map{selectedForShuffle.length !== 1 ? "s" : ""} for
                inspector assign
              </span>

              {selectedForShuffle.length >= 2 && (
                <button
                  type="button"
                  disabled={loading || inspectors.length === 0}
                  onClick={openShuffleModal}
                  className="px-4 py-1.5 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
                >
                  Shuffle assign
                </button>
              )}

              <select
                value={bulkInspectorId}
                onChange={(e) => setBulkInspectorId(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="">Assign inspector...</option>
                {inspectors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({countInspectorActiveMaps(maps, m.id)} active)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!bulkInspectorId || loading}
                onClick={handleBulkAssign}
                className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
              >
                Assign to inspector
              </button>
            </div>
          )}

          {selectedNeedingQa.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-violet-800">
                {selectedNeedingQa.length} map{selectedNeedingQa.length !== 1 ? "s" : ""} for QA
                assign
              </span>

              <select
                value={bulkQaId}
                onChange={(e) => setBulkQaId(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="">Assign QA...</option>
                {qaMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({countQaActiveMaps(maps, m.id)} active)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!bulkQaId || loading}
                onClick={handleBulkQaAssign}
                className="px-4 py-1.5 text-sm bg-violet-600 text-white rounded-lg disabled:opacity-50"
              >
                Assign to QA
              </button>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-muted hover:text-slate-900"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {filteredMaps.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center border border-dashed border-border rounded-xl">
          No maps match the current filters.
        </p>
      ) : (
        <div
          ref={tableScrollRef}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 320 : 160;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              tableScrollRef.current?.scrollBy({ left: step, behavior: "smooth" });
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              tableScrollRef.current?.scrollBy({ left: -step, behavior: "smooth" });
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              tableScrollRef.current?.scrollBy({ top: step, behavior: "smooth" });
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              tableScrollRef.current?.scrollBy({ top: -step, behavior: "smooth" });
            }
          }}
          className="overflow-auto max-h-[min(70vh,720px)] rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        >
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50 text-left text-muted border-b border-border">
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 w-10">
                  {assignableInView.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allAssignableSelected}
                      onChange={toggleSelectAll}
                      title="Select all assignable maps"
                    />
                  )}
                </th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[120px]">Map</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[100px]">Client</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[90px]">Batch</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[130px]">Map received</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[120px]">Pipeline</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[110px]">Task</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[110px]">Station</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[120px]">State</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[120px]">Inspector</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[110px]">QA</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[90px]">Schedule</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[90px]">Mapping</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[90px]">Sent to studio</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[90px]">Received from studio</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[80px]">Polish</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[90px]">Activation</th>
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium min-w-[110px]">Deadline</th>
              </tr>
              <tr className="bg-white border-b border-border">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">
                  <input
                    type="text"
                    placeholder="Filter..."
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
                    {filterOptions.clients.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="px-3 py-2">
                  <select
                    value={columnFilters.batch}
                    onChange={(e) => updateFilter("batch", e.target.value)}
                    className={filterInputClass}
                  >
                    <option value="">All</option>
                    {filterOptions.batches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="px-3 py-2">
                  <select
                    value={columnFilters.mapReceived}
                    onChange={(e) => updateFilter("mapReceived", e.target.value)}
                    className={filterInputClass}
                  >
                    <option value="">All</option>
                    <option value="not_received">Not received yet</option>
                    <option value="received">Map received</option>
                  </select>
                </th>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">
                  <select
                    value={columnFilters.task}
                    onChange={(e) => updateFilter("task", e.target.value)}
                    className={filterInputClass}
                  >
                    <option value="">All</option>
                    {MAP_TASK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.label}>
                        {o.label}
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
                    {MAP_STATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
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
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMaps.map((map) => {
                const station = (map.station ?? "GRAPHICS") as MapStation;
                const taskValue = (map.task ?? "UPLOAD") as MapTask;
                const selectable = canSelectMap(map);
                const savingMeta = taskStationSaving === map.id;
                const cancelled = map.phase === "CANCELLED";
                return (
                  <tr
                    key={map.id}
                    className={`hover:bg-slate-50/60 ${
                      cancelled
                        ? "bg-slate-50/80 text-slate-500"
                        : needsInspectorAssignment(map)
                          ? "bg-amber-50/40"
                          : needsQaAssignment(map)
                            ? "bg-violet-50/40"
                            : ""
                    }`}
                  >
                    <td className="px-3 py-3 w-10">
                      {selectable ? (
                        <input
                          type="checkbox"
                          checked={selected.has(map.id)}
                          onChange={() => toggleSelect(map.id)}
                          aria-label={`Select ${map.mapNumber}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/app/maps/${map.id}`}
                          className="font-mono font-medium text-brand-600 hover:underline"
                        >
                          {map.mapNumber}
                        </Link>
                        {map.phase === "CANCELLED" && (
                          <Badge label="Cancelled" tone="CANCELLED" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <BoardTextInput
                        value={map.client}
                        disabled={savingMeta || cancelled}
                        title="Client"
                        onCommit={(v) =>
                          handleSpreadsheetDateChange(map, { client: v ?? "" })
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <BoardTextInput
                        value={map.batch}
                        disabled={savingMeta || cancelled}
                        title="Batch"
                        className="text-muted"
                        onCommit={(v) => handleSpreadsheetDateChange(map, { batch: v })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={getMapReceivedStatus(map.mapReceived)}
                        disabled={savingMeta || cancelled}
                        onChange={(e) =>
                          handleMapReceivedChange(map, e.target.value === "received")
                        }
                        title="Map received (from CSV)"
                        className={`w-full text-xs font-semibold rounded-md border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 ${mapReceivedSelectClass(map.mapReceived)}`}
                      >
                        <option value="not_received">Not received yet</option>
                        <option value="received">Map received</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      {cancelled ? (
                        <Badge label="Cancelled" tone="CANCELLED" />
                      ) : (
                        (() => {
                          const mappingStatus = getMappingCompletionLabel(map);
                          return (
                            <div className="flex items-center gap-1.5 min-w-[140px]">
                              <select
                                value={getPipelineStage(map)}
                                disabled={savingMeta}
                                onChange={(e) =>
                                  handlePipelineChange(map, e.target.value as PipelineStage)
                                }
                                title="Change pipeline"
                                className={`${selectClass} min-w-0 flex-1`}
                              >
                                {PIPELINE_OPTIONS.map((s) => (
                                  <option key={s} value={s}>
                                    {PIPELINE_STAGE_LABELS[s]}
                                  </option>
                                ))}
                              </select>
                              {mappingStatus && (
                                <Badge
                                  label={mappingStatus}
                                  tone={mappingStatus === "Complete" ? "DONE" : "PROCESSING"}
                                />
                              )}
                            </div>
                          );
                        })()
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={taskValue}
                        disabled={savingMeta || cancelled}
                        onChange={(e) =>
                          handleTaskStationChange(map, { task: e.target.value as MapTask })
                        }
                        title="Change task"
                        className={selectClass}
                      >
                        {MAP_TASK_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={station}
                        disabled={savingMeta || cancelled}
                        onChange={(e) =>
                          handleTaskStationChange(map, {
                            station: e.target.value as MapStation,
                          })
                        }
                        title="Change station"
                        className={selectClass}
                      >
                        {MAP_STATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      {(() => {
                        const state = getMapDisplayState(map);
                        const statusOptions = getLeaderStatusOptions(map);
                        if (statusOptions.length === 0) {
                          return state === "—" ? (
                            "—"
                          ) : (
                            <Badge label={state} tone={workflowStateTone(state)} />
                          );
                        }
                        return (
                          <select
                            value=""
                            disabled={statusSaving === map.id}
                            onChange={(e) => {
                              const opt = statusOptions.find((o) => o.value === e.target.value);
                              if (opt) handleStatusChange(map, opt);
                            }}
                            title="Change status"
                            className={`w-full text-xs font-medium rounded-md border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 ${
                              state === "Fix"
                                ? "bg-red-100 border-red-200 text-red-800"
                                : state === "Approved"
                                  ? "bg-emerald-100 border-emerald-200 text-emerald-800"
                                  : state === "In QA"
                                    ? "bg-sky-100 border-sky-200 text-sky-800"
                                    : state === "Accepted"
                                      ? "bg-amber-100 border-amber-200 text-amber-800"
                                      : "bg-white border-border"
                            }`}
                          >
                            <option value="" disabled>
                              {state === "—" ? "Set status…" : state}
                            </option>
                            {statusOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1 min-w-[100px]">
                        <span
                          className={
                            getInspectorLabel(map) === "Please assign"
                              ? "text-amber-700 text-xs font-medium"
                              : undefined
                          }
                        >
                          {getInspectorLabel(map)}
                        </span>
                        {canShowInspectorAssign(map) && (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setAssignMap(map);
                            }}
                            className="px-2 py-0.5 text-[10px] font-medium bg-brand-600 text-white rounded hover:bg-brand-700 w-fit"
                          >
                            {map.assignedInspector ? "Reassign" : "Assign"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1 min-w-[100px]">
                        <span
                          className={
                            getQaLabel(map) === "Please assign"
                              ? "text-amber-700 text-xs font-medium"
                              : undefined
                          }
                        >
                          {getQaLabel(map)}
                        </span>
                        {(canShowQaAssign(map) || map.phase === "PREP" || map.phase === "POLISH") &&
                          map.phase !== "CANCELLED" &&
                          map.phase !== "APPROVED" && (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setAssignQaMap(map);
                            }}
                            className="px-2 py-0.5 text-[10px] font-medium bg-violet-600 text-white rounded hover:bg-violet-700 w-fit"
                          >
                            {map.assignedQa ? "Reassign" : "Assign"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <SpreadsheetDateInput
                        kind="schedule"
                        value={map.scheduleAt}
                        disabled={savingMeta || cancelled}
                        title="Schedule (predicted mapping)"
                        onChange={(v) => handleSpreadsheetDateChange(map, { scheduleAt: v })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <SpreadsheetDateInput
                        kind="mapping"
                        value={map.mappingAt}
                        disabled={savingMeta || cancelled}
                        title="Mapping (actual / Hub date)"
                        onChange={(v) => handleSpreadsheetDateChange(map, { mappingAt: v })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <SpreadsheetDateInput
                        kind="sentToStudio"
                        value={map.sentToStudioAt}
                        disabled={savingMeta || cancelled}
                        title="Sent to studio"
                        onChange={(v) => handleSpreadsheetDateChange(map, { sentToStudioAt: v })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <SpreadsheetDateInput
                        kind="receivedFromStudio"
                        value={map.receivedFromStudioAt}
                        disabled={savingMeta || cancelled}
                        title="Received from studio"
                        onChange={(v) =>
                          handleSpreadsheetDateChange(map, { receivedFromStudioAt: v })
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <BoardTextInput
                        value={map.polishStage}
                        disabled={savingMeta || cancelled}
                        title="Polish"
                        className="whitespace-nowrap"
                        onCommit={(v) => handleSpreadsheetDateChange(map, { polishStage: v })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <SpreadsheetDateInput
                        kind="activation"
                        value={map.activationAt}
                        disabled={savingMeta || cancelled}
                        title="Activation"
                        onChange={(v) => handleSpreadsheetDateChange(map, { activationAt: v })}
                      />
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
                            {getDueDateStatus(map.dueDate) === "overdue" && " · Overdue"}
                            {getDueDateStatus(map.dueDate) === "soon" && " · Due soon"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {assignMap && (
        <AssignMapModal
          map={assignMap}
          team={team}
          maps={maps}
          loading={loading}
          onClose={() => setAssignMap(null)}
          onAssign={handleAssign}
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

      {shuffleOpen && (
        <Modal
          title={
            shuffleStep === "pick"
              ? `Choose inspectors for shuffle (${selectedForShuffle.length} maps)`
              : `Preview shuffle (${selectedForShuffle.length} maps)`
          }
          onClose={() => !loading && setShuffleOpen(false)}
          wide
        >
          <div className="space-y-4">
            {shuffleStep === "pick" ? (
              <>
                <p className="text-sm text-muted">
                  Select which mapping inspectors should receive maps. Maps are split evenly —
                  those with fewer active maps get more.
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
                          <div className="w-9 h-9 shrink-0 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold">
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

                {inspectors.length === 0 && (
                  <p className="text-sm text-muted">No mapping inspectors on the team.</p>
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
                    disabled={shuffleInspectorIds.size === 0}
                    onClick={() => setShuffleStep("preview")}
                    className="px-5 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {shuffleInspectors.length} inspector{shuffleInspectors.length !== 1 ? "s" : ""}{" "}
                  selected · maps go to whoever has the lightest workload.
                </p>

                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-muted border-b border-border">
                        <th className="px-4 py-2 font-medium">Inspector</th>
                        <th className="px-4 py-2 font-medium text-right">Active now</th>
                        <th className="px-4 py-2 font-medium text-right">Receiving</th>
                        <th className="px-4 py-2 font-medium text-right">Total after</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shufflePreviewRows.map((row) => (
                        <tr
                          key={row.inspectorId}
                          className={row.receiving > 0 ? "bg-violet-50/40" : ""}
                        >
                          <td className="px-4 py-2.5 font-medium">{row.inspectorName}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {row.currentActive}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-violet-700 font-semibold">
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
                    {loading ? "Assigning..." : "Confirm shuffle"}
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
