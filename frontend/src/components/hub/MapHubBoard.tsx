import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import type { HubSupervisor, MapRecord } from "../../types";
import {
  applyHubDropLocally,
  formatMapTime,
  formatShiftStart,
  HUB_DRAG_MIME,
  hubDropPayload,
  mapInHubZone,
  poolMaps,
  shortName,
  statusColumnMaps,
  supervisorMaps,
  type HubDropZone,
} from "../../lib/hubDisplay";
import { normalizeMapRecord } from "../../lib/mapSync";
import {
  hasOpsManagerRole,
  hasShiftLeaderRole,
  memberIsShiftLeader,
} from "../../lib/roles";

interface Props {
  mode: "ops" | "supervisor";
  currentUserId: string;
  /** Sync maps table after hub changes */
  onMutate?: (updatedMap?: MapRecord) => void;
}

const STATUS_COLUMNS = [
  {
    status: "COMPLETED" as const,
    label: "Completed",
    dot: "bg-emerald-500",
    header: "bg-emerald-50 border-emerald-200 text-emerald-900",
    zone: "bg-emerald-50/40 border-emerald-200",
  },
  {
    status: "UNCOMPLETED" as const,
    label: "Uncompleted",
    dot: "bg-amber-500",
    header: "bg-amber-50 border-amber-200 text-amber-900",
    zone: "bg-amber-50/40 border-amber-200",
  },
  {
    status: "CANCELLED" as const,
    label: "Cancelled",
    dot: "bg-red-500",
    header: "bg-red-50 border-red-200 text-red-900",
    zone: "bg-red-50/40 border-red-200",
  },
];

const PROGRESS_OPTIONS = [0, 25, 50, 75, 100];

/**
 * Who may drag a specific map:
 * - OPS manager → any map (including restoring cancelled)
 * - Shift leader → any non-cancelled map
 * - Supervisor → only maps assigned to them
 * - Cancelled → OPS manager only
 */
export function canUserDragHubMap(
  map: MapRecord,
  opts: {
    currentUserId: string;
    isOpsManager: boolean;
    isShiftLeader: boolean;
    savingMapId?: string | null;
  }
): boolean {
  if (opts.savingMapId === map.id) return false;
  if (map.fieldWorkStatus === "CANCELLED") return opts.isOpsManager;
  if (opts.isOpsManager || opts.isShiftLeader) return true;
  return map.assignedSupervisor?.id === opts.currentUserId;
}

/** Progress % control only on maps in the Uncompleted end-of-day column */
export function showHubProgressControl(map: MapRecord): boolean {
  return map.onHubStatusBoard && map.fieldWorkStatus === "UNCOMPLETED";
}

