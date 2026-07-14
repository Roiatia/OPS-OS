import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord, MapStatus } from "../../types";
import { getMapDisplayState, getTaskType } from "../../lib/mapDisplay";
import {
  formatNotePreview,
  getCurrentStatusValue,
  getMapStatusOptions,
  isFixStatusOption,
  statusRowClass,
  type StatusOption,
} from "../../lib/activeMapsWorkflow";
import { Badge } from "../Badge";
import { StationSelect } from "./StationSelect";
import { QaFixModal } from "./QaFixModal";
import { LoadingField } from "./LoadingField";

interface Props {
  maps: MapRecord[];
  role: "inspector" | "qa";
  onRefresh: () => void | Promise<void>;
  onMapUpdated?: (maps: MapRecord[]) => void;
}

/** Formats a due date for inbox and active map tables. */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Returns Tailwind classes for the status dropdown based on display state. */
function statusSelectClass(displayState: string): string {
  switch (displayState) {
    case "Fix":
      return "bg-red-100 border-red-200 text-red-800";
    case "Approved":
      return "bg-emerald-100 border-emerald-200 text-emerald-800";
    case "Done":
      return "bg-sky-100 border-sky-200 text-sky-800";
    case "Accepted":
      return "bg-amber-100 border-amber-200 text-amber-800";
    case "Fix Done":
      return "bg-violet-100 border-violet-200 text-violet-800";
    case "Processing":
      return "bg-blue-100 border-blue-200 text-blue-800";
    default:
      return "bg-white border-border";
  }
}

