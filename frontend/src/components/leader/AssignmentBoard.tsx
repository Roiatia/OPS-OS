import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { Badge } from "../Badge";
import { AssignCellButton } from "./AssignCellButton";
import { DeleteMapButton } from "./DeleteMapButton";
import { InspectorAssignModal } from "./InspectorAssignModal";
import { QaAssignModal } from "./QaAssignModal";
import { QaOverrideCell } from "./QaOverrideCell";
import { Modal } from "./Modal";
import {
  buildBalancedInspectorAssignments,
  countInspectorActiveMaps,
  countQaActiveMaps,
  summarizeShufflePlan,
} from "../../lib/assignment";
import {
  DUE_DATE_CLASS,
  formatDueDate,
  getDueDateStatus,
  toDateInputValue,
} from "../../lib/dates";
import {
  showInspectorAssignControl,
  canDeleteMap,
  getBulkDeleteConfirmMessage,
  EMPTY_COLUMN_FILTERS,
  getInspectorLabel,
  getMapDisplayState,
  getQaLabel,
  getTaskType,
  MAP_STATIONS,
  matchesColumnFilters,
  matchesQueue,
  needsInspectorAssignment,
  needsQaAssignment,
  isAwaitingTeamAcceptance,
  WORKFLOW_STATES,
  workflowStateTone,
  type AssignmentQueue,
  type MapColumnFilters,
} from "../../lib/mapDisplay";
import { SHIFTS, getShiftInspectors, type ShiftId } from "../../lib/shifts";
import { ROLE_LABELS } from "../../types";
import { StationSelect } from "../workflow/StationSelect";

interface Props {
  maps: MapRecord[];
  /** Full map list for column filter options (includes new maps not yet in the pipeline table). */
  allMaps?: MapRecord[];
  team: TeamMember[];
  onRefresh: () => void;
  onMapUpdated?: (maps: MapRecord[]) => void;
}

const QUEUE_TABS: { id: AssignmentQueue; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_qa", label: "Needs QA" },
  { id: "in_progress", label: "In progress" },
  { id: "in_qa", label: "In QA" },
];

const filterInputClass =
  "w-full border border-border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-500";

