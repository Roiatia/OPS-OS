import { Router } from "express";
import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  authMiddleware,
  requireSuperAdmin,
  invalidateUserCache,
  getAuthUser,
} from "../middleware/auth.js";
import { ROLE_LABELS } from "../lib/types.js";
import {
  getUserActiveMap,
  hasUserActiveColumn,
  setUserActive,
} from "../lib/schemaCapabilities.js";

const router = Router();

router.use(authMiddleware);
router.use(requireSuperAdmin);

const ALL_ROLES = Object.values(RoleName) as RoleName[];

function isValidRole(role: unknown): role is RoleName {
  return typeof role === "string" && ALL_ROLES.includes(role as RoleName);
}

function serialize(
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    createdAt: Date;
    roles: { role: RoleName }[];
  },
  active: boolean
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    active,
    createdAt: user.createdAt,
    roles: user.roles.map((r) => r.role),
  };
}

/** Assignable roles (id + label) for the create/edit UI. */
router.get("/roles", (_req, res) => {
  res.json(ALL_ROLES.map((role) => ({ role, label: ROLE_LABELS[role] ?? role })));
});

/** List all users with their roles and active status. */
router.get("/", async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { roles: true },
      orderBy: { name: "asc" },
    });
    const activeById = await getUserActiveMap(users.map((u) => u.id));
    const sorted = [...users].sort((a, b) => {
      const aActive = activeById.get(a.id) !== false ? 1 : 0;
      const bActive = activeById.get(b.id) !== false ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return a.name.localeCompare(b.name);
    });
    res.json(sorted.map((u) => serialize(u, activeById.get(u.id) !== false)));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Pre-provision a user: they activate by signing in with the matching email. */
router.post("/", async (req, res) => {
  try {
    const body = req.body as { email?: string; name?: string; roles?: unknown };
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const roles = Array.isArray(body.roles) ? body.roles.filter(isValidRole) : [];

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (roles.length === 0) {
      res.status(400).json({ error: "At least one role is required" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        roles: { create: roles.map((role) => ({ role })) },
      },
      include: { roles: true },
    });

    res.status(201).json(serialize(user, true));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Replace a user's roles. */
router.patch("/:id/roles", async (req, res) => {
  try {
    const targetId = req.params.id;
    const roles = Array.isArray((req.body as { roles?: unknown }).roles)
      ? ((req.body as { roles: unknown[] }).roles.filter(isValidRole) as RoleName[])
      : [];

    if (roles.length === 0) {
      res.status(400).json({ error: "At least one role is required" });
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      include: { roles: true },
    });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Guard against self-lockout: an admin cannot strip their own admin role.
    const actor = getAuthUser(req);
    if (
      actor.id === targetId &&
      target.roles.some((r) => r.role === RoleName.SUPER_ADMIN) &&
      !roles.includes(RoleName.SUPER_ADMIN)
    ) {
      res.status(400).json({ error: "You cannot remove your own administrator role" });
      return;
    }

    const uniqueRoles = [...new Set(roles)];
    const updated = await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: targetId } });
      await tx.userRole.createMany({
        data: uniqueRoles.map((role) => ({ userId: targetId, role })),
      });
      return tx.user.findUnique({ where: { id: targetId }, include: { roles: true } });
    });

    invalidateUserCache(targetId);
    const activeById = await getUserActiveMap([targetId]);
    res.json(serialize(updated!, activeById.get(targetId) !== false));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Enable or disable (soft-delete) a user account. */
router.patch("/:id/active", async (req, res) => {
  try {
    if (!(await hasUserActiveColumn())) {
      res.status(503).json({
        error:
          "User soft-disable requires migration 20260722161000_admin_features_metrics (User.active column)",
      });
      return;
    }

    const targetId = req.params.id;
    const active = (req.body as { active?: unknown }).active;
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "`active` must be a boolean" });
      return;
    }

    const actor = getAuthUser(req);
    if (actor.id === targetId && active === false) {
      res.status(400).json({ error: "You cannot disable your own account" });
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      include: { roles: true },
    });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const ok = await setUserActive(targetId, active);
    if (!ok) {
      res.status(500).json({ error: "Failed to update active status" });
      return;
    }

    invalidateUserCache(targetId);
    res.json(serialize(target, active));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