/** Shared inspector/QA table for updating status, notes, and station. */
export function ActiveMapsTable({ maps, role, onRefresh, onMapUpdated }: Props) {
  async function commitMap(map: MapRecord) {
    if (onMapUpdated) onMapUpdated([map]);
    else await Promise.resolve(onRefresh());
  }
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null);
  const [noteLoadingId, setNoteLoadingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fixModalMap, setFixModalMap] = useState<MapRecord | null>(null);
  const [selectReset, setSelectReset] = useState<Record<string, number>>({});

  async function applyStatus(
    map: MapRecord,
    option: StatusOption,
    fixPayload?: { note: string; attachment?: { fileName: string; mimeType: string; data: string } }
  ) {
    const note = fixPayload?.note ?? (noteDraft[map.id]?.trim() || undefined);
    const attachment = fixPayload?.attachment;

    setError("");
    setStatusLoadingId(map.id);
    try {
      const updated = await api.updateMapStatus(map.id, option.action.status, note, attachment);
      setNoteDraft((prev) => ({ ...prev, [map.id]: "" }));
      setExpandedNote(null);
      setFixModalMap(null);
      await commitMap(updated);
    } catch (e) {
      setError((e as Error).message);
      await Promise.resolve(onRefresh());
    } finally {
      setStatusLoadingId(null);
    }
  }

  /** Applies a status change, opening the fix modal when Fix is selected. */
  function handleStatusChange(map: MapRecord, options: StatusOption[], value: string) {
    const currentValue = getCurrentStatusValue(map);
    if (value === currentValue) return;

    const opt = options.find((o) => o.value === value);
    if (!opt) {
      setSelectReset((prev) => ({ ...prev, [map.id]: (prev[map.id] ?? 0) + 1 }));
      return;
    }

    if (isFixStatusOption(opt)) {
      setFixModalMap(map);
      setSelectReset((prev) => ({ ...prev, [map.id]: (prev[map.id] ?? 0) + 1 }));
      return;
    }

    applyStatus(map, opt);
  }

  async function submitNote(mapId: string) {
    const body = noteDraft[mapId]?.trim();
    if (!body) return;
    setNoteLoadingId(mapId);
    try {
      const updated = await api.addMapNote(mapId, body);
      setNoteDraft((prev) => ({ ...prev, [mapId]: "" }));
      setExpandedNote(null);
      await commitMap(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setNoteLoadingId(null);
    }
  }

  if (maps.length === 0) {
    return (
      <p className="text-sm text-muted py-10 text-center border border-dashed border-border rounded-xl bg-white">
        No active maps yet. New assignments appear above until you accept them.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {fixModalMap && (
        <QaFixModal
          map={fixModalMap}
          loading={statusLoadingId === fixModalMap.id}
          onClose={() => setFixModalMap(null)}
          onSubmit={(payload) => {
            const fixOpt = getMapStatusOptions(fixModalMap).find((o) => isFixStatusOption(o));
            if (fixOpt) applyStatus(fixModalMap, fixOpt, payload);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-muted border-b border-border">
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Date</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Map</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Customer</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Task</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap min-w-[120px]">Station</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Due</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap min-w-[130px]">Status</th>
              <th className="px-3 py-2.5 font-semibold min-w-[220px]">General notes</th>
              {role === "qa" ? (
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Inspector</th>
              ) : (
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Assigned QA</th>
              )}
            </tr>
          </thead>
          <tbody>
            {maps.map((map) => {
              const displayState = getMapDisplayState(map);
              const options = getMapStatusOptions(map);
              const currentValue = getCurrentStatusValue(map);
              const taskType = getTaskType(map);
              const isExpanded = expandedNote === map.id;
              const selectKey = `${map.id}-${selectReset[map.id] ?? 0}`;

              return (
                <tr
                  key={map.id}
                  className={`border-b border-border last:border-0 ${statusRowClass(map)} hover:brightness-[0.99]`}
                >
                  <td className="px-3 py-2.5 text-muted whitespace-nowrap text-xs">
                    {formatDate(map.createdAt)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Link
                      to={`/app/maps/${map.id}`}
                      className="font-mono font-semibold text-brand-600 hover:underline"
                    >
                      {map.mapNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{map.client}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {taskType ? (
                      <Badge label={taskType} tone={taskType === "Upload" ? "PREP" : "POLISH"} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StationSelect
                      map={map}
                      onMapUpdated={(m) => void commitMap(m)}
                      onError={setError}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-muted text-xs whitespace-nowrap">
                    {map.dueDate ? formatDate(map.dueDate) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <LoadingField loading={statusLoadingId === map.id}>
                      <select
                        key={selectKey}
                        value={currentValue}
                        disabled={statusLoadingId === map.id}
                        onChange={(e) =>
                          handleStatusChange(map, options, e.target.value as MapStatus)
                        }
                        aria-busy={statusLoadingId === map.id}
                        className={`w-full text-xs font-medium rounded-md border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60 ${statusSelectClass(displayState)}`}
                      >
                        {!currentValue && (
                          <option value="" disabled>
                            Select status…
                          </option>
                        )}
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </LoadingField>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="space-y-1.5">
                      {map.notes?.length > 0 && (
                        <div className="space-y-1 max-h-20 overflow-y-auto">
                          {map.notes.slice(-3).map((n) => (
                            <p key={n.id} className="text-xs text-slate-600 leading-snug">
                              <span className="font-medium text-slate-800">[{n.user.name.split(" ")[0]}]</span>{" "}
                              {n.body}
                            </p>
                          ))}
                        </div>
                      )}
                      {!isExpanded ? (
                        <button
                          type="button"
                          onClick={() => setExpandedNote(map.id)}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          {map.notes?.length ? "Add note..." : formatNotePreview(map.notes) || "Add note..."}
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <input
                            value={noteDraft[map.id] ?? ""}
                            onChange={(e) =>
                              setNoteDraft((prev) => ({ ...prev, [map.id]: e.target.value }))
                            }
                            placeholder="Add a note…"
                            className="flex-1 text-xs border border-border rounded px-2 py-1 min-w-0"
                            onKeyDown={(e) => e.key === "Enter" && submitNote(map.id)}
                          />
                          <button
                            type="button"
                            onClick={() => submitNote(map.id)}
                            disabled={noteLoadingId === map.id || !(noteDraft[map.id]?.trim())}
                            className="text-xs px-2 py-1 bg-brand-600 text-white rounded disabled:opacity-50 min-w-[44px]"
                          >
                            {noteLoadingId === map.id ? (
                              <span className="inline-flex justify-center">
                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              </span>
                            ) : (
                              "Save"
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap text-xs">
                    {role === "qa"
                      ? (map.assignedInspector?.name ?? "—")
                      : (map.assignedQa?.name ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