export function AssignmentBoard({ maps, allMaps, team, onRefresh, onMapUpdated }: Props) {
  function commitMaps(updated: MapRecord[]) {
    if (onMapUpdated) onMapUpdated(updated);
    else onRefresh();
  }
  const [queue, setQueue] = useState<AssignmentQueue>("all");
  const [columnFilters, setColumnFilters] = useState<MapColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkInspectorId, setBulkInspectorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assignInspectorMap, setAssignInspectorMap] = useState<MapRecord | null>(null);
  const [assignQaMap, setAssignQaMap] = useState<MapRecord | null>(null);
  const [bulkQaId, setBulkQaId] = useState("");
  const [dueDateSaving, setDueDateSaving] = useState<string | null>(null);
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

  const filterSource = allMaps ?? maps;

  const filterOptions = useMemo(() => {
    const clients = new Set<string>();
    const tasks = new Set<string>();
    const states = new Set<string>();
    const inspectorNames = new Set<string>();
    const qaNames = new Set<string>();

    for (const map of filterSource) {
      clients.add(map.client);
      tasks.add(getTaskType(map) ?? "—");
      states.add(getMapDisplayState(map));
      inspectorNames.add(getInspectorLabel(map));
      qaNames.add(getQaLabel(map));
    }

    return {
      clients: [...clients].sort(),
      tasks: [...tasks].sort(),
      stations: MAP_STATIONS.map((s) => s.label),
      states: [...states].sort(),
      inspectors: [...inspectorNames].sort(),
      qa: [...qaNames].sort(),
    };
  }, [filterSource]);

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

  const selectedDeletable = useMemo(
    () => filteredMaps.filter((m) => selected.has(m.id) && canDeleteMap(m)),
    [filteredMaps, selected]
  );

  const assignableSelected = selectedForShuffle;

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
    const selectable = filteredMaps.filter((m) => canDeleteMap(m));
    if (selectable.every((m) => selected.has(m.id))) {
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

      if (opts.mode === "shift" && opts.shiftId) {
        const shift = SHIFTS.find((s) => s.id === opts.shiftId)!;
        const shiftInspectors = getShiftInspectors(team, opts.shiftId);
        await api.assignInspector(map.id, opts.inspectorId, opts.attachment);

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
        onRefresh();
      } else {
        commitMaps([await api.assignInspector(map.id, opts.inspectorId, opts.attachment)]);
      }

      setAssignInspectorMap(null);
      setSelected(new Set());
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
      commitMaps([await api.unassignInspector(assignInspectorMap.id)]);
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
      commitMaps([await api.assignQa(assignQaMap.id, opts.qaId, opts.attachment)]);
      setAssignQaMap(null);
      setSelected(new Set());
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
      commitMaps([await api.unassignQa(assignQaMap.id)]);
      setAssignQaMap(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedDeletable.length === 0) return;
    if (!confirm(getBulkDeleteConfirmMessage(selectedDeletable.length))) return;
    setError("");
    setLoading(true);
    try {
      await api.deleteMaps(selectedDeletable.map((m) => m.id));
      setSelected(new Set());
      onRefresh();
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
      const updated: MapRecord[] = [];
      for (const map of assignableSelected) {
        updated.push(await api.assignInspector(map.id, bulkInspectorId));
      }
      setSelected(new Set());
      setBulkInspectorId("");
      commitMaps(updated);
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
    setError("");
    setLoading(true);
    try {
      await api.shuffleAssignMaps(
        assignableSelected.map((m) => m.id),
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

  async function handleBulkQaAssign() {
    if (!bulkQaId || selectedNeedingQa.length === 0) return;
    setError("");
    setLoading(true);
    try {
      const updated: MapRecord[] = [];
      for (const map of selectedNeedingQa) {
        updated.push(await api.assignQa(map.id, bulkQaId));
      }
      setSelected(new Set());
      setBulkQaId("");
      commitMaps(updated);
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
      commitMaps([await api.updateMapDueDate(mapId, value || null)]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDueDateSaving(null);
    }
  }

  const deletableInView = filteredMaps.filter((m) => canDeleteMap(m));
  const allDeletableSelected =
    deletableInView.length > 0 && deletableInView.every((m) => selected.has(m.id));

  function canSelectMap(map: MapRecord) {
    return canDeleteMap(map);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pipeline</h2>
          <p className="text-sm text-muted">
            Assigned maps in progress — team members update status as they work.
          </p>
        </div>
        <p className="text-sm text-muted">
          {filteredMaps.length} of {maps.length} maps
          {hasActiveFilters && " (filters active)"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div />
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

      {(selectedForShuffle.length > 0 || selectedNeedingQa.length > 0 || selectedDeletable.length > 0) && (
        <div className="space-y-2">
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

          {selectedDeletable.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-red-800">
                {selectedDeletable.length} map{selectedDeletable.length !== 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={handleBulkDelete}
                className="px-4 py-1.5 text-sm font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                Delete selected
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
                  {deletableInView.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allDeletableSelected}
                      onChange={toggleSelectAll}
                      title="Select all maps"
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
                          : isAwaitingTeamAcceptance(map)
                            ? "bg-sky-50/40"
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
                      <div className="flex items-center gap-1">
                        <Link
                          to={`/app/maps/${map.id}`}
                          className="font-mono font-medium text-brand-600 hover:underline"
                        >
                          {map.mapNumber}
                        </Link>
                        <DeleteMapButton
                          map={map}
                          onDeleted={onRefresh}
                          variant="icon"
                        />
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
                      <StationSelect
                        map={map}
                        disabled={loading}
                        onMapUpdated={(m) => commitMaps([m])}
                        onError={setError}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {(() => {
                        const state = getMapDisplayState(map);
                        return state === "—" ? (
                          "—"
                        ) : (
                          <Badge label={state} tone={workflowStateTone(state)} />
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      {showInspectorAssignControl(map) ? (
                        <AssignCellButton
                          assigned={!!map.assignedInspector}
                          assigneeName={map.assignedInspector?.name}
                          tone="brand"
                          onClick={() => {
                            setError("");
                            setAssignInspectorMap(map);
                          }}
                        />
                      ) : (
                        <span className="text-sm text-muted">{map.assignedInspector?.name ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <QaOverrideCell
                        map={map}
                        disabled={loading}
                        onChange={() => {
                          setError("");
                          setAssignQaMap(map);
                        }}
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
