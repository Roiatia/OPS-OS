import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MapRecord, RoleName, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import { Badge } from "@/components/common/Badge";
import {
  countInspectorActiveMaps,
  countQaActiveMaps,
  countSupervisorActiveMaps,
} from "../../lib/assignment";
import { getOpsPipelineLabel, opsStatusTone } from "../../lib/opsDisplay";
import {
  FIELD_WORK_STATUS_LABELS,
  formatFieldDateTime,
  getSupervisorFieldStatus,
  fieldWorkStatusTone,
} from "../../lib/supervisorDisplay";
import {
  memberIsSupervisor,
  memberIsShiftLeader,
  isSupervisorRole,
  isOnShiftToday,
} from "../../lib/roles";
import { formatShiftStart } from "../../lib/hubDisplay";

interface Props {
  team: TeamMember[];
  maps: MapRecord[];
}

type TeamTab = "on_shift" | "graphics" | "all_ops";

function activeCountForMember(member: TeamMember, maps: MapRecord[]): number {
  if (memberIsSupervisor(member)) {
    return countSupervisorActiveMaps(maps, member.id);
  }
  if (member.roles.some((r) => r.role === "MAPPING_INSPECTOR")) {
    return countInspectorActiveMaps(maps, member.id);
  }
  if (member.roles.some((r) => r.role === "GRAPHIC_QA")) {
    return countQaActiveMaps(maps, member.id);
  }
  return 0;
}

function mapsForMember(member: TeamMember, maps: MapRecord[]): MapRecord[] {
  return maps.filter(
    (m) =>
      !["APPROVED", "CANCELLED"].includes(m.phase) &&
      (m.assignedSupervisor?.id === member.id ||
        m.assignedInspector?.id === member.id ||
        m.assignedQa?.id === member.id)
  );
}

function primaryRoleLabel(member: TeamMember): string {
  if (memberIsShiftLeader(member)) return ROLE_LABELS.SUPERVISOR_SHIFT_LEADER;
  const primaryRole =
    member.roles.find((r) =>
      (["MAPPING_INSPECTOR", "GRAPHIC_QA"] as RoleName[]).includes(r.role) ||
      isSupervisorRole(r.role)
    )?.role ?? member.roles[0]?.role;
  return primaryRole ? ROLE_LABELS[primaryRole] : "Team";
}

