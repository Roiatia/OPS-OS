import { Router } from "express";
import { RoleName } from "@prisma/client";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/auth.js";
import * as availability from "../services/availability.js";
import type { AvailabilityDayInput } from "../lib/availabilityRules.js";

const router = Router();
router.use(authMiddleware);

router.get(
  "/mine",
  requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER),
  async (req, res) => {
    try {
      const weekStart = (req.query.weekStart as string) || undefined;
      const data = await availability.getMyAvailability((req as AuthedRequest).user, weekStart);
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.put(
  "/mine",
  requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER),
  async (req, res) => {
    try {
      const { weekStart, fridayContract, days } = req.body as {
        weekStart?: string;
        fridayContract?: boolean;
        note?: string | null;
        days?: AvailabilityDayInput[];
        shifts?: AvailabilityDayInput[];
      };
      const payloadDays = days ?? shifts ?? [];
      const data = await availability.saveMyAvailability((req as AuthedRequest).user, {
        weekStart,
        fridayContract: Boolean(fridayContract),
        days: payloadDays,
      });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post("/validate", authMiddleware, async (req, res) => {
  try {
    const { fridayContract, days, shifts } = req.body as {
      fridayContract?: boolean;
      days?: AvailabilityDayInput[];
      shifts?: AvailabilityDayInput[];
    };
    const errors = await availability.validateAvailabilityDraft(
      days ?? shifts ?? [],
      Boolean(fridayContract)
    );
    res.json({ ok: errors.length === 0, errors });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get(
  "/roster",
  requireRoles(RoleName.OPS_ADMIN, RoleName.OPS_MANAGER_2),
  async (req, res) => {
    try {
      const weekStart = (req.query.weekStart as string) || undefined;
      const data = await availability.getAvailabilityRoster(
        (req as AuthedRequest).user,
        weekStart
      );
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

export default router;