export function MapHubBoard({ mode, currentUserId, onMutate }: Props) {
  const { user } = useAuth();
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [supervisors, setSupervisors] = useState<HubSupervisor[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [savingMapId, setSavingMapId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [activeDropZone, setActiveDropZone] = useState<HubDropZone | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [incompleteDialog, setIncompleteDialog] = useState<{
    mapId: string;
    zone: HubDropZone;
    reason: string;
    percent: number;
  } | null>(null);
  const [progressDraft, setProgressDraft] = useState<{ mapId: string; pct: number } | null>(
    null
  );

  const draggedMapIdRef = useRef<string | null>(null);
  const pendingDropRef = useRef<Set<string>>(new Set());
  const onMutateRef = useRef(onMutate);
  onMutateRef.current = onMutate;

  // UI layout: intake column only for OPS managers (not based on mode alone)
  const isOpsManager = hasOpsManagerRole(user);
  const isShiftLeader = hasShiftLeaderRole(user);
  const showIntake = mode === "ops" && isOpsManager;

  const load = useCallback(async (silent = false) => {
    if (!silent) setInitialLoading(true);
    try {
      const hub = await api.getHub();
      setMaps(
        hub.maps.map((m) => ({
          ...m,
          fieldProgressPercent: m.fieldProgressPercent ?? 0,
          onHubStatusBoard: m.onHubStatusBoard ?? false,
        }))
      );
      setSupervisors(hub.supervisors);
      setError("");
    } catch (err) {
      if (!silent) setError((err as Error).message);
    } finally {
      if (!silent) setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => load(true), 45_000);
    return () => clearInterval(interval);
  }, [load]);

  const onShiftSupervisors = useMemo(() => {
    const withMaps = new Set(
      maps.filter((m) => m.assignedSupervisor).map((m) => m.assignedSupervisor!.id)
    );
    return [...supervisors].sort((a, b) => {
      const aLeader = memberIsShiftLeader(a) ? 0 : 1;
      const bLeader = memberIsShiftLeader(b) ? 0 : 1;
      const aHas = withMaps.has(a.id) ? 0 : 1;
      const bHas = withMaps.has(b.id) ? 0 : 1;
      return (
        aLeader - bLeader ||
        aHas - bHas ||
        a.name.localeCompare(b.name)
      );
    });
  }, [supervisors, maps]);

  const onShiftIds = useMemo(
    () => new Set(onShiftSupervisors.map((s) => s.id)),
    [onShiftSupervisors]
  );

  const stats = useMemo(
    () => ({
      pool: poolMaps(maps, onShiftIds).length,
      active: maps.filter(
        (m) =>
          m.assignedSupervisor &&
          onShiftIds.has(m.assignedSupervisor.id) &&
          !m.onHubStatusBoard
      ).length,
      onShift: onShiftSupervisors.length,
    }),
    [maps, onShiftSupervisors, onShiftIds]
  );

  function canDrag(map: MapRecord): boolean {
    return canUserDragHubMap(map, {
      currentUserId,
      isOpsManager,
      isShiftLeader,
      savingMapId,
    });
  }

  function canDropOn(zone: HubDropZone): boolean {
    // Only OPS managers reassign via Intake / supervisor columns
    if (isOpsManager) return true;
    if (zone === "pool" || zone.startsWith("supervisor:")) return false;
    // Shift leaders + supervisors: status columns only
    return true;
  }

  function readDraggedMapId(e: React.DragEvent): string | null {
    return (
      e.dataTransfer.getData(HUB_DRAG_MIME) ||
      e.dataTransfer.getData("text/plain") ||
      draggedMapIdRef.current
    );
  }

  function handleDragStart(e: React.DragEvent, map: MapRecord) {
    if (!canDrag(map)) {
      e.preventDefault();
      return;
    }
    draggedMapIdRef.current = map.id;
    setDraggingId(map.id);
    e.dataTransfer.setData(HUB_DRAG_MIME, map.id);
    e.dataTransfer.setData("text/plain", map.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    setDraggingId(null);
    setActiveDropZone(null);
    window.setTimeout(() => {
      draggedMapIdRef.current = null;
    }, 0);
  }

  async function commitDrop(
    zone: HubDropZone,
    mapId: string,
    extras?: { opsManagerComment?: string | null; fieldProgressPercent?: number }
  ) {
    const map = maps.find((m) => m.id === mapId);
    if (!map) return;
    if (pendingDropRef.current.has(mapId)) return;

    const dropPayload = {
      ...hubDropPayload(zone),
      ...extras,
    };

    const optimistic = applyHubDropLocally(map, zone, supervisors, extras);
    const previousMaps = maps;

    pendingDropRef.current.add(mapId);
    setMaps((prev) => prev.map((m) => (m.id === mapId ? optimistic : m)));
    setError("");
    setActiveDropZone(null);
    setDraggingId(null);
    setIncompleteDialog(null);

    try {
      const updated = await api.updateHubMap(mapId, dropPayload);
      const normalized = normalizeMapRecord(updated);
      setMaps((prev) => prev.map((m) => (m.id === mapId ? normalized : m)));
      onMutateRef.current?.(normalized);
    } catch (err) {
      setMaps(previousMaps);
      setError((err as Error).message);
    } finally {
      pendingDropRef.current.delete(mapId);
      draggedMapIdRef.current = null;
    }
  }

  async function handleDrop(zone: HubDropZone, mapId: string) {
    const map = maps.find((m) => m.id === mapId);
    if (!map) return;
    if (!canDrag(map)) {
      setError("You can only move maps assigned to you (or if you are a shift leader / OPS manager).");
      return;
    }
    if (!canDropOn(zone)) return;
    if (mapInHubZone(map, zone)) return;

    const alreadyOnUncompletedBoard =
      map.onHubStatusBoard && map.fieldWorkStatus === "UNCOMPLETED";

    if (zone === "status:UNCOMPLETED" && !alreadyOnUncompletedBoard) {
      setIncompleteDialog({
        mapId,
        zone,
        reason: map.opsManagerComment?.trim() ?? "",
        percent: Math.min(100, Math.max(0, map.fieldProgressPercent ?? 0)),
      });
      setActiveDropZone(null);
      setDraggingId(null);
      return;
    }

    await commitDrop(zone, mapId);
  }

  async function handleProgressSet(map: MapRecord, pct: number) {
    if (!showHubProgressControl(map)) return;
    if (!canDrag(map)) return;
    if (pct === (map.fieldProgressPercent ?? 0)) return;
    setSavingMapId(map.id);
    try {
      const updated = await api.updateHubMap(map.id, { fieldProgressPercent: pct });
      const normalized = normalizeMapRecord({
        ...map,
        ...updated,
        fieldProgressPercent: updated.fieldProgressPercent ?? pct,
      });
      setMaps((prev) => prev.map((m) => (m.id === map.id ? normalized : m)));
      onMutateRef.current?.(normalized);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingMapId(null);
    }
  }

  function onZoneDragOver(e: React.DragEvent, zone: HubDropZone) {
    if (!draggedMapIdRef.current && !e.dataTransfer.types.includes(HUB_DRAG_MIME)) return;
    if (!canDropOn(zone)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setActiveDropZone(zone);
  }

  function onZoneDrop(e: React.DragEvent, zone: HubDropZone) {
    e.preventDefault();
    e.stopPropagation();
    const mapId = readDraggedMapId(e);
    if (mapId) void handleDrop(zone, mapId);
  }

  function renderMapCard(map: MapRecord, showProgress?: boolean) {
    const draggable = canDrag(map);
    const isSaving = savingMapId === map.id;
    const isDragging = draggingId === map.id;
    const assignedToMe = map.assignedSupervisor?.id === currentUserId;
    const lockHint = !draggable
      ? map.fieldWorkStatus === "CANCELLED"
        ? "Cancelled — only OPS manager can restore"
        : map.assignedSupervisor
          ? assignedToMe
            ? null
            : `Only ${map.assignedSupervisor.name.split(" ")[0]}, shift leaders & OPS can move this`
          : "Assign to a supervisor first (OPS only)"
      : null;
    const pct = map.fieldProgressPercent ?? 0;
    const displayPct =
      progressDraft?.mapId === map.id ? progressDraft.pct : pct;
    const showProgressBar = showProgress && showHubProgressControl(map);

    return (
      <div
        key={map.id}
        draggable={draggable}
        onDragStart={(e) => handleDragStart(e, map)}
        onDragEnd={handleDragEnd}
        className={`group rounded-xl border px-3 py-2.5 text-sm transition-all ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-85"
        } ${
          isDragging
            ? "opacity-40 scale-[0.98] border-brand-300 shadow-lg ring-2 ring-brand-200"
            : isSaving
              ? "opacity-70 border-brand-200 bg-brand-50/50"
              : draggable
                ? "bg-white border-slate-200 shadow-sm hover:border-brand-300 hover:shadow-md"
                : "bg-slate-50 border-slate-200 shadow-none"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 leading-tight truncate">{map.client}</div>
            <Link
              to={`/app/maps/${map.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-mono text-brand-600 hover:underline"
            >
              {map.mapNumber}
            </Link>
          </div>
          {map.fieldDate && (
            <span className="shrink-0 text-[10px] font-semibold tabular-nums bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">
              {formatMapTime(map.fieldDate)}
            </span>
          )}
        </div>
        {map.area && (
          <p className="text-[11px] text-muted mt-1 truncate">{map.area}</p>
        )}
        {map.mapperName && (
          <p className="text-[11px] text-muted mt-0.5 truncate">Mapper · {map.mapperName}</p>
        )}
        {lockHint && (
          <p className="text-[10px] text-amber-800 mt-1.5 leading-snug">{lockHint}</p>
        )}
        {showProgressBar && (
          <div className="mt-2.5 space-y-1" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-[10px] font-semibold text-amber-900">
              <span>Progress</span>
              <span className="tabular-nums">
                {isSaving && progressDraft?.mapId === map.id ? "Saving…" : `${displayPct}%`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={25}
              value={displayPct}
              disabled={isSaving || !draggable}
              onChange={(e) =>
                setProgressDraft({ mapId: map.id, pct: Number(e.target.value) })
              }
              onPointerUp={() => {
                const next =
                  progressDraft?.mapId === map.id ? progressDraft.pct : displayPct;
                setProgressDraft(null);
                void handleProgressSet(map, next);
              }}
              className="w-full h-2 accent-amber-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={`Field progress ${displayPct}%`}
            />
            <div className="flex justify-between text-[9px] text-muted tabular-nums px-0.5">
              {[0, 25, 50, 75, 100].map((n) => (
                <span key={n}>{n}%</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function dropZone(
    zone: HubDropZone,
    mapList: MapRecord[],
    className: string,
    showProgress = false,
    emptyLabel = "Drop maps here"
  ) {
    const isTarget = activeDropZone === zone && draggingId !== null && canDropOn(zone);
    return (
      <div
        onDragEnter={(e) => onZoneDragOver(e, zone)}
        onDragOver={(e) => onZoneDragOver(e, zone)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setActiveDropZone((z) => (z === zone ? null : z));
          }
        }}
        onDrop={(e) => onZoneDrop(e, zone)}
        className={`min-h-[100px] rounded-xl border-2 border-dashed p-2.5 transition-all duration-150 ${
          isTarget
            ? "border-brand-500 bg-brand-50 shadow-inner scale-[1.01]"
            : "border-slate-200/80 bg-slate-50/60"
        } ${className}`}
      >
        <div className="space-y-2" onDragOver={(e) => onZoneDragOver(e, zone)}>
          {mapList.map((m) => renderMapCard(m, showProgress))}
        </div>
        {mapList.length === 0 && (
          <p
            className={`text-xs text-center py-8 ${
              isTarget ? "text-brand-600 font-medium" : "text-muted"
            }`}
          >
            {isTarget ? "Release to drop" : emptyLabel}
          </p>
        )}
      </div>
    );
  }

  if (initialLoading) {
    return (
      <div className="rounded-2xl border border-border bg-white p-12 text-center shadow-sm">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 mb-3" />
        <p className="text-sm text-muted">Loading today&apos;s field board…</p>
      </div>
    );
  }

  const dialogMap = incompleteDialog
    ? maps.find((m) => m.id === incompleteDialog.mapId)
    : null;

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Unassigned", value: stats.pool, accent: "text-brand-600" },
          { label: "Active in field", value: stats.active, accent: "text-slate-900" },
          { label: "Supervisors on shift", value: stats.onShift, accent: "text-slate-900" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border bg-white px-4 py-3 shadow-sm"
          >
            <div className={`text-2xl font-bold tabular-nums ${s.accent}`}>{s.value}</div>
            <div className="text-xs text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {error}
        </p>
      )}

      {!isOpsManager && !isShiftLeader && (
        <p className="text-xs text-muted bg-slate-50 border border-border rounded-xl px-3 py-2">
          You can only drag maps assigned to you. Maps on someone else&apos;s column are locked.
        </p>
      )}
      {isShiftLeader && !isOpsManager && (
        <p className="text-xs text-muted bg-violet-50 border border-violet-200 rounded-xl px-3 py-2">
          Shift leader — you can drag any active map to Completed / Uncompleted / Cancelled. Cancelled maps are OPS-only to restore.
        </p>
      )}
      {isOpsManager &&
        maps.some((m) => m.fieldWorkStatus === "CANCELLED" && m.onHubStatusBoard) && (
        <p className="text-xs text-muted bg-brand-50 border border-brand-200 rounded-xl px-3 py-2">
          Drag cancelled maps back to Intake or a supervisor column to restore them to today&apos;s list.
        </p>
      )}

      <div className="rounded-2xl border border-border bg-gradient-to-b from-white to-slate-50/80 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-5 min-h-[380px]">
          {showIntake && (
            <aside className="lg:w-52 shrink-0">
              <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-3 h-full">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-brand-800">
                    Intake
                  </span>
                  <span className="text-xs font-bold tabular-nums bg-brand-600 text-white px-2 py-0.5 rounded-full">
                    {stats.pool}
                  </span>
                </div>
                <p className="text-[11px] text-muted mb-2 leading-snug">
                  Maps ready for supervisor assignment
                </p>
                {dropZone("pool", poolMaps(maps, onShiftIds), "", false, "Drag maps here to assign")}
              </div>
            </aside>
          )}

          <div className="flex-1 min-w-0 space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted mb-3">
                Supervisors on shift today
              </p>
              {showIntake && onShiftSupervisors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-white px-4 py-10 text-center">
                  <p className="text-sm font-medium text-slate-800">No one on shift today</p>
                  <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                    Only supervisors and shift leaders clocked in for today appear on the Hub.
                    Assign a map to clock them in for this shift.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {onShiftSupervisors.map((sup) => {
                    const supMaps = supervisorMaps(maps, sup.id);
                    const zone: HubDropZone = `supervisor:${sup.id}`;
                    return (
                      <div
                        key={sup.id}
                        className="rounded-xl border border-border bg-white overflow-hidden shadow-sm"
                      >
                        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-slate-50/80">
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                              memberIsShiftLeader(sup)
                                ? "bg-violet-100 text-violet-800"
                                : "bg-brand-100 text-brand-700"
                            }`}
                          >
                            {sup.name.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm text-slate-900 truncate">
                              {shortName(sup.name)}
                            </div>
                            <div className="text-[11px] text-muted">
                              {memberIsShiftLeader(sup) ? "Shift leader" : "Supervisor"}
                              {" · "}
                              {formatShiftStart(sup.shiftStartedAt)}
                            </div>
                          </div>
                          <span className="text-xs font-bold tabular-nums text-muted">
                            {supMaps.length}
                          </span>
                        </div>
                        <div className="p-2.5">
                          {dropZone(zone, supMaps, "min-h-[110px]", false)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted mb-3">
                End-of-day status
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {STATUS_COLUMNS.map(({ status, label, dot, header, zone: zoneClass }) => {
                  const colMaps = statusColumnMaps(maps, status);
                  const zone: HubDropZone = `status:${status}`;
                  return (
                    <div key={status} className="rounded-xl border border-border bg-white overflow-hidden shadow-sm">
                      <div
                        className={`flex items-center gap-2 px-3 py-2 border-b text-sm font-semibold ${header}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        {label}
                        <span className="ml-auto text-xs font-bold tabular-nums opacity-80">
                          {colMaps.length}
                        </span>
                      </div>
                      <div className="p-2.5">
                        {dropZone(zone, colMaps, `min-h-[100px] ${zoneClass}`, status === "UNCOMPLETED")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {incompleteDialog && dialogMap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incomplete-dialog-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-white shadow-xl p-5 space-y-4">
            <div>
              <h2 id="incomplete-dialog-title" className="text-lg font-bold text-slate-900">
                Mark map incomplete
              </h2>
              <p className="text-sm text-muted mt-1">
                <span className="font-mono text-brand-700">{dialogMap.mapNumber}</span>
                {" · "}
                {dialogMap.client}
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                How much was done?
              </span>
              <div className="grid grid-cols-5 gap-2">
                {PROGRESS_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() =>
                      setIncompleteDialog((d) => (d ? { ...d, percent: pct } : d))
                    }
                    className={`rounded-lg border px-2 py-2 text-sm font-semibold tabular-nums transition-colors ${
                      incompleteDialog.percent === pct
                        ? "border-amber-500 bg-amber-50 text-amber-950"
                        : "border-border bg-white text-slate-700 hover:border-amber-300"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Why incomplete?
              </span>
              <textarea
                value={incompleteDialog.reason}
                onChange={(e) =>
                  setIncompleteDialog((d) => (d ? { ...d, reason: e.target.value } : d))
                }
                rows={3}
                placeholder="e.g. Store closed early — partial coverage only"
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400"
                autoFocus
              />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIncompleteDialog(null)}
                className="px-3 py-2 text-sm text-muted hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const trimmed = incompleteDialog.reason.trim();
                  void commitDrop(incompleteDialog.zone, incompleteDialog.mapId, {
                    fieldProgressPercent: incompleteDialog.percent,
                    opsManagerComment: trimmed || null,
                  });
                }}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-amber-600 text-white hover:bg-amber-700"
              >
                Save incomplete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
