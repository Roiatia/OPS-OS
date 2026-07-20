import { RoleName, Permission } from "@prisma/client";
import { isOpsManagerRole } from "../domain/roles.js";

export const ROLE_LABELS: Record<string, string> = {
  GRAPHIC_TEAM_LEADER: "Field Ops Graphic Team Leader",
  MAPPING_INSPECTOR: "Mapping Inspector",
  GRAPHIC_QA: "Graphic QA",
  SUPERVISOR: "Supervisor",
  SUPERVISOR_SHIFT_LEADER: "Supervisor Shift Leader",
  OPS_ADMIN: "OPS Manager",
  OPS_MANAGER_2: "OPS Manager 2",
};

export const PHASE_LABELS: Record<string, string> = {
  INTAKE: "Intake (from Jira)",
  PREP: "Initial Prep",
  UPLOAD_REVIEW: "Upload Approval (QA)",
  FIELD: "Field Work (Supervisors)",
  POLISH: "Polish",
  QA_REVIEW: "QA Review",
  APPROVED: "Approved",
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: RoleName[];
  /** Effective permissions, computed per-request in authMiddleware (not stored in the JWT). */
  permissions?: Permission[];
};

export function hasRole(user: AuthUser, ...roles: RoleName[]) {
  return roles.some((r) => user.roles.includes(r));
}

export function isOpsManager(user: AuthUser) {
  return user.roles.some((r) => isOpsManagerRole(r));
}

export function isLeaderOrAdmin(user: AuthUser) {
  return hasRole(user, RoleName.GRAPHIC_TEAM_LEADER) || isOpsManager(user);
}