export function OpsTeamPanel({ team, maps }: Props) {
  const [tab, setTab] = useState<TeamTab>("on_shift");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onShiftToday = useMemo(
    () =>
      team
        .filter((m) => memberIsSupervisor(m) && isOnShiftToday(m.shiftStartedAt))
        .sort((a, b) => {
          const aLeader = memberIsShiftLeader(a) ? 0 : 1;
          const bLeader = memberIsShiftLeader(b) ? 0 : 1;
          return (
            aLeader - bLeader ||
            (a.shiftStartedAt ?? "").localeCompare(b.shiftStartedAt ?? "") ||
            a.name.localeCompare(b.name)
          );
        }),
    [team]
  );

  const graphics = useMemo(
    () =>
      team
        .filter((m) =>
          m.roles.some((r) =>
            (["MAPPING_INSPECTOR", "GRAPHIC_QA", "GRAPHIC_TEAM_LEADER"] as RoleName[]).includes(
              r.role
            )
          )
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [team]
  );

  const allOps = useMemo(
    () =>
      team
        .filter(memberIsSupervisor)
        .sort((a, b) => {
          const aOn = isOnShiftToday(a.shiftStartedAt) ? 0 : 1;
          const bOn = isOnShiftToday(b.shiftStartedAt) ? 0 : 1;
          return aOn - bOn || a.name.localeCompare(b.name);
        }),
    [team]
  );

  // Precompute each member's active-map count once per team/maps change instead
  // of rescanning all maps for every rendered card.
  const activeCountByMember = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of team) counts.set(member.id, activeCountForMember(member, maps));
    return counts;
  }, [team, maps]);

  const members =
    tab === "on_shift" ? onShiftToday : tab === "graphics" ? graphics : allOps;

  const selected = members.find((m) => m.id === selectedId) ?? null;
  const selectedMaps = selected ? mapsForMember(selected, maps) : [];

  const tabs: { id: TeamTab; label: string; count: number }[] = [
    { id: "on_shift", label: "On shift today", count: onShiftToday.length },
    { id: "graphics", label: "Graphics", count: graphics.length },
    { id: "all_ops", label: "All supervisors", count: allOps.length },
  ];

  return (
    <section className="space-y-6">
      <p className="text-sm text-muted">
        Field ops is part-time — see who is working this shift. Shift leaders work maps like
        supervisors and also check supervisor work. Graphics team is under OPS too.
      </p>

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
              className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${
                tab === t.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "on_shift" && members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-slate-50/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-800">No one on shift today yet</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            When OPS schedules supervisors for the day and they clock in (or get their first map),
            they appear here and on the Hub.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {members.map((member) => {
            const activeCount = activeCountByMember.get(member.id) ?? 0;
            const isSelected = selectedId === member.id;
            const onShift = isOnShiftToday(member.shiftStartedAt);
            const lightLoad = memberIsSupervisor(member) && onShift && activeCount <= 1;
            const shiftLeader = memberIsShiftLeader(member);

            return (
              <button
                key={member.id}
                type="button"
                onClick={() => setSelectedId(isSelected ? null : member.id)}
                className={`text-left rounded-xl border p-4 transition-all ${
                  isSelected
                    ? "border-brand-500 bg-brand-50 shadow-sm"
                    : lightLoad
                      ? "border-amber-200 bg-amber-50/40 hover:border-amber-300"
                      : "border-border bg-white hover:border-brand-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{member.name}</span>
                  <span
                    className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full ${
                      lightLoad ? "bg-amber-200 text-amber-900" : "bg-brand-100 text-brand-800"
                    }`}
                  >
                    {activeCount}
                  </span>
                </div>
                <p className="text-xs text-muted mt-1">{primaryRoleLabel(member)}</p>
                {shiftLeader && (
                  <p className="text-[10px] text-brand-700 mt-1 font-medium">
                    Shift leader · checks supervisor work
                  </p>
                )}
                {memberIsSupervisor(member) && onShift && (
                  <p className="text-[10px] text-muted mt-1">
                    On shift · {formatShiftStart(member.shiftStartedAt)}
                  </p>
                )}
                {memberIsSupervisor(member) && !onShift && tab === "all_ops" && (
                  <p className="text-[10px] text-slate-400 mt-1">Not on shift today</p>
                )}
                {lightLoad && (
                  <p className="text-[10px] text-amber-700 mt-1 font-medium">Light load on shift</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-slate-50">
            <h3 className="font-semibold">{selected.name} — active maps</h3>
          </div>
          {selectedMaps.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted text-sm">
              No active maps — may be between jobs on shift.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-semibold">Map</th>
                  <th className="px-4 py-2 font-semibold">Client</th>
                  <th className="px-4 py-2 font-semibold">Pipeline</th>
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {selectedMaps.map((map) => {
                  const fieldStatus = getSupervisorFieldStatus(map);
                  return (
                    <tr key={map.id}>
                      <td className="px-4 py-3 font-medium">
                        <Link to={`/app/maps/${map.id}`} className="text-brand-600 hover:underline">
                          {map.mapNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{map.client}</td>
                      <td className="px-4 py-3">
                        <Badge label={getOpsPipelineLabel(map)} tone={opsStatusTone(map)} />
                      </td>
                      <td className="px-4 py-3 text-muted text-xs">
                        {map.phase === "FIELD" ? formatFieldDateTime(map.fieldDate) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {map.phase === "FIELD" ? (
                          <Badge
                            label={FIELD_WORK_STATUS_LABELS[fieldStatus]}
                            tone={fieldWorkStatusTone(fieldStatus)}
                          />
                        ) : (
                          <Badge label={getOpsPipelineLabel(map)} tone={opsStatusTone(map)} />
                        )}
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
