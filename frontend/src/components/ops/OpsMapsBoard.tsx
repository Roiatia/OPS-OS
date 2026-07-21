import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import { Badge } from "@/components/common/Badge";
import { Modal } from "@/components/common/Modal";
import { AssignSupervisorModal } from "./AssignSupervisorModal";
import { AssignMapModal } from "../leader/AssignMapModal";
import { AssignQaModal } from "../leader/AssignQaModal";
import {
  buildBalancedInspectorAssignments,
  buildBalancedSupervisorAssignments,
  countInspectorActiveMaps,
  countSupervisorActiveMaps,
  summarizeShufflePlan,
  summarizeSupervisorShufflePlan,
  withOptimisticInspector,
  withOptimisticSupervisor,
  withUnassignedInspector,
  withUnassignedSupervisor,
} from "../../lib/assignment";
import { memberIsSupervisor } from "../../lib/roles";
import {
  canAssignInspector,
  EMPTY_COLUMN_FILTERS,
  formatCsvDateCell,
  getInspectorLabel,
  getMapDisplayState,
  getMapReceivedStatus,
  getMapStation,
  getQaLabel,
  getTaskType,
  mapReceivedSelectClass,
  MAP_STATION_OPTIONS,
  MAP_TASK_OPTIONS,
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
  getPipelineStage,
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
} from "../../lib/pipeline";
import {
  canAssignSupervisor,
  canShuffleSupervisor,
  getOpsPipelineLabel,
  getOpsStatusLabel,
  getReadyToAcceptMaps,
  isReadyToRelease,
  matchesOpsQueue,
  needsSupervisorAssignment,
  OPS_QUEUE_TABS,
  opsStatusTone,
  sortOpsMaps,
  type OpsMapQueue,
} from "../../lib/opsDisplay";
import { ReadyToAcceptModal } from "./ReadyToAcceptModal";
import type { OpsWorkloadAlert } from "../../lib/opsWorkload";
import type { MapStation, MapTask } from "../../types";

