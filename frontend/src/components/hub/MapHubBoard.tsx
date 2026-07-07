import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { HubNotification, HubSupervisor, MapRecord } from "../../types";
import {
  applyHubDropLocally,
  formatMapTime,
  formatShiftStart,
  HUB_DRAG_MIME,
  hubDropPayload,
  mapInHubZone,
  nextProgress,
  poolMaps,
  shortName,
  statusColumnMaps,
  supervisorMaps,
  type HubDropZone,
} from "../../lib/hubDisplay";

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

function notificationLabel(action: string): string {
  switch (action) {
    case "hub_completed":
      return "Completed";
    case "hub_cancelled":
      return "Cancelled";
    case "hub_uncompleted":
      return "Uncompleted";
    case "hub_progress":
      return "Progress updated";
    case "hub_reassigned":
      return "Reassigned";
    default:
      return "Hub update";
  }
}

export function MapHubBoard({ mode, currentUserId, onMutate }: Props) {
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [supervisors, setSupervisors] = useState<HubSupervisor[]>([]);
  const [notifications, setNotifications] = useState<HubNotification[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [savingMapId, setSavingMapId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [activeDropZone, setActiveDropZone] = useState<HubDropZone | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const draggedMapIdRef = useRef<string | null>(null);
  const lastNotifCheck = useRef(new Date().toISOString());
  const onMutateRef = useRef(onMutate);
  onMutateRef.current = onMutate;

  const isOps = mode === "ops";

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
      if (isOps) {
        const notes = await api.getHubNotifications(lastNotifCheck.current);
        if (notes.length > 0) {
          setNotifications((prev) => {
            const ids = new Set(prev.map((n) => n.id));
            const merged = [...notes.filter((n) => !ids.has(n.id)), ...prev];
            return merged.slice(0, 30);
          });
        }
        lastNotifCheck.current = new Date().toISOString();
      }
      setError("");
    } catch (err) {
      if (!silent) setError((err as Error).message);
    } finally {
      if (!silent) setInitialLoading(false);
    }
  }, [isOps]);

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
      const aHas = withMaps.has(a.id) ? 0 : 1;
      const bHas = withMaps.has(b.id) ? 0 : 1;
      return aHas - bHas || a.name.localeCompare(b.name);
    });
  }, [supervisors, maps]);

  const stats = useMemo(
    () => ({
      pool: poolMaps(maps).length,
      active: maps.filter((m) => m.assignedSupervisor && !m.onHubStatusBoard).length,
      onShift: onShiftSupervisors.length,
    }),
    [maps, onShiftSupervisors]
  );

  function canDrag(map: MapRecord): boolean {
    if (savingMapId === map.id) return false;
    if (isOps) return true;
    return map.assignedSupervisor?.id === currentUserId;
  }

  function canDropOn(zone: HubDropZone): boolean {
    if (isOps) return true;
    if (zone === "pool" || zone.startsWith("supervisor:")) return false;
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

  async function handleDrop(zone: HubDropZone, mapId: string) {
    const map = maps.find((m) => m.id === mapId);
    if (!map) return;
    if (!canDrag(map)) return;
    if (!canDropOn(zone)) return;
    if (mapInHubZone(map, zone)) return;

    const optimistic = applyHubDropLocally(map, zone, supervisors);
    const previousMaps = maps;
    const previousSupervisors = supervisors;

    setMaps((prev) => prev.map((m) => (m.id === mapId ? optimistic : m)));
    setSavingMapId(mapId);
    setError("");
    setActiveDropZone(null);
    setDraggingId(null);

    try {
      const updated = await api.updateHubMap(mapId, hubDropPayload(zone));
      const normalized = {
        ...updated,
        fieldProgressPercent: updated.fieldProgressPercent ?? 0,
        onHubStatusBoard: updated.onHubStatusBoard ?? false,
      };
      setMaps((prev) => prev.map((m) => (m.id === mapId ? normalized : m)));
      onMutateRef.current?.(normalized);
      void load(true);
    } catch (err) {
      setMaps(previousMaps);
      setSupervisors(previousSupervisors);
      setError((err as Error).message);
    } finally {
      setSavingMapId(null);
      draggedMapIdRef.current = null;
    }
  }

  async function handleProgressClick(map: MapRecord) {
    if (map.fieldWorkStatus !== "UNCOMPLETED") return;
    if (!canDrag(map)) return;
    const pct = nextProgress(map.fieldProgressPercent ?? 0);
    setSavingMapId(map.id);
    try {
      const updated = await api.updateHubMap(map.id, { fieldProgressPercent: pct });
      const normalized = {
        ...updated,
        fieldProgressPercent: updated.fieldProgressPercent ?? pct,
        onHubStatusBoard: updated.onHubStatusBoard ?? false,
      };
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

    return (
      <div
        key={map.id}
        draggable={draggable}
        onDragStart={(e) => handleDragStart(e, map)}
        onDragEnd={handleDragEnd}
        className={`group rounded-xl border px-3 py-2.5 text-sm transition-all ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        } ${
          isDragging
            ? "opacity-40 scale-[0.98] border-brand-300 shadow-lg ring-2 ring-brand-200"
            : isSaving
              ? "opacity-70 border-brand-200 bg-brand-50/50"
              : "bg-white border-slate-200 shadow-sm hover:border-brand-300 hover:shadow-md"
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
        {showProgress && map.fieldWorkStatus === "UNCOMPLETED" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleProgressClick(map);
            }}
            disabled={isSaving}
            className="mt-2 w-full text-left text-[11px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg px-2 py-1.5 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : `${map.fieldProgressPercent ?? 0}% complete`}
          </button>
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

      {isOps && notifications.length > 0 && (
        <div className="rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand-800 mb-1.5">
            Live updates
          </p>
          <ul className="text-xs space-y-1">
            {notifications.slice(0, 3).map((n) => (
              <li key={n.id} className="text-slate-700">
                <span className="font-semibold text-brand-700">{notificationLabel(n.action)}</span>
                {" · "}
                {n.map.mapNumber} — {n.user.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-gradient-to-b from-white to-slate-50/80 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-5 min-h-[380px]">
          {isOps && (
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
                {dropZone("pool", poolMaps(maps), "", false, "Drag maps here to assign")}
              </div>
            </aside>
          )}

          <div className="flex-1 min-w-0 space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted mb-3">
                Supervisors on shift today
              </p>
              {isOps && onShiftSupervisors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-white px-4 py-10 text-center">
                  <p className="text-sm font-medium text-slate-800">No supervisors clocked in yet</p>
                  <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                    Drag a map from Intake onto a supervisor card when they arrive — or assign from
                    the Maps table.
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
                          <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold shrink-0">
                            {sup.name.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm text-slate-900 truncate">
                              {shortName(sup.name)}
                            </div>
                            <div className="text-[11px] text-muted">
                              Shift · {formatShiftStart(sup.shiftStartedAt)}
                            </div>
                          </div>
                          <span className="text-xs font-bold tabular-nums text-muted">
                            {supMaps.length}
                          </span>
                        </div>
                        <div className="p-2.5">
                          {dropZone(zone, supMaps, "min-h-[110px]", true)}
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
    </div>
  );
}
