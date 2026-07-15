import { Router } from "express";
import { RoleName } from "@prisma/client";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/auth.js";
import * as availability from "../services/availability.js";
import * as shiftPlan from "../services/shiftPlan.js";
import type { AvailabilityDayInput } from "../domain/availabilityRules.js";

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
      const { weekStart, fridayContract, sundayOk, hagimOk, days, shifts } = req.body as {
        weekStart?: string;
        fridayContract?: boolean;
        sundayOk?: boolean;
        hagimOk?: boolean;
        note?: string | null;
        days?: AvailabilityDayInput[];
        shifts?: AvailabilityDayInput[];
      };
      const payloadDays = days ?? shifts ?? [];
      const data = await availability.saveMyAvailability((req as AuthedRequest).user, {
        weekStart,
        fridayContract: Boolean(fridayContract),
        sundayOk: sundayOk === undefined ? undefined : Boolean(sundayOk),
        hagimOk: Boolean(hagimOk),
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

router.get(
  "/plan",
  requireRoles(RoleName.OPS_ADMIN, RoleName.OPS_MANAGER_2),
  async (req, res) => {
    try {
      const weekStart = (req.query.weekStart as string) || undefined;
      const data = await shiftPlan.getShiftPlan((req as AuthedRequest).user, weekStart);
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.put(
  "/plan",
  requireRoles(RoleName.OPS_ADMIN, RoleName.OPS_MANAGER_2),
  async (req, res) => {
    try {
      const { weekStart, assignments } = req.body as {
        weekStart?: string;
        assignments: { dayOfWeek: number; userId: string; userName: string; isShiftLeader: boolean }[];
      };
      const data = await shiftPlan.saveShiftPlan((req as AuthedRequest).user, {
        weekStart,
        assignments,
      });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/plan/auto",
  requireRoles(RoleName.OPS_ADMIN, RoleName.OPS_MANAGER_2),
  async (req, res) => {
    try {
      const body = req.body as {
        weekStart?: string;
        dayOfWeek?: number;
        lockedAssignments?: {
          dayOfWeek: number;
          userId: string;
          userName: string;
          isShiftLeader: boolean;
        }[];
        variant?: number;
        avoidUserIds?: string[];
      };
      const data = await shiftPlan.autoGenerateShiftPlan(
        (req as AuthedRequest).user,
        body.weekStart,
        {
          dayOfWeek: body.dayOfWeek,
          lockedAssignments: body.lockedAssignments,
          variant: body.variant,
          avoidUserIds: body.avoidUserIds,
        }
      );
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

/** Published schedule — supervisors, shift leaders, and OPS */
router.get(
  "/schedule",
  requireRoles(
    RoleName.OPS_ADMIN,
    RoleName.OPS_MANAGER_2,
    RoleName.SUPERVISOR,
    RoleName.SUPERVISOR_SHIFT_LEADER
  ),
  async (req, res) => {
    try {
      const weekStart = (req.query.weekStart as string) || undefined;
      const data = await shiftPlan.getPublishedSchedule((req as AuthedRequest).user, weekStart);
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

export default router;
