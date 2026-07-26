import { Router } from "express";
import { RoleName } from "@prisma/client";
import {
  authMiddleware,
  requireSuperAdmin,
  getAuthUser,
} from "../middleware/auth.js";
import * as features from "../services/features.js";

const router = Router();

router.use(authMiddleware);

const ALL_ROLES = Object.values(RoleName) as RoleName[];
const filterRoles = (input: unknown): RoleName[] =>
  Array.isArray(input)
    ? (input.filter((r) => ALL_ROLES.includes(r as RoleName)) as RoleName[])
    : [];

/** Current user's resolved features — drives UI gating. Available to any user. */
router.get("/mine", async (req, res) => {
  try {
    const resolved = await features.resolveForUser(getAuthUser(req));
    res.json(resolved);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Let a user opt in/out of an experimental feature for themselves. */
router.post("/:key/mine", async (req, res) => {
  try {
    const user = getAuthUser(req);
    const enabled = (req.body as { enabled?: boolean | null }).enabled ?? null;
    // Self-service overrides are limited to experimental features.
    await features.setOverride(req.params.key, user.id, enabled, true);
    const resolved = await features.resolveForUser(user);
    const one = resolved.find((f) => f.key === req.params.key);
    if (!one) {
      res.status(404).json({ error: "Unknown feature" });
      return;
    }
    res.json(one);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ---- Admin-only management below ----
router.use(requireSuperAdmin);

router.get("/", async (_req, res) => {
  try {
    res.json(await features.listFlags());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.patch("/:key", async (req, res) => {
  try {
    const body = req.body as {
      enabled?: boolean;
      isExperimental?: boolean;
      rolloutRoles?: unknown;
      label?: string;
      description?: string | null;
    };
    const updated = await features.updateFlag(req.params.key, {
      enabled: body.enabled,
      isExperimental: body.isExperimental,
      rolloutRoles: body.rolloutRoles ? filterRoles(body.rolloutRoles) : undefined,
      label: body.label,
      description: body.description,
    });
    if (!updated) {
      res.status(404).json({ error: "Unknown feature" });
      return;
    }
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/:key/override", async (req, res) => {
  try {
    const body = req.body as { userId?: string; enabled?: boolean | null };
    if (!body.userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }
    await features.setOverride(req.params.key, body.userId, body.enabled ?? null);
    const [flag] = (await features.listFlags()).filter((f) => f.key === req.params.key);
    res.json(flag);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;
