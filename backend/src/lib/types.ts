import { RoleName } from "@prisma/client";

export const ROLE_LABELS: Record<RoleName, string> = {
  GRAPHIC_TEAM_LEADER: "Field Ops Graphic Team Leader",
  MAPPING_INSPECTOR: "Mapping Inspector",
  GRAPHIC_QA: "Graphic QA",
  OPS_ADMIN: "OPS Admin",
};

export const PHASE_LABELS: Record<string, string> = {
  INTAKE: "Pre-upload · Awaiting assign",
  PREP: "Pre-upload · Inspector",
  UPLOAD_REVIEW: "Pre-upload · QA",
  FIELD: "Uploaded to dashboard",
  POLISH: "Polish · Inspector",
  QA_REVIEW: "Polish · QA",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: RoleName[];
};

export function hasRole(user: AuthUser, ...roles: RoleName[]) {
  return roles.some((r) => user.roles.includes(r));
}

export function isLeaderOrAdmin(user: AuthUser) {
  return hasRole(user, RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN);
}
