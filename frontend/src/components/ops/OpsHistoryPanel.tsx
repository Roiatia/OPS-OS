import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MapRecord } from "../../types";
import { PHASE_LABELS } from "../../types";
import { Badge } from "@/components/common/Badge";
import { getOpsPipelineLabel, getOpsStatusLabel, opsStatusTone } from "../../lib/opsDisplay";
import { getOpsWorkloadAlerts } from "../../lib/opsWorkload";
import type { TeamMember } from "../../types";

interface Props {
  activeMaps: MapRecord[];
  historyMaps: MapRecord[];
  team: TeamMember[];
}

type HistoryFilter = "all" | "active" | "done" | "cancelled" | "on_shift";

export function OpsHistoryPanel({ activeMaps, historyMaps, team }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const allMaps = useMemo(() => {
    const byId = new Map<string, MapRecord>();
    for (const m of [...activeMaps, ...historyMaps]) {
      byId.set(m.id, m);
    }
    return [...byId.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [activeMaps, historyMaps]);

  const onShiftMemberIds = useMemo(() => {
    const alerts = getOpsWorkloadAlerts(team, activeMaps, allMaps);
    const ids = new Set<string>();
    for (const a of alerts) ids.add(a.member.id);
    for (const m of activeMaps) {
      if (m.assignedSupervisor) ids.add(m.assignedSupervisor.id);
      if (m.assignedInspector) ids.add(m.assignedInspector.id);
      if (m.assignedQa) ids.add(m.assignedQa.id);
    }
    return ids;
  }, [team, activeMaps, allMaps]);

  const onShiftCompleted = useMemo(
    () =>
      allMaps.filter((m) => {
        const done = m.phase === "APPROVED" || m.fieldWorkStatus === "COMPLETED";
        if (!done) return false;
        return (
          (m.assignedSupervisor?.id && onShiftMemberIds.has(m.assignedSupervisor.id)) ||
          (m.assignedInspector?.id && onShiftMemberIds.has(m.assignedInspector.id)) ||
          (m.assignedQa?.id && onShiftMemberIds.has(m.assignedQa.id))
        );
      }),
    [allMaps, onShiftMemberIds]
  );

  const filtered = useMemo(() => {
    return allMaps.filter((map) => {
      if (filter === "active" && ["APPROVED", "CANCELLED"].includes(map.phase)) return false;
      if (filter === "done" && map.phase !== "APPROVED") return false;
      if (filter === "cancelled" && map.phase !== "CANCELLED") return false;
      if (filter === "on_shift") {
        const onShift =
          (map.assignedSupervisor?.id && onShiftMemberIds.has(map.assignedSupervisor.id)) ||
          (map.assignedInspector?.id && onShiftMemberIds.has(map.assignedInspector.id)) ||
          (map.assignedQa?.id && onShiftMemberIds.has(map.assignedQa.id));
        if (!onShift) return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        map.mapNumber.toLowerCase().includes(q) ||
        map.client.toLowerCase().includes(q) ||
        (map.area?.toLowerCase().includes(q) ?? false) ||
        (map.jiraTicketId?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [allMaps, filter, search, onShiftMemberIds]);

  const stats = useMemo(
    () => ({
      total: allMaps.length,
      active: allMaps.filter((m) => !["APPROVED", "CANCELLED"].includes(m.phase)).length,
      done: allMaps.filter((m) => m.phase === "APPROVED").length,
      cancelled: allMaps.filter((m) => m.phase === "CANCELLED").length,
    }),
    [allMaps]
  );

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "All maps", value: stats.total },
          { label: "Active pipeline", value: stats.active },
          { label: "Completed", value: stats.done },
          { label: "Cancelled", value: stats.cancelled },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <div className="text-2xl font-bold text-brand-600">{s.value}</div>
            <div className="text-sm text-muted">{s.label}</div>
          </div>
        ))}
      </div>

      {onShiftCompleted.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-2">
            On shift — recently done ({onShiftCompleted.length})
          </h3>
          <p className="text-xs text-muted mb-3">
            Maps finished by part-time staff still on shift today.
          </p>
          <div className="flex flex-wrap gap-2">
            {onShiftCompleted.slice(0, 8).map((map) => (
              <Link
                key={map.id}
                to={`/app/maps/${map.id}`}
                className="text-xs px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-brand-700 hover:bg-amber-50"
              >
                {map.mapNumber}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search map, client, address, Jira…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as HistoryFilter)}
          className="border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All maps</option>
          <option value="active">Active only</option>
          <option value="done">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="on_shift">On shift team</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center border border-dashed border-border rounded-xl">
          No maps match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted border-b border-border">
                <th className="px-3 py-2 font-semibold">Map</th>
                <th className="px-3 py-2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Pipeline</th>
                <th className="px-3 py-2 font-semibold">Address</th>
                <th className="px-3 py-2 font-semibold">Team</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((map) => {
                const teamLine = [
                  map.assignedInspector?.name && `Insp: ${map.assignedInspector.name}`,
                  map.assignedQa?.name && `QA: ${map.assignedQa.name}`,
                  map.assignedSupervisor?.name && `Sup: ${map.assignedSupervisor.name}`,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <tr key={map.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <Link
                        to={`/app/maps/${map.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {map.mapNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{map.client}</td>
                    <td className="px-3 py-3">
                      <Badge label={getOpsPipelineLabel(map)} tone={opsStatusTone(map)} />
                      {["APPROVED", "CANCELLED"].includes(map.phase) && (
                        <span className="block text-[10px] text-muted mt-0.5">
                          {PHASE_LABELS[map.phase]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted text-xs">{map.area ?? "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted max-w-[180px] truncate" title={teamLine}>
                      {teamLine || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge label={getOpsStatusLabel(map)} tone={opsStatusTone(map)} />
                    </td>
                    <td className="px-3 py-3 text-muted text-xs whitespace-nowrap">
                      {new Date(map.updatedAt).toLocaleString()}
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
