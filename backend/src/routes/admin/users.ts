import { Router } from "express";
import { z } from "zod";
import { Permission, RoleName } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware, type AuthedRequest } from "../../middleware/auth.js";
import {
  requirePermissions,
  effectivePermissions,
  permissionsForRoles,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type PermissionOverride,
} from "../../domain/permissions.js";
import { ROLE_LABELS } from "../../lib/types.js";

const router = Router();

// Every admin route requires an authenticated user with USERS_MANAGE.
router.use(authMiddleware, requirePermissions(Permission.USERS_MANAGE));

const roleValues = Object.values(RoleName) as [RoleName, ...RoleName[]];
const permissionValues = Object.values(Permission) as [Permission, ...Permission[]];

const rolesSchema = z.object({
  roles: z.array(z.enum(roleValues)),
});

const permissionsSchema = z.object({
  grants: z.array(z.enum(permissionValues)).default([]),
  denies: z.array(z.enum(permissionValues)).default([]),
});

type UserWithAccess = {
  id: string;
  roles: { role: RoleName }[];
  permissionOverrides: { permission: Permission; granted: boolean }[];
};

function overridesOf(user: UserWithAccess): PermissionOverride[] {
  return user.permissionOverrides.map((o) => ({
    permission: o.permission,
    granted: o.granted,
  }));
}

function userHasUsersManage(
  roles: RoleName[],
  overrides: PermissionOverride[]
): boolean {
  return effectivePermissions(roles, overrides).includes(Permission.USERS_MANAGE);
}

/** Count users (other than excludeId) who effectively retain USERS_MANAGE. */
async function countOtherAdmins(excludeId: string): Promise<number> {
  const users = await prisma.user.findMany({
    include: { roles: true, permissionOverrides: true },
  });
  return users.filter(
    (u) =>
      u.id !== excludeId &&
      userHasUsersManage(
        u.roles.map((r) => r.role),
        overridesOf(u)
      )
  ).length;
}

function serializeUser(user: {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: { role: RoleName }[];
  permissionOverrides: { permission: Permission; granted: boolean }[];
}) {
  const roles = user.roles.map((r) => r.role);
  const overrides = user.permissionOverrides.map((o) => ({
    permission: o.permission,
    granted: o.granted,
  }));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    roles,
    rolePermissions: permissionsForRoles(roles),
    overrides,
    permissions: effectivePermissions(roles, overrides),
    pending: roles.length === 0,
  };
}

/** GET /api/admin/permissions — catalog for UI labels/grouping. */
router.get("/permissions", (_req, res) => {
  res.json({
    groups: PERMISSION_GROUPS.map((g) => ({
      group: g.group,
      permissions: g.permissions.map((p) => ({
        permission: p,
        label: PERMISSION_LABELS[p],
      })),
    })),
    roles: (Object.values(RoleName) as RoleName[]).map((r) => ({
      role: r,
      label: ROLE_LABELS[r] ?? r,
      permissions: permissionsForRoles([r]),
    })),
  });
});

/** GET /api/admin/users — all users with roles + effective permissions + pending flag. */
router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { roles: true, permissionOverrides: true },
    orderBy: { name: "asc" },
  });
  res.json(users.map(serializeUser));
});

/** PATCH /api/admin/users/:id/roles — set the user's roles. */
router.patch("/users/:id/roles", async (req, res) => {
  const parsed = rolesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid roles payload" });
    return;
  }
  const { id } = req.params;
  const nextRoles = [...new Set(parsed.data.roles)];

  const target = await prisma.user.findUnique({
    where: { id },
    include: { roles: true, permissionOverrides: true },
  });
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const actingUser = (req as unknown as AuthedRequest).user;
  const overrides = overridesOf(target);
  const willHaveUsersManage = userHasUsersManage(nextRoles, overrides);

  // Lockout guard: don't let an admin strip their own USERS_MANAGE.
  if (id === actingUser.id && !willHaveUsersManage) {
    res.status(400).json({ error: "You cannot remove your own admin access." });
    return;
  }

  // Lockout guard: always keep at least one user with USERS_MANAGE.
  if (!willHaveUsersManage) {
    const otherAdmins = await countOtherAdmins(id);
    if (otherAdmins === 0) {
      res.status(400).json({
        error: "At least one user must keep admin access (USERS_MANAGE).",
      });
      return;
    }
  }

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    ...(nextRoles.length > 0
      ? [
          prisma.userRole.createMany({
            data: nextRoles.map((role) => ({ userId: id, role })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { roles: true, permissionOverrides: true },
  });
  res.json(serializeUser(updated));
});

/** PATCH /api/admin/users/:id/permissions — set per-user grant/deny overrides (advanced tab). */
router.patch("/users/:id/permissions", async (req, res) => {
  const parsed = permissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid permissions payload" });
    return;
  }
  const { id } = req.params;
  const grants = [...new Set(parsed.data.grants)];
  const denies = [...new Set(parsed.data.denies)];

  // A permission cannot be both granted and denied.
  const conflict = grants.find((p) => denies.includes(p));
  if (conflict) {
    res.status(400).json({
      error: `Permission ${conflict} cannot be both granted and denied.`,
    });
    return;
  }

  const target = await prisma.user.findUnique({
    where: { id },
    include: { roles: true },
  });
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const nextOverrides: PermissionOverride[] = [
    ...grants.map((permission) => ({ permission, granted: true })),
    ...denies.map((permission) => ({ permission, granted: false })),
  ];
  const roles = target.roles.map((r) => r.role);
  const actingUser = (req as unknown as AuthedRequest).user;
  const willHaveUsersManage = userHasUsersManage(roles, nextOverrides);

  if (id === actingUser.id && !willHaveUsersManage) {
    res.status(400).json({ error: "You cannot remove your own admin access." });
    return;
  }
  if (!willHaveUsersManage) {
    const otherAdmins = await countOtherAdmins(id);
    if (otherAdmins === 0) {
      res.status(400).json({
        error: "At least one user must keep admin access (USERS_MANAGE).",
      });
      return;
    }
  }

  await prisma.$transaction([
    prisma.userPermission.deleteMany({ where: { userId: id } }),
    ...(nextOverrides.length > 0
      ? [
          prisma.userPermission.createMany({
            data: nextOverrides.map((o) => ({
              userId: id,
              permission: o.permission,
              granted: o.granted,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { roles: true, permissionOverrides: true },
  });
  res.json(serializeUser(updated));
});

export default router;
