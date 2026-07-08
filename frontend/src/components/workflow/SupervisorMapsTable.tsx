import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord } from "../../types";
import {
  formatNotePreview,
  getCurrentStatusValue,
  getSupervisorStatusOptions,
  statusRowClass,
  type StatusOption,
} from "../../lib/activeMapsWorkflow";
import { Badge } from "../Badge";

interface Props {
  maps: MapRecord[];
  onRefresh: () => void;
  readOnly?: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function supervisorDisplayStatus(map: MapRecord): string {
  if (map.supervisorStatus === "DONE") return "Awaiting OPS";
  if (!map.supervisorStatus) return "New";
  return map.supervisorStatus.charAt(0) + map.supervisorStatus.slice(1).toLowerCase();
}

export function SupervisorMapsTable({ maps, onRefresh, readOnly = false }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function applyStatus(map: MapRecord, option: StatusOption) {
    const note = noteDraft[map.id]?.trim() || undefined;
    if (option.value === "DONE" && !note) {
      setExpandedNote(map.id);
      setError("Add a field note before marking Done (e.g. mapping partner, sections covered).");
      return;
    }

    setError("");
    setLoadingId(map.id);
    try {
      if (option.action.kind === "supervisor") {
        await api.updateSupervisorStatus(map.id, option.action.status, note);
      }
      setNoteDraft((prev) => ({ ...prev, [map.id]: "" }));
      onRefresh();
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
      await api.addMapNote(mapId, body);
      setNoteDraft((prev) => ({ ...prev, [mapId]: "" }));
      setExpandedNote(null);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  if (maps.length === 0) {
    return (
      <p className="text-sm text-muted py-10 text-center border border-dashed border-border rounded-xl bg-white">
        No maps in this section.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50/80 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Map</th>
              <th className="px-4 py-3 font-medium">Store</th>
              <th className="px-4 py-3 font-medium">Area</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              {!readOnly && <th className="px-4 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {maps.map((map) => {
              const options = readOnly ? [] : getSupervisorStatusOptions(map);
              const current = getCurrentStatusValue(map, "inspector");
              const display = supervisorDisplayStatus(map);

              return (
                <tr
                  key={map.id}
                  className={`border-b border-border/60 last:border-0 ${statusRowClass(map)}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/app/maps/${map.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {map.mapNumber}
                    </Link>
                    <p className="text-xs text-muted mt-0.5">{map.jiraTicketId}</p>
                  </td>
                  <td className="px-4 py-3 font-medium">{map.client}</td>
                  <td className="px-4 py-3 text-muted">{map.area ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge
                      label={display}
                      tone={
                        display === "Awaiting OPS"
                          ? "DONE"
                          : display === "New"
                            ? "PENDING"
                            : map.supervisorStatus ?? "ACCEPTED"
                      }
                    />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-xs text-muted truncate">
                      {formatNotePreview(map.notes) || map.description || "—"}
                    </p>
                    {expandedNote === map.id && !readOnly && (
                      <div className="mt-2 flex gap-2">
                        <input
                          value={noteDraft[map.id] ?? ""}
                          onChange={(e) =>
                            setNoteDraft((prev) => ({ ...prev, [map.id]: e.target.value }))
                          }
                          placeholder="Field note…"
                          className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={() => submitNote(map.id)}
                          disabled={loadingId === map.id}
                          className="text-xs px-2 py-1.5 bg-slate-100 rounded-lg hover:bg-slate-200"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </td>
                  {!readOnly && (
                    <td className="px-4 py-3">
                      {options.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {options.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={loadingId === map.id}
                              onClick={() => applyStatus(map, opt)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                                current === opt.value ||
                                (opt.value === "DONE" && map.supervisorStatus === "DONE")
                                  ? "bg-brand-600 text-white border-brand-600"
                                  : "border-border hover:bg-slate-50"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedNote((id) => (id === map.id ? null : map.id))
                            }
                            className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-slate-50"
                          >
                            Note
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">
                          Sent to OPS · {formatDate(map.updatedAt)}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
