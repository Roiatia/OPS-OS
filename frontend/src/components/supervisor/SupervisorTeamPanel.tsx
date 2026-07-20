import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import type { MapRecord, TeamMember } from "../../types";
import {
  FIELD_WORK_STATUS_LABELS,
  fieldWorkStatusTone,
  formatFieldDateTime,
  getSupervisorFieldStatus,
} from "../../lib/supervisorDisplay";
import {
  isOnShiftToday,
  isSupervisorRole,
  memberIsShiftLeader,
} from "../../lib/roles";
import { formatShiftStart } from "../../lib/hubDisplay";
import { Badge } from "@/components/common/Badge";
import { SwapOffersPanel } from "./SwapOffersPanel";

interface Props {
  team: TeamMember[];
  teamFieldMaps: MapRecord[];
  myMaps: MapRecord[];
  onRefresh: () => void;
}

type TeamTab = "on_shift" | "all";

export function SupervisorTeamPanel({ team, teamFieldMaps, myMaps, onRefresh }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<TeamTab>("on_shift");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const supervisors = useMemo(
    () => team.filter((m) => m.roles.some((r) => isSupervisorRole(r.role))),
    [team]
  );

  const onShiftToday = useMemo(
    () =>
      supervisors
        .filter((m) => isOnShiftToday(m.shiftStartedAt))
        .sort((a, b) => {
          const aLeader = memberIsShiftLeader(a) ? 0 : 1;
          const bLeader = memberIsShiftLeader(b) ? 0 : 1;
          return (
            aLeader - bLeader ||
            (a.shiftStartedAt ?? "").localeCompare(b.shiftStartedAt ?? "") ||
            a.name.localeCompare(b.name)
          );
        }),
    [supervisors]
  );

  const allOps = useMemo(
    () =>
      [...supervisors].sort((a, b) => {
        const aOn = isOnShiftToday(a.shiftStartedAt) ? 0 : 1;
        const bOn = isOnShiftToday(b.shiftStartedAt) ? 0 : 1;
        return aOn - bOn || a.name.localeCompare(b.name);
      }),
    [supervisors]
  );

  const members = tab === "on_shift" ? onShiftToday : allOps;

  const mapsForMember = useMemo(() => {
    if (!selectedId) return [];
    return teamFieldMaps.filter(
      (m) =>
        m.assignedSupervisor?.id === selectedId &&
        getSupervisorFieldStatus(m) === "UNCOMPLETED"
    );
  }, [teamFieldMaps, selectedId]);

  const myActiveMaps = useMemo(
    () =>
      myMaps.filter(
        (m) =>
          getSupervisorFieldStatus(m) === "UNCOMPLETED" &&
          m.assignedSupervisor?.id === user?.id
      ),
    [myMaps, user?.id]
  );

  const otherActiveMaps = useMemo(
    () =>
      teamFieldMaps.filter(
        (m) =>
          m.assignedSupervisor &&
          m.assignedSupervisor.id !== user?.id &&
          getSupervisorFieldStatus(m) === "UNCOMPLETED"
      ),
    [teamFieldMaps, user?.id]
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

  const selectedMember = members.find((m) => m.id === selectedId) ?? null;

  const tabs: { id: TeamTab; label: string; count: number }[] = [
    { id: "on_shift", label: "On shift today", count: onShiftToday.length },
    { id: "all", label: "All supervisors", count: allOps.length },
  ];

  return (
    <section className="space-y-6">
      <SwapOffersPanel
        myActiveMaps={myActiveMaps}
        otherActiveMaps={otherActiveMaps}
        onChanged={onRefresh}
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setSelectedId(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 ${
              tab === t.id
                ? "bg-brand-600 text-white"
                : "bg-white border border-border text-slate-600 hover:bg-brand-50"
            }`}
          >
            {t.label}
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                tab === t.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "on_shift" && onShiftToday.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-slate-50 px-4 py-10 text-center">
          <p className="text-sm font-medium text-slate-800">No one on shift today yet</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => {
            const isMe = member.id === user?.id;
            const active = activeCountBySupervisor.get(member.id) ?? 0;
            const selected = selectedId === member.id;
            const isSl = memberIsShiftLeader(member);
            const onShift = isOnShiftToday(member.shiftStartedAt);

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
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      isSl
                        ? "text-violet-800 bg-violet-50"
                        : "text-brand-700 bg-brand-50"
                    }`}
                  >
                    {isSl ? "Shift leader" : "Supervisor"}
                  </span>
                </div>
                <p className="text-sm text-muted mt-3">
                  Active maps:{" "}
                  <span className="font-semibold text-slate-800">{active}</span>
                </p>
                {onShift && member.shiftStartedAt && (
                  <p className="text-xs text-emerald-700 mt-1 font-medium">
                    On shift · {formatShiftStart(member.shiftStartedAt)}
                  </p>
                )}
                {isMe && <p className="text-xs text-brand-600 mt-2 font-medium">You</p>}
              </button>
            );
          })}
        </div>
      )}

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
                        {map.swapBatchId && (
                          <span className="ml-2 text-[10px] font-semibold text-amber-700">
                            Swap open
                          </span>
                        )}
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
    </section>
  );
}
