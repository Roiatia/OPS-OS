import type { RoleName, TeamMember, User } from "../types";

export const SUPERVISOR_ROLES: RoleName[] = ["SUPERVISOR", "SUPERVISOR_SHIFT_LEADER"];

export function isSupervisorRole(role: RoleName): boolean {
  return SUPERVISOR_ROLES.includes(role);
}

export function hasSupervisorRole(user: User | null | undefined): boolean {
  return user?.roles.some(isSupervisorRole) ?? false;
}

export function memberIsSupervisor(member: TeamMember): boolean {
  return member.roles.some((r) => isSupervisorRole(r.role));
}
