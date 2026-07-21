import { RoleName } from "@prisma/client";

/** String literals so this works before/after Prisma client regen for new enum values */
export const SUPERVISOR_ROLE_NAMES = [
  RoleName.SUPERVISOR,
  "SUPERVISOR_SHIFT_LEADER",
].filter((role): role is RoleName => role != null && role !== undefined);

/** OPS manager roles — primary + secondary managers share the same access */
export const OPS_MANAGER_ROLE_NAMES = [
  RoleName.OPS_ADMIN,
  "OPS_MANAGER",
  "OPS_MANAGER_2",
].filter((role): role is RoleName => role != null && role !== undefined);

export function isSupervisorRole(role: RoleName | string): boolean {
  return SUPERVISOR_ROLE_NAMES.includes(role as RoleName);
}

export function isOpsManagerRole(role: RoleName | string): boolean {
  return OPS_MANAGER_ROLE_NAMES.includes(role as RoleName);
}

export function userHasSupervisorRole(user: { roles: RoleName[] }): boolean {
  return user.roles.some((r) => isSupervisorRole(r));
}

export function userHasOpsManagerRole(user: { roles: RoleName[] }): boolean {
  return user.roles.some((r) => isOpsManagerRole(r));
}

export function userIsShiftLeader(user: { roles: { role: RoleName }[] }): boolean {
  return user.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER);
}

export function userHasShiftLeaderRole(user: { roles: RoleName[] }): boolean {
  return user.roles.includes(RoleName.SUPERVISOR_SHIFT_LEADER);
}

export function supervisorRolesWhere() {
  return {
    roles: { some: { role: { in: [...SUPERVISOR_ROLE_NAMES] } } },
  };
}

export function opsManagerRolesWhere() {
  return {
    roles: { some: { role: { in: [...OPS_MANAGER_ROLE_NAMES] } } },
  };
}
