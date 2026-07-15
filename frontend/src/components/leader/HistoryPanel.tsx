import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MapRecord } from "../../types";
import { PHASE_LABELS } from "../../types";
import { Badge } from "@/components/common/Badge";
import {
  getInspectorLabel,
  getMapDisplayState,
  getQaLabel,
  workflowStateTone,
} from "../../lib/mapDisplay";

interface Props {
  maps: MapRecord[];
}

export function HistoryPanel({ maps }: Props) {
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "APPROVED" | "CANCELLED">("all");

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

  const approvedCount = maps.filter((m) => m.phase === "APPROVED").length;
  const cancelledCount = maps.filter((m) => m.phase === "CANCELLED").length;

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

                return (
                  <tr key={map.id} className="hover:bg-slate-50/60">
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
                      <Badge label={PHASE_LABELS[map.phase]} tone={map.phase} />
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
