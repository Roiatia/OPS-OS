import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord } from "../../types";
import { getMapDisplayState, getTaskType, workflowStateTone } from "../../lib/mapDisplay";
import {
  formatNotePreview,
  getCurrentStatusValue,
  getInspectorStatusOptions,
  getQaStatusOptions,
  statusRowClass,
  type StatusOption,
} from "../../lib/activeMapsWorkflow";
import { Badge } from "@/components/common/Badge";

interface Props {
  maps: MapRecord[];
  role: "inspector" | "qa";
  /** Silent/debounced reload — fallback for errors and realtime. */
  onRefresh: () => void;
  /** Patch a single updated map into parent state (mirrors MapHubBoard). */
  onPatch?: (map: MapRecord) => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ActiveMapsTable({ maps, role, onRefresh, onPatch }: Props) {
  const patch = (map: MapRecord) => (onPatch ? onPatch(map) : onRefresh());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function applyStatus(map: MapRecord, option: StatusOption) {
    const needsNote =
      option.value === "fix" ||
      option.value === "upload_fix" ||
      option.action.kind === "qa_review" && option.action.status === "fix";

    const note = noteDraft[map.id]?.trim() || undefined;
    if (needsNote && !note) {
      setExpandedNote(map.id);
      setError("Add a note in General notes before setting status to Fix.");
      return;
    }

    setError("");
    setLoadingId(map.id);
    try {
      const action = option.action;
      let updated: MapRecord | undefined;
      if (action.kind === "inspector") {
        updated = await api.updateInspectorStatus(map.id, action.status, note);
      } else if (action.kind === "qa_review") {
        updated = await api.qaReview(map.id, action.status, note);
      } else if (action.kind === "upload_review") {
        updated = await api.uploadReview(map.id, action.approved, note);
      }
      setNoteDraft((prev) => ({ ...prev, [map.id]: "" }));
      if (updated) patch(updated);
      else onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  async function submitNote(mapId: string) {
    const body = noteDraft[mapId]?.trim();
    if (!body) return;
    setLoadingId(mapId);
    try {
      const updated = await api.addMapNote(mapId, body);
      setNoteDraft((prev) => ({ ...prev, [mapId]: "" }));
      setExpandedNote(null);
      patch(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  if (maps.length === 0) {
    return (
      <p className="text-sm text-muted py-10 text-center border border-dashed border-border rounded-xl bg-white">
        No active maps yet. New assignments appear above until you accept them.
      </p>
    );
  }

  const statusOptionsFor = (map: MapRecord) =>
    role === "inspector" ? getInspectorStatusOptions(map) : getQaStatusOptions(map);

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-muted border-b border-border">
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Date</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Map</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Customer</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Task</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Due</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap min-w-[130px]">Status</th>
              <th className="px-3 py-2.5 font-semibold min-w-[220px]">General notes</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Assigned QA</th>
            </tr>
          </thead>
          <tbody>
            {maps.map((map) => {
              const displayState = getMapDisplayState(map);
              const options = statusOptionsFor(map);
              const currentValue = getCurrentStatusValue(map, role);
              const taskType = getTaskType(map);
              const isExpanded = expandedNote === map.id;

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
                  <td className="px-3 py-2.5 text-muted text-xs whitespace-nowrap">
                    {map.dueDate ? formatDate(map.dueDate) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {options.length > 0 ? (
                      <select
                        value={currentValue}
                        disabled={loadingId === map.id}
                        onChange={(e) => {
                          const opt = options.find((o) => o.value === e.target.value);
                          if (opt) applyStatus(map, opt);
                        }}
                        className={`w-full text-xs font-medium rounded-md border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 ${
                          displayState === "Fix"
                            ? "bg-red-100 border-red-200 text-red-800"
                            : displayState === "Approved"
                              ? "bg-emerald-100 border-emerald-200 text-emerald-800"
                              : displayState === "In QA"
                                ? "bg-sky-100 border-sky-200 text-sky-800"
                                : displayState === "Accepted"
                                  ? "bg-amber-100 border-amber-200 text-amber-800"
                                  : "bg-white border-border"
                        }`}
                      >
                        <option value="" disabled>
                          {displayState === "—" ? "Select..." : displayState}
                        </option>
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge
                        label={displayState === "—" ? "—" : displayState}
                        tone={workflowStateTone(displayState)}
                      />
                    )}
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
                            placeholder="Note for QA / inspector..."
                            className="flex-1 text-xs border border-border rounded px-2 py-1 min-w-0"
                            onKeyDown={(e) => e.key === "Enter" && submitNote(map.id)}
                          />
                          <button
                            type="button"
                            onClick={() => submitNote(map.id)}
                            disabled={loadingId === map.id}
                            className="text-xs px-2 py-1 bg-brand-600 text-white rounded disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap text-xs">
                    {map.assignedQa?.name ?? "—"}
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
