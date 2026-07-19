import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { Badge } from "@/components/common/Badge";
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
  getMapStation,
  getQaLabel,
  getTaskType,
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
import { ROLE_LABELS } from "../../types";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assignMap, setAssignMap] = useState<MapRecord | null>(null);
  const [assignQaMap, setAssignQaMap] = useState<MapRecord | null>(null);
  const [bulkQaId, setBulkQaId] = useState("");
  const [dueDateSaving, setDueDateSaving] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [shuffleStep, setShuffleStep] = useState<"pick" | "preview">("pick");
  const [shuffleInspectorIds, setShuffleInspectorIds] = useState<Set<string>>(new Set());
  const [shufflingCount, setShufflingCount] = useState(0);
  const [unassigningCount, setUnassigningCount] = useState(0);

  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));
  const qaMembers = team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"));

  const filterOptions = useMemo(() => {
    const clients = new Set<string>();
    const tasks = new Set<string>();
    const stations = new Set<string>();
    const states = new Set<string>();
    const inspectorNames = new Set<string>();
    const qaNames = new Set<string>();

    for (const map of maps) {
      clients.add(map.client);
      tasks.add(getTaskType(map) ?? "—");
      stations.add(getMapStation(map));
      states.add(getMapDisplayState(map));
      inspectorNames.add(getInspectorLabel(map));
      qaNames.add(getQaLabel(map));
    }

    return {
      clients: [...clients].sort(),
      tasks: [...tasks].sort(),
      stations: [...stations].sort(),
      states: [...states].sort(),
      inspectors: [...inspectorNames].sort(),
      qa: [...qaNames].sort(),
    };
  }, [maps]);

  const filteredMaps = useMemo(
    () =>
      maps.filter(
        (map) => matchesQueue(map, queue) && matchesColumnFilters(map, columnFilters)
      ),
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
    const assignable = filteredMaps.filter(
      (m) => needsInspectorAssignment(m) || needsQaAssignment(m)
    );
    if (assignable.every((m) => selected.has(m.id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        assignable.forEach((m) => next.delete(m.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        assignable.forEach((m) => next.add(m.id));
        return next;
      });
    }
  }

  async function handleAssign(opts: {
    mode: "individual" | "shift";
    memberId?: string;
    shiftId?: ShiftId;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) {
    if (!assignMap) return;
    setError("");
    setLoading(true);
    try {
      const map = assignMap;
      let updated: MapRecord | undefined;

      if (opts.mode === "individual" && opts.memberId) {
        updated = await api.assignInspector(map.id, opts.memberId, opts.attachment);
      } else if (opts.mode === "shift" && opts.shiftId) {
        const shift = SHIFTS.find((s) => s.id === opts.shiftId)!;
        const shiftInspectors = getShiftInspectors(team, opts.shiftId);
        const leadInspector = shiftInspectors[0];
        if (!leadInspector) throw new Error("No inspectors on this shift");

        updated = await api.assignInspector(map.id, leadInspector.id, opts.attachment);

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
      for (const map of assignableSelected) {
        const updated = await api.assignInspector(map.id, bulkInspectorId);
        patch(updated);
      }
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
      onRefresh();
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
      onRefresh();
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
      for (const map of selectedNeedingQa) {
        const updated = await api.assignQa(map.id, bulkQaId);
        patch(updated);
      }
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

  const assignableInView = filteredMaps.filter(
    (m) => needsInspectorAssignment(m) || needsQaAssignment(m)
  );
  const allAssignableSelected =
    assignableInView.length > 0 && assignableInView.every((m) => selected.has(m.id));

  function canUnassignInspector(map: MapRecord) {
    return map.phase === "PREP" && !!map.assignedInspector;
  }

  function canSelectMap(map: MapRecord) {
    return needsInspectorAssignment(map) || needsQaAssignment(map) || canUnassignInspector(map);
  }

  function canShowInspectorAssign(map: MapRecord) {
    return canAssignInspector(map);
  }

  function canShowQaAssign(map: MapRecord) {
    return canAssignQa(map);
  }

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

      {(selectedForShuffle.length > 0 ||
        selectedNeedingQa.length > 0 ||
        selectedForUnassign.length > 0) && (
        <div className="space-y-2">
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
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-muted border-b border-border">
                <th className="px-3 py-2 w-10">
                  {assignableInView.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allAssignableSelected}
                      onChange={toggleSelectAll}
                      title="Select all assignable maps"
                    />
                  )}
                </th>
                <th className="px-3 py-2 font-medium min-w-[120px]">Map</th>
                <th className="px-3 py-2 font-medium min-w-[100px]">Client</th>
                <th className="px-3 py-2 font-medium min-w-[90px]">Task</th>
                <th className="px-3 py-2 font-medium min-w-[90px]">Station</th>
                <th className="px-3 py-2 font-medium min-w-[120px]">State</th>
                <th className="px-3 py-2 font-medium min-w-[110px]">Inspector</th>
                <th className="px-3 py-2 font-medium min-w-[100px]">QA</th>
                <th className="px-3 py-2 font-medium min-w-[110px]">Deadline</th>
                <th className="px-3 py-2 font-medium w-[120px]">Actions</th>
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
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMaps.map((map) => {
                const taskType = getTaskType(map);
                const selectable = canSelectMap(map);
                return (
                  <tr
                    key={map.id}
                    className={`hover:bg-slate-50/60 ${
                      needsInspectorAssignment(map)
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
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{map.client}</td>
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
                      {map.assignedInspector?.name ?? (
                        <span className="text-amber-700 text-xs font-medium">Unassigned</span>
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
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        {canShowInspectorAssign(map) && (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setAssignMap(map);
                            }}
                            className="px-2.5 py-1 text-xs font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                          >
                            Inspector
                          </button>
                        )}
                        {canShowQaAssign(map) && (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setAssignQaMap(map);
                            }}
                            className="px-2.5 py-1 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                          >
                            QA
                          </button>
                        )}
                        {!canShowInspectorAssign(map) && !canShowQaAssign(map) && (
                          <span className="text-xs text-slate-300">—</span>
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
