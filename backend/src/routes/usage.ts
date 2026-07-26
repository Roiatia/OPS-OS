import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, getAuthUser } from "../middleware/auth.js";
import { hasAdminFeatureTables } from "../lib/schemaCapabilities.js";

const router = Router();
router.use(authMiddleware);

interface IncomingEvent {
  event?: unknown;
  section?: unknown;
  metadata?: unknown;
}

const MAX_BATCH = 50;
const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;

/** Ingest a batch of product-usage events for the authenticated user. */
router.post("/", async (req, res) => {
  try {
    // UsageEvent table arrives with the Super Admin metrics migration.
    if (!(await hasAdminFeatureTables())) {
      res.json({ recorded: 0, deferred: true });
      return;
    }

    const user = getAuthUser(req);
    const raw = (req.body as { events?: unknown }).events;
    const events = Array.isArray(raw) ? (raw as IncomingEvent[]).slice(0, MAX_BATCH) : [];
    const primaryRole = user.roles[0] ?? null;

    const rows: Prisma.UsageEventCreateManyInput[] = [];
    for (const e of events) {
      const event = asString(e.event);
      if (!event) continue;
      rows.push({
        userId: user.id,
        event,
        section: asString(e.section) ?? null,
        role: primaryRole ? String(primaryRole) : null,
        metadata:
          e.metadata && typeof e.metadata === "object"
            ? (e.metadata as Prisma.InputJsonValue)
            : undefined,
      });
    }

    if (rows.length === 0) {
      res.json({ recorded: 0 });
      return;
    }

    await prisma.usageEvent.createMany({ data: rows });
    res.json({ recorded: rows.length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
