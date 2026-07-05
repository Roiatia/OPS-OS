import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { Badge } from "../Badge";
import { Modal } from "./Modal";
import {
  canAssignInspector,
  canAssignQa,
  countInspectorWorkload,
  countQaWorkload,
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

interface Props {
  maps: MapRecord[];
  team: TeamMember[];
  onRefresh: () => void;
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

export function AssignmentBoard({ maps, team, onRefresh }: Props) {
  const [queue, setQueue] = useState<AssignmentQueue>("all");
  const [columnFilters, setColumnFilters] = useState<MapColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkInspectorId, setBulkInspectorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assignModal, setAssignModal] = useState<{
    mapId: string;
    type: "inspector" | "qa";
  } | null>(null);
  const [assignTargetId, setAssignTargetId] = useState("");

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

  const assignableSelected = useMemo(
    () =>
      filteredMaps.filter(
        (m) => selected.has(m.id) && canAssignInspector(m) && needsInspectorAssignment(m)
      ),
    [filteredMaps, selected]
  );

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
      (m) => canAssignInspector(m) && needsInspectorAssignment(m)
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

  async function runAssign(mapId: string, type: "inspector" | "qa", memberId: string) {
    setError("");
    setLoading(true);
    try {
      if (type === "inspector") await api.assignInspector(mapId, memberId);
      else await api.assignQa(mapId, memberId);
      setAssignModal(null);
      setAssignTargetId("");
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
      for (const map of assignableSelected) {
        await api.assignInspector(map.id, bulkInspectorId);
      }
      setSelected(new Set());
      setBulkInspectorId("");
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const assignableInView = filteredMaps.filter(
    (m) => canAssignInspector(m) && needsInspectorAssignment(m)
  );
  const allAssignableSelected =
    assignableInView.length > 0 && assignableInView.every((m) => selected.has(m.id));

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

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

      {assignableSelected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-brand-800">
            {assignableSelected.length} map{assignableSelected.length !== 1 ? "s" : ""} selected
          </span>
          <select
            value={bulkInspectorId}
            onChange={(e) => setBulkInspectorId(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">Assign inspector...</option>
            {inspectors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({countInspectorWorkload(maps, m.id)} active)
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!bulkInspectorId || loading}
            onClick={handleBulkAssign}
            className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
          >
            Assign selected
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted hover:text-slate-900"
          >
            Clear
          </button>
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
                <th className="px-3 py-2 font-medium">Actions</th>
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
                const showCheckbox = canAssignInspector(map) && needsInspectorAssignment(map);
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
                    <td className="px-3 py-3">
                      {showCheckbox && (
                        <input
                          type="checkbox"
                          checked={selected.has(map.id)}
                          onChange={() => toggleSelect(map.id)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        to={`/app/maps/${map.id}`}
                        className="font-mono font-medium text-brand-600 hover:underline"
                      >
                        {map.mapNumber}
                      </Link>
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
                        return state === "—" ? (
                          "—"
                        ) : (
                          <Badge label={state} tone={workflowStateTone(state)} />
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
                      <div className="flex flex-wrap gap-1.5">
                        {canAssignInspector(map) && (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setAssignTargetId(map.assignedInspector?.id ?? "");
                              setAssignModal({ mapId: map.id, type: "inspector" });
                            }}
                            className="px-2.5 py-1 text-xs border border-border rounded-md hover:bg-slate-50"
                          >
                            {map.assignedInspector ? "Reassign" : "Assign"}
                          </button>
                        )}
                        {canAssignQa(map) && (
                          <button
                            type="button"
                            onClick={() => {
                              setError("");
                              setAssignTargetId(map.assignedQa?.id ?? "");
                              setAssignModal({ mapId: map.id, type: "qa" });
                            }}
                            className="px-2.5 py-1 text-xs border border-violet-200 text-violet-700 rounded-md hover:bg-violet-50"
                          >
                            {map.assignedQa ? "Reassign QA" : "Assign QA"}
                          </button>
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

      {assignModal && (
        <Modal
          title={
            assignModal.type === "inspector"
              ? "Assign mapping inspector"
              : "Assign QA reviewer"
          }
          onClose={() => {
            setAssignModal(null);
            setAssignTargetId("");
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (assignTargetId) runAssign(assignModal.mapId, assignModal.type, assignTargetId);
            }}
            className="space-y-4"
          >
            <label className="block">
              <span className="text-sm text-muted">
                {assignModal.type === "inspector" ? "Mapping Inspector" : "Graphic QA"}
              </span>
              <select
                required
                value={assignTargetId}
                onChange={(e) => setAssignTargetId(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {(assignModal.type === "inspector" ? inspectors : qaMembers).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {assignModal.type === "inspector"
                      ? ` (${countInspectorWorkload(maps, m.id)} active)`
                      : ` (${countQaWorkload(maps, m.id)} active)`}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setAssignModal(null);
                  setAssignTargetId("");
                }}
                className="px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !assignTargetId}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
