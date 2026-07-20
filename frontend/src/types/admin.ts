import type { RoleName } from "./core";
import type { Permission } from "../lib/permissions";

export interface PermissionOverride {
  permission: Permission;
  granted: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: RoleName[];
  /** Permissions granted purely by the user's roles (before overrides). */
  rolePermissions: Permission[];
  /** Per-user grant/deny overrides. */
  overrides: PermissionOverride[];
  /** Effective permissions = rolePermissions ∪ grants − denies. */
  permissions: Permission[];
  /** True when the user has zero roles (awaiting admin assignment). */
  pending: boolean;
}

export interface PermissionCatalog {
  groups: {
    group: string;
    permissions: { permission: Permission; label: string }[];
  }[];
  roles: {
    role: RoleName;
    label: string;
    permissions: Permission[];
  }[];
}
