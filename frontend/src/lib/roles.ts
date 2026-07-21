import type { RoleName, TeamMember, User } from "../types";

export const SUPERVISOR_ROLES: RoleName[] = ["SUPERVISOR", "SUPERVISOR_SHIFT_LEADER"];
export const OPS_MANAGER_ROLES: RoleName[] = ["OPS_ADMIN", "OPS_MANAGER", "OPS_MANAGER_2"];

export function isSupervisorRole(role: RoleName): boolean {
  return SUPERVISOR_ROLES.includes(role);
}

export function isOpsManagerRole(role: RoleName): boolean {
  return OPS_MANAGER_ROLES.includes(role);
}

export function hasOpsManagerRole(user: User | null | undefined): boolean {
  return user?.roles.some(isOpsManagerRole) ?? false;
}

export function isShiftLeaderRole(role: RoleName): boolean {
  return role === "SUPERVISOR_SHIFT_LEADER";
}

export function hasSupervisorRole(user: User | null | undefined): boolean {
  return user?.roles.some(isSupervisorRole) ?? false;
}

export function hasShiftLeaderRole(user: User | null | undefined): boolean {
  return user?.roles.some(isShiftLeaderRole) ?? false;
}

export function memberIsSupervisor(member: TeamMember): boolean {
  return member.roles.some((r) => isSupervisorRole(r.role));
}

export function memberIsShiftLeader(member: { roles: { role: RoleName }[] }): boolean {
  return member.roles.some((r) => isShiftLeaderRole(r.role));
}

/** True when shiftStartedAt falls on the local calendar day */
export function isOnShiftToday(shiftStartedAt: string | Date | null | undefined): boolean {
  if (!shiftStartedAt) return false;
  const started = typeof shiftStartedAt === "string" ? new Date(shiftStartedAt) : shiftStartedAt;
  if (Number.isNaN(started.getTime())) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return started >= start && started <= end;
}
