import {
  countInspectorActiveMaps,
  countQaActiveMaps,
  countSupervisorActiveMaps,
} from "./assignment";
import { memberIsSupervisor, isSupervisorRole, SUPERVISOR_ROLES } from "./roles";
import type { MapRecord, RoleName, TeamMember } from "../types";
import { ROLE_LABELS } from "../types";

const LIGHT_LOAD_THRESHOLD = 1;

export interface OpsWorkloadAlert {
  member: TeamMember;
  role: RoleName;
  activeCount: number;
  recentCompleted: MapRecord[];
}

function memberMaps(memberId: string, allMaps: MapRecord[]): MapRecord[] {
  return allMaps.filter(
    (m) =>
      m.assignedSupervisor?.id === memberId ||
      m.assignedInspector?.id === memberId ||
      m.assignedQa?.id === memberId
  );
}

function recentCompletedForMember(memberId: string, allMaps: MapRecord[]): MapRecord[] {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return memberMaps(memberId, allMaps)
    .filter((m) => {
      if (m.phase !== "APPROVED" && m.fieldWorkStatus !== "COMPLETED") return false;
      return new Date(m.updatedAt).getTime() >= cutoff;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
}

function activeCountForRole(member: TeamMember, maps: MapRecord[]): number {
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

function primaryRole(member: TeamMember): RoleName {
  const order: RoleName[] = [
    "SUPERVISOR_SHIFT_LEADER",
    "SUPERVISOR",
    "MAPPING_INSPECTOR",
    "GRAPHIC_QA",
    "GRAPHIC_TEAM_LEADER",
    "OPS_ADMIN",
    "OPS_MANAGER_2",
  ];
  for (const role of order) {
    if (member.roles.some((r) => r.role === role)) return role;
  }
  return member.roles[0]?.role ?? "SUPERVISOR";
}

/** Part-time staff on shift with little or no active work. */
export function getOpsWorkloadAlerts(
  team: TeamMember[],
  activeMaps: MapRecord[],
  allMaps: MapRecord[]
): OpsWorkloadAlert[] {
  const fieldRoles: RoleName[] = [...SUPERVISOR_ROLES, "MAPPING_INSPECTOR", "GRAPHIC_QA"];

  return team
    .filter((m) => m.roles.some((r) => fieldRoles.includes(r.role)))
    .map((member) => {
      const activeCount = activeCountForRole(member, activeMaps);
      const recentCompleted = recentCompletedForMember(member.id, allMaps);
      const onShift = activeCount > 0 || recentCompleted.length > 0;
      return { member, role: primaryRole(member), activeCount, recentCompleted, onShift };
    })
    .filter(({ onShift, activeCount }) => onShift && activeCount <= LIGHT_LOAD_THRESHOLD)
    .map(({ member, role, activeCount, recentCompleted }) => ({
      member,
      role,
      activeCount,
      recentCompleted,
    }))
    .sort(
      (a, b) =>
        a.activeCount - b.activeCount ||
        ROLE_LABELS[a.role].localeCompare(ROLE_LABELS[b.role])
    );
}

export function mapLightLoadHint(
  map: MapRecord,
  alerts: OpsWorkloadAlert[]
): string | null {
  const byId = new Map(alerts.map((a) => [a.member.id, a]));
  const assignee =
    map.assignedSupervisor ?? map.assignedInspector ?? map.assignedQa ?? null;
  if (!assignee) return null;
  const alert = byId.get(assignee.id);
  if (!alert) return null;
  return `${assignee.name} — light load (${alert.activeCount} active)`;
}

export function mapAssignLightLoadHint(
  map: MapRecord,
  alerts: OpsWorkloadAlert[]
): string | null {
  if (mapLightLoadHint(map, alerts)) return null;

  const needsSupervisor = map.phase === "FIELD" && !map.assignedSupervisor;
  const needsInspector = map.phase === "INTAKE";
  const needsQa = ["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase) && !map.assignedQa;

  const available = alerts.filter((a) => {
    if (needsSupervisor) return isSupervisorRole(a.role);
    if (needsInspector) return a.role === "MAPPING_INSPECTOR";
    if (needsQa) return a.role === "GRAPHIC_QA";
    return false;
  });

  if (available.length === 0) return null;
  return `Light load on shift — ${available.map((a) => a.member.name).join(", ")}`;
}
