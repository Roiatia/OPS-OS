import { describe, it, expect } from "vitest";
import { RoleName } from "@prisma/client";
import {
  isSupervisorRole,
  isOpsManagerRole,
  userHasSupervisorRole,
  userHasOpsManagerRole,
  userHasShiftLeaderRole,
  userIsShiftLeader,
  isSuperAdminRole,
  userHasSuperAdminRole,
  SUPER_ADMIN_ROLE_NAME,
} from "../roles.js";

describe("role predicates", () => {
  it("isSupervisorRole covers supervisor and shift leader", () => {
    expect(isSupervisorRole(RoleName.SUPERVISOR)).toBe(true);
    expect(isSupervisorRole(RoleName.SUPERVISOR_SHIFT_LEADER)).toBe(true);
    expect(isSupervisorRole(RoleName.MAPPING_INSPECTOR)).toBe(false);
  });

  it("isOpsManagerRole covers both OPS manager roles", () => {
    expect(isOpsManagerRole(RoleName.OPS_ADMIN)).toBe(true);
    expect(isOpsManagerRole(RoleName.OPS_MANAGER_2)).toBe(true);
    expect(isOpsManagerRole(RoleName.GRAPHIC_TEAM_LEADER)).toBe(false);
  });

  it("userHasSupervisorRole checks a flat role list", () => {
    expect(userHasSupervisorRole({ roles: [RoleName.SUPERVISOR] })).toBe(true);
    expect(userHasSupervisorRole({ roles: [RoleName.GRAPHIC_QA] })).toBe(false);
  });

  it("userHasOpsManagerRole checks a flat role list", () => {
    expect(userHasOpsManagerRole({ roles: [RoleName.OPS_MANAGER_2] })).toBe(true);
    expect(userHasOpsManagerRole({ roles: [RoleName.MAPPING_INSPECTOR] })).toBe(false);
  });

  it("shift-leader helpers accept their respective shapes", () => {
    expect(userHasShiftLeaderRole({ roles: [RoleName.SUPERVISOR_SHIFT_LEADER] })).toBe(true);
    expect(userHasShiftLeaderRole({ roles: [RoleName.SUPERVISOR] })).toBe(false);
    expect(userIsShiftLeader({ roles: [{ role: RoleName.SUPERVISOR_SHIFT_LEADER }] })).toBe(true);
    expect(userIsShiftLeader({ roles: [{ role: RoleName.SUPERVISOR }] })).toBe(false);
  });

  it("SUPER_ADMIN implicitly satisfies every capability check (all-access)", () => {
    const admin = { roles: [SUPER_ADMIN_ROLE_NAME] };
    expect(isSuperAdminRole(SUPER_ADMIN_ROLE_NAME)).toBe(true);
    expect(userHasSuperAdminRole(admin)).toBe(true);
    expect(userHasSupervisorRole(admin)).toBe(true);
    expect(userHasOpsManagerRole(admin)).toBe(true);
    expect(userHasShiftLeaderRole(admin)).toBe(true);
    expect(userIsShiftLeader({ roles: [{ role: SUPER_ADMIN_ROLE_NAME }] })).toBe(true);
  });

  it("non-admins are unaffected by the super-admin bypass", () => {
    expect(userHasSuperAdminRole({ roles: [RoleName.OPS_ADMIN] })).toBe(false);
    expect(userHasOpsManagerRole({ roles: [RoleName.MAPPING_INSPECTOR] })).toBe(false);
  });
});
