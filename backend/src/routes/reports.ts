import { Router } from "express";
import { RoleName } from "@prisma/client";
import { authMiddleware, requireRoles } from "../middleware/auth.js";
import * as dailyReport from "../services/dailyReport.js";

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(RoleName.OPS_ADMIN));

router.get("/", async (req, res) => {
  try {
    const query = (req.query.q as string | undefined)?.trim();
    const reports = await dailyReport.listOpsDailyReports(query);
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const report = await dailyReport.getOpsDailyReport(req.params.id);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
