import { Permission, RoleName } from "@prisma/client";
import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "../lib/types.js";
import type { AuthedRequest } from "../middleware/auth.js";

/**
 * Source-of-truth mapping of each role to the permissions it grants.
 *
 * These mirror today's `requireRoles()` behavior (audited from
 * backend/src/routes/*.ts) so the new permission layer coexists with the
 * existing role checks without changing who can do what. The seed writes this
 * same map into the `RolePermission` table for the admin UI to display.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.GRAPHIC_TEAM_LEADER]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_ASSIGN_INSPECTOR,
    Permission.MAPS_ASSIGN_QA,
    Permission.MAPS_HISTORY,
    Permission.MAPS_IMPORT_CSV,
    Permission.TEAM_VIEW,
  ],
  [RoleName.MAPPING_INSPECTOR]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_INSPECTOR_STATUS,
  ],
  [RoleName.GRAPHIC_QA]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_QA_REVIEW,
    Permission.MAPS_UPLOAD_REVIEW,
  ],
  [RoleName.SUPERVISOR]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_FIELD_UPDATE,
    Permission.MAPS_HUB_VIEW,
    Permission.TEAM_VIEW,
    Permission.AVAILABILITY_VIEW,
  ],
  [RoleName.SUPERVISOR_SHIFT_LEADER]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_FIELD_UPDATE,
    Permission.MAPS_HUB_VIEW,
    Permission.MAPS_HUB_MANAGE,
    Permission.TEAM_VIEW,
    Permission.AVAILABILITY_VIEW,
  ],
  [RoleName.OPS_ADMIN]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_ASSIGN_INSPECTOR,
    Permission.MAPS_ASSIGN_QA,
    Permission.MAPS_INSPECTOR_STATUS,
    Permission.MAPS_QA_REVIEW,
    Permission.MAPS_UPLOAD_REVIEW,
    Permission.MAPS_FIELD_UPDATE,
    Permission.MAPS_HUB_VIEW,
    Permission.MAPS_HUB_MANAGE,
    Permission.MAPS_HISTORY,
    Permission.MAPS_IMPORT_CSV,
    Permission.MAPS_SYNC_SPREADSHEET,
    Permission.TEAM_VIEW,
    Permission.REPORTS_VIEW,
    Permission.AVAILABILITY_VIEW,
    Permission.AVAILABILITY_MANAGE,
    Permission.SHIFT_PLAN_MANAGE,
    Permission.USERS_MANAGE,
    Permission.ROLES_MANAGE,
  ],
  // OPS_MANAGER_2 mirrors OPS_ADMIN (same access, matching expandAllowedRoles).
  [RoleName.OPS_MANAGER_2]: [
    Permission.MAPS_VIEW,
    Permission.MAPS_ASSIGN_INSPECTOR,
    Permission.MAPS_ASSIGN_QA,
    Permission.MAPS_INSPECTOR_STATUS,
    Permission.MAPS_QA_REVIEW,
    Permission.MAPS_UPLOAD_REVIEW,
    Permission.MAPS_FIELD_UPDATE,
    Permission.MAPS_HUB_VIEW,
    Permission.MAPS_HUB_MANAGE,
    Permission.MAPS_HISTORY,
    Permission.MAPS_IMPORT_CSV,
    Permission.MAPS_SYNC_SPREADSHEET,
    Permission.TEAM_VIEW,
    Permission.REPORTS_VIEW,
    Permission.AVAILABILITY_VIEW,
    Permission.AVAILABILITY_MANAGE,
    Permission.SHIFT_PLAN_MANAGE,
    Permission.USERS_MANAGE,
    Permission.ROLES_MANAGE,
  ],
};

/** Human-readable label for each permission, for the admin UI. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.MAPS_VIEW]: "View maps",
  [Permission.MAPS_ASSIGN_INSPECTOR]: "Assign inspectors",
  [Permission.MAPS_ASSIGN_QA]: "Assign QA",
  [Permission.MAPS_INSPECTOR_STATUS]: "Update inspector status",
  [Permission.MAPS_QA_REVIEW]: "QA review",
  [Permission.MAPS_UPLOAD_REVIEW]: "Upload approval",
  [Permission.MAPS_FIELD_UPDATE]: "Field / supervisor updates",
  [Permission.MAPS_HUB_VIEW]: "View hub",
  [Permission.MAPS_HUB_MANAGE]: "Manage hub",
  [Permission.MAPS_HISTORY]: "View history",
  [Permission.MAPS_IMPORT_CSV]: "Import CSV",
  [Permission.MAPS_SYNC_SPREADSHEET]: "Sync spreadsheet",
  [Permission.TEAM_VIEW]: "View team",
  [Permission.REPORTS_VIEW]: "View reports",
  [Permission.AVAILABILITY_VIEW]: "Submit availability",
  [Permission.AVAILABILITY_MANAGE]: "Manage availability",
  [Permission.SHIFT_PLAN_MANAGE]: "Manage shift plan",
  [Permission.USERS_MANAGE]: "Manage users",
  [Permission.ROLES_MANAGE]: "Manage roles",
};

/** Grouped catalog of every permission, ordered for display in the admin UI. */
export const PERMISSION_GROUPS: { group: string; permissions: Permission[] }[] = [
  {
    group: "Maps & workflow",
    permissions: [
      Permission.MAPS_VIEW,
      Permission.MAPS_ASSIGN_INSPECTOR,
      Permission.MAPS_ASSIGN_QA,
      Permission.MAPS_INSPECTOR_STATUS,
      Permission.MAPS_QA_REVIEW,
      Permission.MAPS_UPLOAD_REVIEW,
      Permission.MAPS_FIELD_UPDATE,
      Permission.MAPS_HUB_VIEW,
      Permission.MAPS_HUB_MANAGE,
      Permission.MAPS_HISTORY,
      Permission.MAPS_IMPORT_CSV,
      Permission.MAPS_SYNC_SPREADSHEET,
    ],
  },
  {
    group: "Team & ops",
    permissions: [
      Permission.TEAM_VIEW,
      Permission.REPORTS_VIEW,
      Permission.AVAILABILITY_VIEW,
      Permission.AVAILABILITY_MANAGE,
      Permission.SHIFT_PLAN_MANAGE,
    ],
  },
  {
    group: "Admin",
    permissions: [Permission.USERS_MANAGE, Permission.ROLES_MANAGE],
  },
];

