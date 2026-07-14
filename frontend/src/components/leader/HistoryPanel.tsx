import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord } from "../../types";
import {
  getWorkflowTimelineLabel,
  workflowTimelineTone,
  getWorkflowTimelinePhase,
  canDeleteMap,
  getBulkDeleteConfirmMessage,
  getInspectorLabel,
  getMapDisplayState,
  getQaLabel,
  workflowStateTone,
} from "../../lib/mapDisplay";
import { Badge } from "../Badge";

interface Props {
  maps: MapRecord[];
  onRefresh: () => void;
}

/** Searchable archive of approved and cancelled maps. */
export function HistoryPanel({ maps, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "APPROVED" | "CANCELLED">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    return maps.filter((map) => {
      if (outcomeFilter !== "all" && map.phase !== outcomeFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        map.mapNumber.toLowerCase().includes(q) ||
        map.client.toLowerCase().includes(q) ||
        (map.jiraTicketId?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [maps, search, outcomeFilter]);

  const deletableFiltered = useMemo(
    () => filtered.filter(canDeleteMap),
    [filtered]
  );

  const selectedDeletable = useMemo(
    () => deletableFiltered.filter((m) => selected.has(m.id)),
    [deletableFiltered, selected]
  );

  const allDeletableSelected =
    deletableFiltered.length > 0 && deletableFiltered.every((m) => selected.has(m.id));

  const approvedCount = maps.filter((m) => m.phase === "APPROVED").length;
  const cancelledCount = maps.filter((m) => m.phase === "CANCELLED").length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allDeletableSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deletableFiltered.map((m) => m.id)));
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

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="text-2xl font-bold text-brand-600">{maps.length}</div>
          <div className="text-sm text-muted">Total archived</div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="text-2xl font-bold text-emerald-600">{approvedCount}</div>
          <div className="text-sm text-muted">Approved</div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-600">{cancelledCount}</div>
          <div className="text-sm text-muted">Cancelled</div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

      {selectedDeletable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-red-800">
            {selectedDeletable.length} selected
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={handleBulkDelete}
            className="px-4 py-1.5 text-sm font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
          >
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted hover:text-slate-900 ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search map, client, Jira..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)}
          className="border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All outcomes</option>
          <option value="APPROVED">Approved only</option>
          <option value="CANCELLED">Cancelled only</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center border border-dashed border-border rounded-xl">
          No archived maps yet. Completed and cancelled maps appear here automatically.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-muted border-b border-border">
                <th className="px-3 py-2 w-10">
                  {deletableFiltered.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allDeletableSelected}
                      onChange={toggleSelectAll}
                      title="Select deletable maps"
                    />
                  )}
                </th>
                <th className="px-3 py-2 font-medium">Map</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Final state</th>
                <th className="px-3 py-2 font-medium">Inspector</th>
                <th className="px-3 py-2 font-medium">QA</th>
                <th className="px-3 py-2 font-medium">Archived</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((map) => {
                const state = getMapDisplayState(map);
                const archivedEntry =
                  map.phaseHistory.find((h) => h.phase === map.phase) ??
                  map.phaseHistory[map.phaseHistory.length - 1];
                const selectable = canDeleteMap(map);

                return (
                  <tr key={map.id} className="hover:bg-slate-50/60">
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
                      <Link
                        to={`/app/maps/${map.id}`}
                        className="font-mono font-medium text-brand-600 hover:underline"
                      >
                        {map.mapNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted">{map.client}</td>
                    <td className="px-3 py-3">
                      <Badge
                        label={getWorkflowTimelineLabel(map.phase)}
                        tone={workflowTimelineTone(getWorkflowTimelinePhase(map.phase))}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {state !== "—" ? (
                        <Badge label={state} tone={workflowStateTone(state)} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">{getInspectorLabel(map)}</td>
                    <td className="px-3 py-3">{getQaLabel(map)}</td>
                    <td className="px-3 py-3 text-muted text-xs">
                      {archivedEntry
                        ? new Date(archivedEntry.enteredAt).toLocaleString()
                        : new Date(map.updatedAt).toLocaleString()}
                      {archivedEntry && (
                        <span className="block text-slate-600">{archivedEntry.user.name}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
