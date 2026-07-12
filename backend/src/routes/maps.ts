import { Router } from "express";
import { MapPhase, MapStatus, RoleName, TaskStatus } from "@prisma/client";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/auth.js";
import * as workflow from "../services/workflow.js";

const router = Router();
router.use(authMiddleware);

router.post(
  "/import-csv/preview",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { csv } = req.body as { csv?: string };
      if (!csv?.trim()) {
        res.status(400).json({ error: "csv text required" });
        return;
      }
      const { previewSamsClubCsv } = await import("../services/csvImport.js");
      const preview = await previewSamsClubCsv(csv);
      res.json(preview);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/import-csv",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { csv, clearExisting, defaultClient } = req.body as {
        csv?: string;
        clearExisting?: boolean;
        defaultClient?: string;
      };
      if (!csv?.trim()) {
        res.status(400).json({ error: "csv text required" });
        return;
      }
      const { importSamsClubCsv } = await import("../services/csvImport.js");
      const result = await importSamsClubCsv(csv, (req as AuthedRequest).user, {
        clearExisting: clearExisting === true,
        defaultClient,
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

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
  "/shuffle-assign-new",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { mapIds, inspectorIds, qaIds } = req.body as {
        mapIds?: string[];
        inspectorIds?: string[];
        qaIds?: string[];
      };
      if (!mapIds?.length) {
        res.status(400).json({ error: "mapIds required" });
        return;
      }
      const result = await workflow.shuffleAssignNewMaps(
        mapIds,
        inspectorIds ?? [],
        qaIds ?? [],
        (req as AuthedRequest).user
      );
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/bulk-delete",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { mapIds } = req.body as { mapIds?: string[] };
      if (!mapIds?.length) {
        res.status(400).json({ error: "mapIds required" });
        return;
      }
      const result = await workflow.deleteMaps(mapIds, (req as AuthedRequest).user);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

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

router.post(
  "/:id/release-to-pipeline",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.releaseMapToPipeline(
        req.params.id,
        (req as AuthedRequest).user
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/unassign",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.unassignInspector(
        req.params.id,
        (req as AuthedRequest).user
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/unassign-qa",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.unassignQa(req.params.id, (req as AuthedRequest).user);
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.patch(
  "/:id/workflow-phase-target",
  requireRoles(
    RoleName.GRAPHIC_TEAM_LEADER,
    RoleName.OPS_ADMIN,
    RoleName.MAPPING_INSPECTOR,
    RoleName.GRAPHIC_QA
  ),
  async (req, res) => {
    try {
      const { workflowPhaseTarget } = req.body as { workflowPhaseTarget?: string };
      const valid = ["PRE_UPLOAD", "UPLOADED", "POLISH", "POLISHED"];
      if (!workflowPhaseTarget || !valid.includes(workflowPhaseTarget)) {
        res.status(400).json({
          error: "workflowPhaseTarget must be PRE_UPLOAD, UPLOADED, POLISH, or POLISHED",
        });
        return;
      }
      const map = await workflow.updateMapWorkflowPhaseTarget(
        req.params.id,
        workflowPhaseTarget as import("@prisma/client").WorkflowPhaseTarget,
        (req as AuthedRequest).user
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.patch(
  "/:id/station",
  requireRoles(
    RoleName.GRAPHIC_TEAM_LEADER,
    RoleName.OPS_ADMIN,
    RoleName.MAPPING_INSPECTOR,
    RoleName.GRAPHIC_QA
  ),
  async (req, res) => {
    try {
      const { station } = req.body as { station?: string };
      const valid = ["PRE_UPLOAD", "UPLOADED", "POLISH", "POLISHED"];
      if (!station || !valid.includes(station)) {
        res.status(400).json({ error: "station must be PRE_UPLOAD, UPLOADED, POLISH, or POLISHED" });
        return;
      }
      const map = await workflow.updateMapWorkflowPhaseTarget(
        req.params.id,
        station as import("@prisma/client").WorkflowPhaseTarget,
        (req as AuthedRequest).user
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

router.delete(
  "/:id",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const result = await workflow.deleteMap(req.params.id, (req as AuthedRequest).user);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post("/:id/accept-assignment", requireRoles(RoleName.MAPPING_INSPECTOR), async (req, res) => {
  try {
    const map = await workflow.acceptInspectorAssignment(req.params.id, (req as AuthedRequest).user);
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/:id/accept-qa-assignment", requireRoles(RoleName.GRAPHIC_QA), async (req, res) => {
  try {
    const map = await workflow.acceptQaAssignment(req.params.id, (req as AuthedRequest).user);
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const { status, note, attachment } = req.body as {
      status?: MapStatus;
      note?: string;
      attachment?: { fileName: string; mimeType: string; data: string };
    };
    if (!status || !Object.values(MapStatus).includes(status)) {
      res.status(400).json({
        error: "Valid status required: ACCEPTED, PROCESSING, DONE, FIX, FIX_DONE, APPROVED",
      });
      return;
    }
    const user = (req as AuthedRequest).user;
    const existing = await workflow.getMapForUser(req.params.id, user);
    if (!existing) {
      res.status(404).json({ error: "Map not found" });
      return;
    }
    const map = await workflow.updateMapStatus(
      req.params.id,
      status,
      user,
      note,
      attachment
    );
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.patch("/:id/inspector-status", requireRoles(RoleName.MAPPING_INSPECTOR), async (req, res) => {
  try {
    const { status, note } = req.body as { status?: MapStatus; note?: string };
    if (!status || !Object.values(MapStatus).includes(status)) {
      res.status(400).json({ error: "Valid status required" });
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
    const { approved, note, attachment } = req.body as {
      approved?: boolean;
      note?: string;
      attachment?: { fileName: string; mimeType: string; data: string };
    };
    if (typeof approved !== "boolean") {
      res.status(400).json({ error: "approved (boolean) required" });
      return;
    }
    const map = await workflow.qaUploadDecision(
      req.params.id,
      approved,
      (req as AuthedRequest).user,
      note,
      attachment
    );
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
    const { status, note, attachment } = req.body as {
      status?: "fix" | "fix_done" | "approved";
      note?: string;
      attachment?: { fileName: string; mimeType: string; data: string };
    };
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
    const map = await workflow.qaPolishDecision(req.params.id, status, user, note, attachment);
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