/** Flat list of all permissions in catalog order. */
export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(
  (g) => g.permissions
);

/** All permissions granted by the union of the given roles. */
export function permissionsForRoles(roles: RoleName[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) set.add(perm);
  }
  return [...set];
}

export type PermissionOverride = { permission: Permission; granted: boolean };

/**
 * Effective permissions = union(role permissions) ∪ granted overrides − denied overrides.
 */
export function effectivePermissions(
  roles: RoleName[],
  overrides: PermissionOverride[] = []
): Permission[] {
  const set = new Set<Permission>(permissionsForRoles(roles));
  for (const o of overrides) {
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return [...set];
}

/** True when the user holds every one of the given permissions. */
export function hasPermission(user: AuthUser, ...perms: Permission[]): boolean {
  const held = user.permissions ?? [];
  return perms.every((p) => held.includes(p));
}

/** True when the user holds at least one of the given permissions. */
export function hasAnyPermission(user: AuthUser, ...perms: Permission[]): boolean {
  const held = user.permissions ?? [];
  return perms.some((p) => held.includes(p));
}

/**
 * Express middleware guarding a route by permission. Requires ALL listed
 * permissions. Relies on authMiddleware having populated req.user.permissions.
 */
export function requirePermissions(...perms: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user || !hasPermission(user, ...perms)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
