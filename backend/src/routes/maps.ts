import { Router } from "express";
import { InspectorStatus, MapPhase, QaStatus, RoleName, TaskStatus } from "@prisma/client";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/auth.js";
import * as workflow from "../services/workflow.js";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const maps = await workflow.listMapsForUser((req as AuthedRequest).user);
    res.json(maps);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/history", requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN), async (req, res) => {
  try {
    const maps = await workflow.listHistoryMaps((req as AuthedRequest).user);
    res.json(maps);
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

router.post(
  "/shuffle-assign",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { mapIds, inspectorIds } = req.body as {
        mapIds?: string[];
        inspectorIds?: string[];
      };
      if (!mapIds?.length) {
        res.status(400).json({ error: "mapIds required" });
        return;
      }
      if (!inspectorIds?.length) {
        res.status(400).json({ error: "inspectorIds required" });
        return;
      }
      const result = await workflow.shuffleAssignInspectors(
        mapIds,
        inspectorIds,
        (req as AuthedRequest).user
      );
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.get("/team", requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN), async (_req, res) => {
  const team = await workflow.listTeamMembers();
  res.json(team);
});

router.post(
  "/",
  requireRoles(RoleName.OPS_ADMIN, RoleName.GRAPHIC_TEAM_LEADER),
  async (req, res) => {
    try {
      const map = await workflow.createMapFromJira(req.body, (req as AuthedRequest).user);
      res.status(201).json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.get("/:id", async (req, res) => {
  const map = await workflow.getMapForUser(req.params.id, (req as AuthedRequest).user);
  if (!map) {
    res.status(404).json({ error: "Map not found" });
    return;
  }
  res.json(map);
});

router.post(
  "/:id/assign",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { inspectorId, attachment } = req.body as {
        inspectorId?: string;
        attachment?: { fileName: string; mimeType: string; data: string };
      };
      if (!inspectorId) {
        res.status(400).json({ error: "inspectorId required" });
        return;
      }
      const map = await workflow.assignInspector(
        req.params.id,
        inspectorId,
        (req as AuthedRequest).user,
        attachment
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/assign-qa",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { qaId, attachment } = req.body as {
        qaId?: string;
        attachment?: { fileName: string; mimeType: string; data: string };
      };
      if (!qaId) {
        res.status(400).json({ error: "qaId required" });
        return;
      }
      const map = await workflow.assignQa(
        req.params.id,
        qaId,
        (req as AuthedRequest).user,
        attachment
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.patch(
  "/:id/due-date",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { dueDate } = req.body as { dueDate?: string | null };
      if (dueDate !== null && dueDate !== undefined && Number.isNaN(Date.parse(dueDate))) {
        res.status(400).json({ error: "Invalid dueDate" });
        return;
      }
      const map = await workflow.updateMapDueDate(
        req.params.id,
        dueDate ?? null,
        (req as AuthedRequest).user
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/cancel",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { note } = req.body as { note?: string };
      const map = await workflow.cancelMap(req.params.id, (req as AuthedRequest).user, note);
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.patch("/:id/inspector-status", requireRoles(RoleName.MAPPING_INSPECTOR), async (req, res) => {
  try {
    const { status, note } = req.body as { status?: InspectorStatus; note?: string };
    if (!status || !Object.values(InspectorStatus).includes(status)) {
      res.status(400).json({ error: "Valid status required: ACCEPTED, PROCESSING, DONE" });
      return;
    }
    const map = await workflow.updateInspectorStatus(
      req.params.id,
      status,
      (req as AuthedRequest).user,
      note
    );
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/:id/notes", async (req, res) => {
  try {
    const { body } = req.body as { body?: string };
    if (!body?.trim()) {
      res.status(400).json({ error: "body required" });
      return;
    }
    const user = (req as AuthedRequest).user;
    const existing = await workflow.getMapForUser(req.params.id, user);
    if (!existing) {
      res.status(404).json({ error: "Map not found" });
      return;
    }
    const map = await workflow.addMapNote(req.params.id, user.id, body.trim());
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/:id/upload-review", requireRoles(RoleName.GRAPHIC_QA, RoleName.OPS_ADMIN), async (req, res) => {
  try {
    const { approved, note } = req.body as { approved?: boolean; note?: string };
    if (typeof approved !== "boolean") {
      res.status(400).json({ error: "approved (boolean) required" });
      return;
    }
    const map = await workflow.qaUploadDecision(req.params.id, approved, (req as AuthedRequest).user, note);
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post(
  "/:id/field-complete",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.completeFieldWork(req.params.id, (req as AuthedRequest).user);
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post("/:id/qa-review", requireRoles(RoleName.GRAPHIC_QA, RoleName.OPS_ADMIN, RoleName.MAPPING_INSPECTOR), async (req, res) => {
  try {
    const { status, note } = req.body as { status?: "fix" | "fix_done" | "approved"; note?: string };
    if (!status) {
      res.status(400).json({ error: "status required: fix, fix_done, or approved" });
      return;
    }
    const user = (req as AuthedRequest).user;
    if (status === "fix_done" && !user.roles.includes(RoleName.MAPPING_INSPECTOR) && !user.roles.includes(RoleName.OPS_ADMIN)) {
      res.status(403).json({ error: "Only inspector can mark fix done" });
      return;
    }
    if ((status === "fix" || status === "approved") && !user.roles.includes(RoleName.GRAPHIC_QA) && !user.roles.includes(RoleName.OPS_ADMIN)) {
      res.status(403).json({ error: "Only QA can approve or request fix" });
      return;
    }
    const map = await workflow.qaPolishDecision(req.params.id, status, user, note);
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post(
  "/:id/tasks",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.GRAPHIC_QA, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { title, description, assignedToId, phase } = req.body as {
        title?: string;
        description?: string;
        assignedToId?: string;
        phase?: MapPhase;
      };
      if (!title) {
        res.status(400).json({ error: "title required" });
        return;
      }
      const task = await workflow.createTask(
        req.params.id,
        { title, description, assignedToId, phase: phase ?? MapPhase.PREP },
        (req as AuthedRequest).user
      );
      res.status(201).json(task);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.patch("/tasks/:taskId", async (req, res) => {
  try {
    const { status } = req.body as { status?: TaskStatus };
    if (!status || !Object.values(TaskStatus).includes(status)) {
      res.status(400).json({ error: "Valid task status required" });
      return;
    }
    const task = await workflow.updateTaskStatus(req.params.taskId, status, (req as AuthedRequest).user);
    res.json(task);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;