const PIPELINE_OPTIONS: PipelineStage[] = ["UPLOAD", "MAPPING", "POLISH", "ACTIVATION"];
const selectClass =
  "w-full text-xs font-medium rounded-md border border-border bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50";

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
  workloadAlerts: _workloadAlerts,
  onRefresh,
  onPatch,
  readyPanelOpen,
  onReadyPanelOpenChange,
}: Props) {
  void _workloadAlerts;
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
  const [shufflingCount, setShufflingCount] = useState(0);
  const [unassigningCount, setUnassigningCount] = useState(0);
  const [internalReadyPanelOpen, setInternalReadyPanelOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [metaSaving, setMetaSaving] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const readyMaps = useMemo(() => getReadyToAcceptMaps(maps), [maps]);
  const readyPanelIsOpen = readyPanelOpen ?? internalReadyPanelOpen;

  function scrollTable(dx: number, dy: number) {
    const el = tableScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dx, top: dy, behavior: "smooth" });
  }

  async function handleDeleteAllMaps() {
    const ok = window.confirm(
      `Delete ALL ${maps.length} map${maps.length === 1 ? "" : "s"} from the database? This cannot be undone.`
    );
    if (!ok) return;
    const typed = window.prompt('Type DELETE to confirm wiping every map:');
    if (typed !== "DELETE") return;

    setDeletingAll(true);
    setError("");
    try {
      await api.deleteAllMaps();
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingAll(false);
    }
  }

  function setReadyPanelOpen(open: boolean) {
    onReadyPanelOpenChange?.(open);
    if (readyPanelOpen === undefined) {
      setInternalReadyPanelOpen(open);
    }
  }

  const supervisors = useMemo(() => team.filter(memberIsSupervisor), [team]);
  const inspectors = useMemo(
    () => team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR")),
    [team]
  );

  const clients = useMemo(() => [...new Set(maps.map((m) => m.client))].sort(), [maps]);
  const phases = useMemo(
    () => [...new Set(maps.map((m) => getOpsPipelineLabel(m)))].sort(),
    [maps]
  );

  const filterOptions = useMemo(() => {
    const batches = new Set<string>();
    const tasks = new Set<string>();
    const stations = new Set<string>();
    const states = new Set<string>();
    const inspectorNames = new Set<string>();
    const qaNames = new Set<string>();

    for (const map of maps) {
      batches.add(map.batch?.trim() || "—");
      tasks.add(getTaskType(map) ?? "—");
      stations.add(getMapStation(map));
      states.add(getMapDisplayState(map));
      inspectorNames.add(getInspectorLabel(map));
      qaNames.add(getQaLabel(map));
    }

    return {
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

  async function handleTaskStationChange(
    map: MapRecord,
    patchFields: { task?: MapTask; station?: MapStation }
  ) {
    setMetaSaving(map.id);
    setError("");
    try {
      const updated = await api.setMapTaskStation(map.id, patchFields);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMetaSaving(null);
    }
  }

  async function handleMapReceivedChange(map: MapRecord, received: boolean) {
    setMetaSaving(map.id);
    setError("");
    try {
      const updated = await api.setMapReceived(map.id, received);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMetaSaving(null);
    }
  }

  async function handlePipelineChange(map: MapRecord, stage: PipelineStage) {
    setMetaSaving(map.id);
    setError("");
    try {
      const updated = await api.setMapPipeline(map.id, stage);
      patch(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMetaSaving(null);
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

  const selectedForSupervisorUnassign = useMemo(
    () => selectedMaps.filter((m) => m.phase === "FIELD" && !!m.assignedSupervisor),
    [selectedMaps]
  );

  const selectedForInspectorUnassign = useMemo(
    () => selectedMaps.filter((m) => m.phase === "PREP" && !!m.assignedInspector),
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

    const plan = buildBalancedInspectorAssignments(
      selectedForInspectorShuffle,
      shuffleInspectors,
      maps
    );
    const inspectorById = new Map(shuffleInspectors.map((m) => [m.id, m]));
    const originals = selectedForInspectorShuffle;
    const prevSelected = selected;

    // Optimistically reflect the pending assignment so large shuffles feel
    // instant; the server's broadcastMapsInvalidate() reconciles via realtime.
    for (const { mapId, inspectorId } of plan) {
      const original = originals.find((m) => m.id === mapId);
      const inspector = inspectorById.get(inspectorId);
      if (original && inspector) patch(withOptimisticInspector(original, inspector));
    }

    setError("");
    setInspectorShuffleOpen(false);
    setShuffleStep("pick");
    setShuffleInspectorIds(new Set());
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
      for (const original of originals) patch(original);
      setSelected(prevSelected);
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setShufflingCount(0);
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

  async function confirmShuffle() {
    if (selectedForShuffle.length === 0 || shuffleSupervisors.length === 0) return;

    const plan = buildBalancedSupervisorAssignments(
      selectedForShuffle,
      shuffleSupervisors,
      maps
    );
    const supervisorById = new Map(shuffleSupervisors.map((m) => [m.id, m]));
    const originals = selectedForShuffle;
    const prevSelected = selected;

    // Optimistically reflect the pending assignment so large shuffles feel
    // instant; the server's broadcastMapsInvalidate() reconciles via realtime.
    for (const { mapId, supervisorId } of plan) {
      const original = originals.find((m) => m.id === mapId);
      const supervisor = supervisorById.get(supervisorId);
      if (original && supervisor) patch(withOptimisticSupervisor(original, supervisor));
    }

    setError("");
    setShuffleOpen(false);
    setShuffleStep("pick");
    setShuffleSupervisorIds(new Set());
    setSelected(new Set());
    setShufflingCount(originals.length);
    setLoading(true);
    try {
      await api.shuffleAssignSupervisors(
        originals.map((m) => m.id),
        shuffleSupervisors.map((m) => m.id)
      );
      // No refetch: the server broadcasts the exact changed rows (maps:upsert)
      // which the realtime cache bridge patches in place.
    } catch (err) {
      for (const original of originals) patch(original);
      setSelected(prevSelected);
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setShufflingCount(0);
    }
  }

  async function handleUnassignInspectors() {
    const originals = selectedForInspectorUnassign;
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
      for (const original of originals) patch(original);
      setSelected(prevSelected);
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setUnassigningCount(0);
    }
  }

  async function handleUnassignSupervisors() {
    const originals = selectedForSupervisorUnassign;
    if (originals.length === 0) return;
    const prevSelected = selected;

    // Optimistically detach the supervisor (map stays in FIELD); the server's
    // broadcastMapsInvalidate() reconciles via realtime.
    for (const original of originals) patch(withUnassignedSupervisor(original));

    setError("");
    setSelected(new Set());
    setUnassigningCount(originals.length);
    setLoading(true);
    try {
      await api.unassignSupervisors(originals.map((m) => m.id));
      // No refetch: realtime maps:upsert reconciles the changed rows.
    } catch (err) {
      for (const original of originals) patch(original);
      setSelected(prevSelected);
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setUnassigningCount(0);
    }
  }

  return (
    <section className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {shufflingCount > 0 && (
        <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Assigning {shufflingCount} map{shufflingCount !== 1 ? "s" : ""}…
        </p>
      )}

      {unassigningCount > 0 && (
        <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Unassigning {unassigningCount} map{unassigningCount !== 1 ? "s" : ""}…
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
        {selectedForInspectorUnassign.length > 0 && (
          <button
            type="button"
            disabled={loading}
            onClick={handleUnassignInspectors}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Unassign inspector ({selectedForInspectorUnassign.length})
          </button>
        )}
        {selectedForSupervisorUnassign.length > 0 && (
          <button
            type="button"
            disabled={loading}
            onClick={handleUnassignSupervisors}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Unassign supervisor ({selectedForSupervisorUnassign.length})
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
        <button
          type="button"
          disabled={loading || deletingAll || maps.length === 0}
          onClick={handleDeleteAllMaps}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
          title="Delete every map in the database"
        >
          {deletingAll ? "Deleting…" : "Delete all maps"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Scroll inside the table · use arrows or trackpad · header stays pinned
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="Scroll maps table">
          <button
            type="button"
            onClick={() => scrollTable(0, -180)}
            className="h-8 w-8 rounded-lg border border-border bg-white text-slate-600 hover:bg-slate-50 text-sm"
            title="Scroll up"
            aria-label="Scroll up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => scrollTable(0, 180)}
            className="h-8 w-8 rounded-lg border border-border bg-white text-slate-600 hover:bg-slate-50 text-sm"
            title="Scroll down"
            aria-label="Scroll down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => scrollTable(-220, 0)}
            className="h-8 w-8 rounded-lg border border-border bg-white text-slate-600 hover:bg-slate-50 text-sm"
            title="Scroll left"
            aria-label="Scroll left"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => scrollTable(220, 0)}
            className="h-8 w-8 rounded-lg border border-border bg-white text-slate-600 hover:bg-slate-50 text-sm"
            title="Scroll right"
            aria-label="Scroll right"
          >
            →
          </button>
        </div>
      </div>

      <div
        ref={tableScrollRef}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 320 : 160;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            scrollTable(step, 0);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            scrollTable(-step, 0);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            scrollTable(0, step);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            scrollTable(0, -step);
          } else if (e.key === "Home") {
            e.preventDefault();
            tableScrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
          } else if (e.key === "End") {
            e.preventDefault();
            const el = tableScrollRef.current;
            if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
          }
        }}
        className="overflow-auto max-h-[min(70vh,720px)] rounded-xl border border-border bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      >
        <table className="w-full text-sm min-w-[1400px] border-separate border-spacing-0">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 w-10 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                <input
                  type="checkbox"
                  checked={filteredMaps.length > 0 && selected.size === filteredMaps.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[110px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Map
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Client
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Batch
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[130px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Map received
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[120px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Pipeline
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[100px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Task
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Station
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[100px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Graphics
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[120px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Inspector
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[110px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                QA
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[100px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Address
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[100px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Supervisor
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Mapper
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Schedule
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Mapping
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Sent to studio
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Received from studio
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[80px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Polish
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Activation
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[90px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Status
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[110px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Supervisor note
              </th>
              <th className="sticky top-0 z-20 bg-slate-50 px-3 py-3 font-semibold min-w-[100px] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                Deadline
              </th>
            </tr>
            <tr className="border-b border-border text-left text-xs normal-case">
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]" />
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                <input
                  type="text"
                  placeholder="Filter…"
                  value={columnFilters.map}
                  onChange={(e) => updateFilter("map", e.target.value)}
                  className={filterInputClass}
                />
              </th>
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
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
              <th className="sticky top-[42px] z-20 bg-white px-3 py-2 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]" colSpan={12} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredMaps.length === 0 ? (
              <tr>
                <td colSpan={23} className="px-4 py-10 text-center text-muted">
                  No maps in this queue.
                </td>
              </tr>
            ) : (
              filteredMaps.map((map) => {
                const graphicsState = getMapDisplayState(map);
                const ready = isReadyToRelease(map);
                const cancelled = map.phase === "CANCELLED";
                return (
                  <tr
                    key={map.id}
                    className={`align-top ${
                      cancelled
                        ? "bg-slate-50/80 text-slate-500 hover:bg-slate-100/80"
                        : map.fieldWorkStatus === "COMPLETED" && map.shiftLeaderApproved === false
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
                        disabled={cancelled}
                      />
                    </td>
                    <td className="px-3 py-3 font-medium whitespace-nowrap">
                      <Link to={`/app/maps/${map.id}`} className="text-brand-600 hover:underline">
                        {map.mapNumber}
                      </Link>
                      {cancelled && (
                        <span className="ml-2 inline-block text-[10px] font-semibold text-red-800 bg-red-100 rounded px-1.5 py-0.5">
                          Cancelled
                        </span>
                      )}
                      {map.fieldWorkStatus === "COMPLETED" && map.shiftLeaderApproved === false && (
                        <span className="ml-2 inline-block text-[10px] font-semibold text-rose-800 bg-rose-100 rounded px-1.5 py-0.5">
                          No SL approval
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">{map.client}</td>
                    <td className="px-3 py-3 text-muted text-xs">{map.batch?.trim() || "—"}</td>
                    <td className="px-3 py-3">
                      <select
                        value={getMapReceivedStatus(map.mapReceived)}
                        disabled={metaSaving === map.id || cancelled}
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
                        <>
                          <select
                            value={getPipelineStage(map.phase)}
                            disabled={metaSaving === map.id}
                            onChange={(e) =>
                              handlePipelineChange(map, e.target.value as PipelineStage)
                            }
                            title="Change pipeline"
                            className={selectClass}
                          >
                            {PIPELINE_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {PIPELINE_STAGE_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          <div
                            className="mt-0.5 text-[10px] text-muted truncate"
                            title={getOpsPipelineLabel(map)}
                          >
                            {getOpsPipelineLabel(map)}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={map.task ?? "UPLOAD"}
                        disabled={metaSaving === map.id || cancelled}
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
                        value={map.station ?? "GRAPHICS"}
                        disabled={metaSaving === map.id || cancelled}
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
                      {graphicsState === "—" ? (
                        "—"
                      ) : (
                        <Badge label={graphicsState} tone={workflowStateTone(graphicsState)} />
                      )}
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
                          {getInspectorLabel(map) === "Unassigned" && needsInspectorAssignment(map) ? (
                            <span className="text-amber-600 text-xs font-medium">Unassigned</span>
                          ) : (
                            getInspectorLabel(map)
                          )}
                        </span>
                        {canAssignInspector(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setAssignInspectorMap(map)}
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 w-fit"
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
                        {map.phase !== "CANCELLED" && map.phase !== "APPROVED" && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setAssignQaMap(map)}
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 w-fit"
                          >
                            {map.assignedQa ? "Reassign" : "Assign"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted text-xs max-w-[120px]">{map.area ?? "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        {map.assignedSupervisor?.name ?? (
                          needsSupervisorAssignment(map) ? (
                            <span className="text-amber-600 text-xs font-medium">Unassigned</span>
                          ) : (
                            "—"
                          )
                        )}
                        {canAssignSupervisor(map) && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setAssignMap(map)}
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 w-fit"
                          >
                            Assign
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">{map.mapperName ?? "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">
                      {formatCsvDateCell(map.scheduleAt, map.scheduleDate)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">
                      {formatCsvDateCell(map.mappingAt, map.mappingDate)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">
                      {formatCsvDateCell(map.sentToStudioAt, map.sentToStudio)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">
                      {formatCsvDateCell(map.receivedFromStudioAt, map.receivedFromStudio)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">
                      {map.polishStage?.trim() || "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">
                      {formatCsvDateCell(map.activationAt, map.activation)}
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
                          disabled={dueDateSaving === map.id || cancelled}
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
