import { RoleName } from "@prisma/client";

/** String literals so this works before/after Prisma client regen for new enum values */
export const SUPERVISOR_ROLE_NAMES = [
  RoleName.SUPERVISOR,
  "SUPERVISOR_SHIFT_LEADER",
].filter((role): role is RoleName => role != null && role !== undefined);

export function isSupervisorRole(role: RoleName | string): boolean {
  return SUPERVISOR_ROLE_NAMES.includes(role as RoleName);
}

export function userHasSupervisorRole(user: { roles: RoleName[] }): boolean {
  return user.roles.some((r) => isSupervisorRole(r));
}

export function supervisorRolesWhere() {
  return {
    roles: { some: { role: { in: [...SUPERVISOR_ROLE_NAMES] } } },
  };
}
