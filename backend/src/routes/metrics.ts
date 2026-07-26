import { Router } from "express";
import { authMiddleware, requireSuperAdmin } from "../middleware/auth.js";
import * as metrics from "../services/metrics.js";
import { hasAdminFeatureTables } from "../lib/schemaCapabilities.js";

const router = Router();
router.use(authMiddleware);
router.use(requireSuperAdmin);

const MIGRATION_HINT =
  "Admin metrics require migration 20260722161000_admin_features_metrics";

router.get("/", async (req, res) => {
  try {
    if (!(await hasAdminFeatureTables())) {
      res.status(503).json({ error: MIGRATION_HINT });
      return;
    }
    const days = Number.parseInt(String(req.query.days ?? ""), 10);
    const data = await metrics.getUsageMetrics(Number.isFinite(days) ? days : 30);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/audit", async (req, res) => {
  try {
    // Audit reads MapEvent (always present) — do not gate on FeatureFlag migration.
    const q = (req.query.q as string | undefined)?.trim();
    const data = await metrics.getAuditLog(q);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
