/**
 * Frontend mirror of the backend Permission enum (backend/src/domain/permissions.ts).
 * Keep in sync with the Prisma `Permission` enum.
 */
export type Permission =
  // Maps / workflow
  | "MAPS_VIEW"
  | "MAPS_ASSIGN_INSPECTOR"
  | "MAPS_ASSIGN_QA"
  | "MAPS_INSPECTOR_STATUS"
  | "MAPS_QA_REVIEW"
  | "MAPS_UPLOAD_REVIEW"
  | "MAPS_FIELD_UPDATE"
  | "MAPS_HUB_VIEW"
  | "MAPS_HUB_MANAGE"
  | "MAPS_HISTORY"
  | "MAPS_IMPORT_CSV"
  | "MAPS_SYNC_SPREADSHEET"
  // Team / ops
  | "TEAM_VIEW"
  | "REPORTS_VIEW"
  | "AVAILABILITY_VIEW"
  | "AVAILABILITY_MANAGE"
  | "SHIFT_PLAN_MANAGE"
  // Admin
  | "USERS_MANAGE"
  | "ROLES_MANAGE";

export const PERMISSION_LABELS: Record<Permission, string> = {
  MAPS_VIEW: "View maps",
  MAPS_ASSIGN_INSPECTOR: "Assign inspectors",
  MAPS_ASSIGN_QA: "Assign QA",
  MAPS_INSPECTOR_STATUS: "Update inspector status",
  MAPS_QA_REVIEW: "QA review",
  MAPS_UPLOAD_REVIEW: "Upload approval",
  MAPS_FIELD_UPDATE: "Field / supervisor updates",
  MAPS_HUB_VIEW: "View hub",
  MAPS_HUB_MANAGE: "Manage hub",
  MAPS_HISTORY: "View history",
  MAPS_IMPORT_CSV: "Import CSV",
  MAPS_SYNC_SPREADSHEET: "Sync spreadsheet",
  TEAM_VIEW: "View team",
  REPORTS_VIEW: "View reports",
  AVAILABILITY_VIEW: "Submit availability",
  AVAILABILITY_MANAGE: "Manage availability",
  SHIFT_PLAN_MANAGE: "Manage shift plan",
  USERS_MANAGE: "Manage users",
  ROLES_MANAGE: "Manage roles",
};

export const PERMISSION_GROUPS: { group: string; permissions: Permission[] }[] = [
  {
    group: "Maps & workflow",
    permissions: [
      "MAPS_VIEW",
      "MAPS_ASSIGN_INSPECTOR",
      "MAPS_ASSIGN_QA",
      "MAPS_INSPECTOR_STATUS",
      "MAPS_QA_REVIEW",
      "MAPS_UPLOAD_REVIEW",
      "MAPS_FIELD_UPDATE",
      "MAPS_HUB_VIEW",
      "MAPS_HUB_MANAGE",
      "MAPS_HISTORY",
      "MAPS_IMPORT_CSV",
      "MAPS_SYNC_SPREADSHEET",
    ],
  },
  {
    group: "Team & ops",
    permissions: [
      "TEAM_VIEW",
      "REPORTS_VIEW",
      "AVAILABILITY_VIEW",
      "AVAILABILITY_MANAGE",
      "SHIFT_PLAN_MANAGE",
    ],
  },
  {
    group: "Admin",
    permissions: ["USERS_MANAGE", "ROLES_MANAGE"],
  },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(
  (g) => g.permissions
);

export function permissionLabel(permission: Permission): string {
  return PERMISSION_LABELS[permission] ?? permission;
}
