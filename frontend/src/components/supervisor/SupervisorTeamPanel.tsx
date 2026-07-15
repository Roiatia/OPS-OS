import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import type { MapRecord, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import {
  FIELD_WORK_STATUS_LABELS,
  fieldWorkStatusTone,
  formatFieldDateTime,
  getSupervisorFieldStatus,
} from "../../lib/supervisorDisplay";
import { Badge } from "../Badge";
import { Modal } from "../leader/Modal";

interface Props {
  team: TeamMember[];
  teamFieldMaps: MapRecord[];
  myMaps: MapRecord[];
  onRefresh: () => void;
}

export function SupervisorTeamPanel({ team, teamFieldMaps, myMaps, onRefresh }: Props) {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapTargetId, setSwapTargetId] = useState("");
  const [selectedMapIds, setSelectedMapIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const supervisors = team.filter((m) => m.roles.some((r) => r.role === "SUPERVISOR"));
  const otherSupervisors = supervisors.filter((m) => m.id !== user?.id);

  const mapsForMember = useMemo(() => {
    if (!selectedId) return [];
    return teamFieldMaps.filter(
      (m) =>
        m.assignedSupervisor?.id === selectedId &&
        getSupervisorFieldStatus(m) === "UNCOMPLETED"
    );
  }, [teamFieldMaps, selectedId]);

  const myActiveMaps = useMemo(
    () => myMaps.filter((m) => getSupervisorFieldStatus(m) === "UNCOMPLETED"),
    [myMaps]
  );

  const activeCountBySupervisor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const map of teamFieldMaps) {
      if (!map.assignedSupervisor) continue;
      if (getSupervisorFieldStatus(map) !== "UNCOMPLETED") continue;
      counts.set(
        map.assignedSupervisor.id,
        (counts.get(map.assignedSupervisor.id) ?? 0) + 1
      );
    }
    return counts;
  }, [teamFieldMaps]);

  const selectedMember = supervisors.find((m) => m.id === selectedId) ?? null;

  function openSwap() {
    setSelectedMapIds(new Set(myActiveMaps.map((m) => m.id)));
    setSwapTargetId(otherSupervisors[0]?.id ?? "");
    setSwapOpen(true);
    setError("");
  }

  async function confirmSwap() {
    if (!swapTargetId || selectedMapIds.size === 0) {
      setError("Pick a teammate and at least one map.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.swapSupervisorMaps([...selectedMapIds], swapTargetId);
      setSwapOpen(false);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Team</h2>
          <p className="text-sm text-muted mt-0.5">All supervisors — tap a member to see their active maps</p>
        </div>
        {myActiveMaps.length > 0 && otherSupervisors.length > 0 && (
          <button
            type="button"
            onClick={openSwap}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-amber-500 text-white hover:bg-amber-600"
          >
            Call for a swap
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {supervisors.map((member) => {
          const isMe = member.id === user?.id;
          const active = activeCountBySupervisor.get(member.id) ?? 0;
          const selected = selectedId === member.id;

          return (
            <button
              key={member.id}
              type="button"
              onClick={() => setSelectedId(selected ? null : member.id)}
              className={`text-left bg-card border rounded-xl p-4 shadow-sm transition-all ${
                selected
                  ? "border-brand-500 ring-2 ring-brand-200"
                  : "border-border hover:border-brand-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{member.name}</p>
                  <p className="text-xs text-muted">{member.email}</p>
                </div>
                <span className="text-xs font-medium text-brand-700 bg-brand-50 px-2 py-1 rounded-full">
                  {ROLE_LABELS.SUPERVISOR}
                </span>
              </div>
              <p className="text-sm text-muted mt-3">
                Active maps:{" "}
                <span className="font-semibold text-slate-800">{active}</span>
              </p>
              {isMe && <p className="text-xs text-brand-600 mt-2 font-medium">You</p>}
            </button>
          );
        })}
      </div>

      {selectedMember && (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-slate-50">
            <h3 className="font-semibold">{selectedMember.name}&apos;s active maps</h3>
          </div>
          {mapsForMember.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted text-center">No active field maps</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2">Map</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Date & time</th>
                  <th className="px-4 py-2">Mapper</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {mapsForMember.map((map) => {
                  const status = getSupervisorFieldStatus(map);
                  return (
                    <tr key={map.id} className="border-b border-border/60">
                      <td className="px-4 py-3">
                        <Link
                          to={`/app/maps/${map.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {map.mapNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{map.client}</td>
                      <td className="px-4 py-3 text-muted">
                        {formatFieldDateTime(map.fieldDate)}
                      </td>
                      <td className="px-4 py-3">{map.mapperName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge
                          label={FIELD_WORK_STATUS_LABELS[status]}
                          tone={fieldWorkStatusTone(status)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {swapOpen && (
      <Modal onClose={() => setSwapOpen(false)} title="Call for a swap">
        <p className="text-sm text-muted mb-4">
          Leaving your shift? Move your maps to a teammate. Changes update immediately in Maps.
        </p>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
        )}
        <label className="block text-sm font-medium mb-1">Transfer to</label>
        <select
          value={swapTargetId}
          onChange={(e) => setSwapTargetId(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm mb-4"
        >
          {otherSupervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="text-sm font-medium mb-2">Your maps to transfer</p>
        <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
          {myActiveMaps.map((map) => (
            <label key={map.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedMapIds.has(map.id)}
                onChange={(e) => {
                  setSelectedMapIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(map.id);
                    else next.delete(map.id);
                    return next;
                  });
                }}
              />
              {map.mapNumber} — {map.client}
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setSwapOpen(false)}
            className="px-4 py-2 text-sm text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={confirmSwap}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Swapping…" : "Confirm swap"}
          </button>
        </div>
      </Modal>
      )}
    </section>
  );
}
