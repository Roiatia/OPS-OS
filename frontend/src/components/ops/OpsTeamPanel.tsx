import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MapRecord, RoleName, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import { Badge } from "../Badge";
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
import type { OpsWorkloadAlert } from "../../lib/opsWorkload";
import { memberIsSupervisor, isSupervisorRole, SUPERVISOR_ROLES } from "../../lib/roles";

interface Props {
  team: TeamMember[];
  maps: MapRecord[];
  lightLoadAlerts?: OpsWorkloadAlert[];
}

type TeamTab = "all" | "supervisors" | "inspectors" | "qa";

const TAB_ROLES: Record<Exclude<TeamTab, "all">, RoleName> = {
  supervisors: "SUPERVISOR",
  inspectors: "MAPPING_INSPECTOR",
  qa: "GRAPHIC_QA",
};

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

export function OpsTeamPanel({ team, maps, lightLoadAlerts = [] }: Props) {
  const [tab, setTab] = useState<TeamTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const members = useMemo(() => {
    const fieldRoles: RoleName[] = [...SUPERVISOR_ROLES, "MAPPING_INSPECTOR", "GRAPHIC_QA"];
    let list = team.filter((m) => m.roles.some((r) => fieldRoles.includes(r.role)));
    if (tab !== "all") {
      if (tab === "supervisors") {
        list = list.filter(memberIsSupervisor);
      } else {
        const role = TAB_ROLES[tab];
        list = list.filter((m) => m.roles.some((r) => r.role === role));
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [team, tab]);

  const selected = members.find((m) => m.id === selectedId) ?? null;
  const selectedMaps = selected ? mapsForMember(selected, maps) : [];

  const tabs: { id: TeamTab; label: string }[] = [
    { id: "all", label: "Everyone" },
    { id: "supervisors", label: "Supervisors" },
    { id: "inspectors", label: "Inspectors" },
    { id: "qa", label: "QA" },
  ];

  return (
    <section className="space-y-6">
      <p className="text-sm text-muted">
        Full team under OPS — graphics and field. Tap a member to see their active maps.
      </p>

      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-6 w-full">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setSelectedId(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === t.id
                ? "bg-brand-600 text-white"
                : "bg-white border border-border text-slate-600 hover:bg-brand-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {members.map((member) => {
          const activeCount = activeCountForMember(member, maps);
          const primaryRole =
            member.roles.find((r) =>
              (["MAPPING_INSPECTOR", "GRAPHIC_QA"] as RoleName[]).includes(r.role) ||
              isSupervisorRole(r.role)
            )?.role ?? member.roles[0]?.role;
          const isSelected = selectedId === member.id;
          const lightLoad = activeCount <= 1;

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
              <p className="text-xs text-muted mt-1">
                {primaryRole ? ROLE_LABELS[primaryRole] : "Team"}
              </p>
              {lightLoad && (
                <p className="text-[10px] text-amber-700 mt-1 font-medium">Light load on shift</p>
              )}
            </button>
          );
        })}
      </div>

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

        </div>

        {lightLoadAlerts.length > 0 && (
          <aside className="w-full xl:w-72 shrink-0 xl:sticky xl:top-20">
            <div className="rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900 mb-3">
                Light load on shift
              </p>
              <p className="text-xs text-amber-800/90 mb-3 leading-relaxed">
                These team members have capacity — consider assigning more maps.
              </p>
              <ul className="space-y-2.5">
                {lightLoadAlerts.map((alert) => (
                  <li
                    key={alert.member.id}
                    className="rounded-lg border border-amber-200/80 bg-white px-3 py-2.5"
                  >
                    <div className="font-semibold text-sm text-slate-900">{alert.member.name}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {ROLE_LABELS[alert.role]} · {alert.activeCount} active map
                      {alert.activeCount !== 1 ? "s" : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
