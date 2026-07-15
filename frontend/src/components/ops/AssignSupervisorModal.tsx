import { useMemo, useState } from "react";
import type { MapRecord, TeamMember } from "../../types";
import { memberIsSupervisor } from "../../lib/roles";
import { Modal } from "../leader/Modal";

interface Props {
  map: MapRecord;
  team: TeamMember[];
  maps: MapRecord[];
  loading: boolean;
  onClose: () => void;
  onAssign: (supervisorId: string) => void;
}

export function AssignSupervisorModal({ map, team, maps, loading, onClose, onAssign }: Props) {
  const supervisors = team.filter(memberIsSupervisor);

  const suggestedId = useMemo(() => {
    const loads = supervisors.map((s) => ({
      id: s.id,
      count: maps.filter((m) => m.phase === "FIELD" && m.assignedSupervisor?.id === s.id).length,
    }));
    loads.sort((a, b) => a.count - b.count);
    return map.assignedSupervisor?.id ?? loads[0]?.id ?? "";
  }, [supervisors, maps, map.assignedSupervisor?.id]);

  const [supervisorId, setSupervisorId] = useState(suggestedId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (supervisorId) onAssign(supervisorId);
  }

  return (
    <Modal title={`Assign — ${map.mapNumber}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted">
          Assign field support for {map.client}
          {map.area ? ` (${map.area})` : ""}.
        </p>

        <label className="block">
          <span className="text-sm font-medium">Team member</span>
          <select
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
            required
          >
            {supervisors.map((s) => {
              const active = maps.filter(
                (m) => m.phase === "FIELD" && m.assignedSupervisor?.id === s.id
              ).length;
              return (
                <option key={s.id} value={s.id}>
                  {s.name} ({active} active field map{active === 1 ? "" : "s"})
                </option>
              );
            })}
          </select>
        </label>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !supervisorId}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Assigning…" : "Assign"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
