import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { FieldWorkStatus, MapRecord } from "../../types";
import { Badge } from "@/components/common/Badge";
import {
  FIELD_WORK_STATUS_LABELS,
  fieldWorkStatusTone,
  formatFieldDate,
  getSupervisorFieldStatus,
  matchesSupervisorQueue,
  toFieldDateInput,
  type SupervisorMapQueue,
} from "../../lib/supervisorDisplay";

interface Props {
  maps: MapRecord[];
  /** Silent/debounced reload — fallback for errors and realtime. */
  onRefresh: () => void;
  /** Patch a single updated map into parent state (mirrors MapHubBoard). */
  onPatch?: (map: MapRecord) => void;
}

const QUEUE_TABS: { id: SupervisorMapQueue; label: string }[] = [
  { id: "all", label: "All" },
  { id: "uncompleted", label: "Uncompleted" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const filterInputClass =
  "w-full border border-border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-500";

export function SupervisorMapsBoard({ maps, onRefresh, onPatch }: Props) {
  const patch = (map: MapRecord) => (onPatch ? onPatch(map) : onRefresh());
  const [queue, setQueue] = useState<SupervisorMapQueue>("all");
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { mapperName: string; fieldDate: string; opsManagerComment: string }>
  >({});

  const clients = useMemo(() => [...new Set(maps.map((m) => m.client))].sort(), [maps]);

  const filteredMaps = useMemo(
    () =>
      maps.filter((map) => {
        if (!matchesSupervisorQueue(map, queue)) return false;
        if (clientFilter && map.client !== clientFilter) return false;
        if (statusFilter && getSupervisorFieldStatus(map) !== statusFilter) return false;
        return true;
      }),
    [maps, queue, clientFilter, statusFilter]
  );

  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        QUEUE_TABS.map((tab) => [tab.id, maps.filter((m) => matchesSupervisorQueue(m, tab.id)).length])
      ) as Record<SupervisorMapQueue, number>,
    [maps]
  );

  function getDraft(map: MapRecord) {
    return (
      drafts[map.id] ?? {
        mapperName: map.mapperName ?? "",
        fieldDate: toFieldDateInput(map.fieldDate),
        opsManagerComment: map.opsManagerComment ?? "",
      }
    );
  }

  async function saveField(
    map: MapRecord,
    patchData: {
      loomDone?: boolean;
      positioning?: boolean;
      mapperName?: string | null;
      fieldDate?: string | null;
      opsManagerComment?: string | null;
      fieldWorkStatus?: FieldWorkStatus;
    }
  ) {
    setError("");
    setSavingId(map.id);
    try {
      const updated = await api.updateSupervisorField(map.id, patchData);
      patch(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {QUEUE_TABS.map((tab) => (
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
            {tab.label}{" "}
            <span className={queue === tab.id ? "text-white/80" : "text-muted"}>
              {queueCounts[tab.id]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="border-b border-border bg-slate-50/90 text-left">
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-32">
                Map
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-32">
                <div>Client</div>
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className={`${filterInputClass} mt-1 font-normal normal-case`}
                >
                  <option value="">All</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-20 text-center">
                Loom done
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-20 text-center">
                Positioning
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-32">
                Date
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-36">
                Mapper name
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-28">
                <div>Status</div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={`${filterInputClass} mt-1 font-normal normal-case`}
                >
                  <option value="">All</option>
                  <option value="UNCOMPLETED">Uncompleted</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted min-w-[180px]">
                Comment to OPS
              </th>
              <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted w-24">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredMaps.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted">
                  No maps assigned yet. OPS manager will schedule field maps here.
                </td>
              </tr>
            ) : (
              filteredMaps.map((map) => {
                const status = getSupervisorFieldStatus(map);
                const draft = getDraft(map);
                const readOnly = status === "CANCELLED" || status === "COMPLETED";
                const saving = savingId === map.id;

                return (
                  <tr
                    key={map.id}
                    className={`border-b border-border/70 align-top ${
                      map.fieldWorkStatus === "COMPLETED" && map.shiftLeaderApproved === false
                        ? "bg-rose-50/90 hover:bg-rose-50"
                        : "hover:bg-slate-50/50"
                    }`}
                  >
                    <td className="px-3 py-3">
                      <Link
                        to={`/app/maps/${map.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {map.mapNumber}
                      </Link>
                      {map.area && <p className="text-xs text-muted mt-0.5">{map.area}</p>}
                    </td>
                    <td className="px-3 py-3 font-medium">{map.client}</td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={map.loomDone}
                        disabled={readOnly || saving}
                        onChange={(e) => saveField(map, { loomDone: e.target.checked })}
                        className="w-4 h-4 rounded border-border text-brand-600"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={map.positioning}
                        disabled={readOnly || saving}
                        onChange={(e) => saveField(map, { positioning: e.target.checked })}
                        className="w-4 h-4 rounded border-border text-brand-600"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {readOnly ? (
                        <span className="text-muted">{formatFieldDate(map.fieldDate)}</span>
                      ) : (
                        <input
                          type="date"
                          value={draft.fieldDate}
                          disabled={saving}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [map.id]: { ...draft, fieldDate: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            const next = draft.fieldDate || null;
                            const current = toFieldDateInput(map.fieldDate) || null;
                            if (next !== current) saveField(map, { fieldDate: next });
                          }}
                          className={filterInputClass}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {readOnly ? (
                        <span>{map.mapperName || "—"}</span>
                      ) : (
                        <input
                          type="text"
                          placeholder="Mapper on-site"
                          value={draft.mapperName}
                          disabled={saving}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [map.id]: { ...draft, mapperName: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            const next = draft.mapperName.trim() || null;
                            if (next !== (map.mapperName ?? null)) {
                              saveField(map, { mapperName: next });
                            }
                          }}
                          className={filterInputClass}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        label={FIELD_WORK_STATUS_LABELS[status]}
                        tone={fieldWorkStatusTone(status)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {readOnly ? (
                        <span className="text-xs text-muted">{map.opsManagerComment || "—"}</span>
                      ) : (
                        <textarea
                          rows={2}
                          placeholder="Message for OPS manager…"
                          value={draft.opsManagerComment}
                          disabled={saving}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [map.id]: { ...draft, opsManagerComment: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            const next = draft.opsManagerComment.trim() || null;
                            if (next !== (map.opsManagerComment ?? null)) {
                              saveField(map, { opsManagerComment: next });
                            }
                          }}
                          className={`${filterInputClass} resize-none`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => saveField(map, { fieldWorkStatus: "COMPLETED" })}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          Mark done
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
