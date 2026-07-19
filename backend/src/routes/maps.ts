import { Router } from "express";
import { InspectorStatus, MapPhase, QaStatus, RoleName, SupervisorStatus, FieldWorkStatus, TaskStatus } from "@prisma/client";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/auth.js";
import { userHasOpsManagerRole } from "../domain/roles.js";
import * as workflow from "../services/workflow.js";
import { syncMapsFromSpreadsheet } from "../services/spreadsheetSync.js";
import { importSamsClubCsv, previewSamsClubCsv } from "../services/csvImport.js";

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

router.post(
  "/shuffle-supervisors",
  requireRoles(RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { mapIds, supervisorIds } = req.body as {
        mapIds?: string[];
        supervisorIds?: string[];
      };
      if (!mapIds?.length) {
        res.status(400).json({ error: "mapIds required" });
        return;
      }
      if (!supervisorIds?.length) {
        res.status(400).json({ error: "supervisorIds required" });
        return;
      }
      const result = await workflow.shuffleAssignSupervisors(
        mapIds,
        supervisorIds,
        (req as AuthedRequest).user
      );
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/unassign-inspectors",
  requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { mapIds } = req.body as { mapIds?: string[] };
      if (!mapIds?.length) {
        res.status(400).json({ error: "mapIds required" });
        return;
      }
      const result = await workflow.unassignInspectors(
        mapIds,
        (req as AuthedRequest).user
      );
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/unassign-supervisors",
  requireRoles(RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { mapIds } = req.body as { mapIds?: string[] };
      if (!mapIds?.length) {
        res.status(400).json({ error: "mapIds required" });
        return;
      }
      const result = await workflow.unassignSupervisors(
        mapIds,
        (req as AuthedRequest).user
      );
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.get("/hub", requireRoles(RoleName.OPS_ADMIN, RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const user = (req as AuthedRequest).user;
    const [maps, supervisors] = await Promise.all([
      workflow.listHubMaps(user),
      workflow.listHubSupervisors(),
    ]);
    res.json({ maps, supervisors });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

router.get("/hub/notifications", requireRoles(RoleName.OPS_ADMIN), async (req, res) => {
  try {
    const sinceParam = req.query.since as string | undefined;
    const query = (req.query.q as string | undefined)?.trim();
    const since = sinceParam ? new Date(sinceParam) : undefined;
    const [feed, alerts] = await Promise.all([
      workflow.listOpsActivityFeed({ since, query }),
      workflow.listOpsShiftAlerts(),
    ]);
    res.json({ feed, alerts });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.patch("/:id/hub", requireRoles(RoleName.OPS_ADMIN, RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const {
      fieldWorkStatus,
      fieldProgressPercent,
      assignedSupervisorId,
      onHubStatusBoard,
      opsManagerComment,
      shiftLeaderApproved,
      returnVisitAt,
    } = req.body as {
      fieldWorkStatus?: FieldWorkStatus;
      fieldProgressPercent?: number;
      assignedSupervisorId?: string | null;
      onHubStatusBoard?: boolean;
      opsManagerComment?: string | null;
      shiftLeaderApproved?: boolean | null;
      returnVisitAt?: string | null;
    };
    const map = await workflow.updateHubMap(
      req.params.id as string,
      {
        fieldWorkStatus,
        fieldProgressPercent,
        assignedSupervisorId,
        onHubStatusBoard,
        opsManagerComment,
        shiftLeaderApproved,
        returnVisitAt,
      },
      (req as AuthedRequest).user
    );
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post(
  "/:id/mapper-not-arrived",
  requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER),
  async (req, res) => {
    try {
      const map = await workflow.reportMapperNotArrived(
        String(req.params.id),
        (req as AuthedRequest).user
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/sl-check/request",
  requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.requestSlCheck(req.params.id as string, (req as AuthedRequest).user);
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/sl-check/claim",
  requireRoles(RoleName.SUPERVISOR_SHIFT_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.claimSlCheck(req.params.id as string, (req as AuthedRequest).user);
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/sl-check/resolve",
  requireRoles(RoleName.SUPERVISOR_SHIFT_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { decision, note } = req.body as {
        decision?: "accept" | "need_corrections";
        note?: string | null;
      };
      if (decision !== "accept" && decision !== "need_corrections") {
        res.status(400).json({ error: "decision must be accept or need_corrections" });
        return;
      }
      const map = await workflow.resolveSlCheck(
        req.params.id as string,
        (req as AuthedRequest).user,
        decision,
        note
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/:id/sl-check/cancel",
  requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER, RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.cancelSlCheck(req.params.id as string, (req as AuthedRequest).user);
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.get("/team-field", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const maps = await workflow.listTeamFieldMaps((req as AuthedRequest).user);
    res.json(maps);
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

router.post("/swap-offer", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { mapIds } = req.body as { mapIds?: string[] };
    if (!mapIds?.length) {
      res.status(400).json({ error: "mapIds required" });
      return;
    }
    const result = await workflow.createSwapOffer(mapIds, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get("/swap-offers", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const [open, mine] = await Promise.all([
      workflow.listOpenSwapOffers((req as AuthedRequest).user),
      workflow.listMySwapOffers((req as AuthedRequest).user),
    ]);
    res.json({ open, mine });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

router.post("/swap-offers/take", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { mapIds } = req.body as { mapIds?: string[] };
    if (!mapIds?.length) {
      res.status(400).json({ error: "mapIds required" });
      return;
    }
    const taken = await workflow.takeSwapMaps(mapIds, (req as AuthedRequest).user);
    res.json({ taken });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/help-ask", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { mapIds } = req.body as { mapIds?: string[] };
    if (!mapIds?.length) {
      res.status(400).json({ error: "mapIds required" });
      return;
    }
    const result = await workflow.createHelpAsk(mapIds, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get("/help-asks", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const user = (req as AuthedRequest).user;
    const [incoming, mine] = await Promise.all([
      workflow.listIncomingHelpAsks(user),
      workflow.listMyHelpAsks(user),
    ]);
    res.json({ incoming, mine });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

router.post("/help-asks/accept", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { batchId } = req.body as { batchId?: string };
    if (!batchId) {
      res.status(400).json({ error: "batchId required" });
      return;
    }
    const result = await workflow.acceptHelpAsk(batchId, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/help-asks/reject", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { batchId } = req.body as { batchId?: string };
    if (!batchId) {
      res.status(400).json({ error: "batchId required" });
      return;
    }
    const result = await workflow.rejectHelpAsk(batchId, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/help-asks/cancel", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { batchId } = req.body as { batchId?: string };
    if (!batchId) {
      res.status(400).json({ error: "batchId required" });
      return;
    }
    const result = await workflow.cancelHelpAsk(batchId, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/swap-offers/decline", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { batchId } = req.body as { batchId?: string };
    if (!batchId) {
      res.status(400).json({ error: "batchId required" });
      return;
    }
    const result = await workflow.declineSwapOffer(batchId, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/swap-offers/cancel", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { batchId } = req.body as { batchId?: string };
    if (!batchId) {
      res.status(400).json({ error: "batchId required" });
      return;
    }
    const result = await workflow.cancelSwapOffer(batchId, (req as AuthedRequest).user);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** @deprecated — creates an open swap offer (request), not an instant transfer */
router.post("/swap-supervisor", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { mapIds } = req.body as { mapIds?: string[]; toSupervisorId?: string };
    if (!mapIds?.length) {
      res.status(400).json({ error: "mapIds required" });
      return;
    }
    const result = await workflow.createSwapOffer(mapIds, (req as AuthedRequest).user);
    res.json({ swapped: result.offered, batchId: result.batchId });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get("/team", requireRoles(RoleName.GRAPHIC_TEAM_LEADER, RoleName.OPS_ADMIN, RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (_req, res) => {
  const team = await workflow.listTeamMembers();
  res.json(team);
});

// Combined dashboard payload — one round-trip instead of 3 (maps + history +
// team + supervisor field maps). Sub-lists the caller may not access resolve
// to []. Realtime keeps this fresh after the initial load.
router.get("/dashboard", async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    const [maps, history, team, teamFieldMaps] = await Promise.all([
      workflow.listMapsForUser(user),
      workflow.listHistoryMaps(user).catch(() => []),
      workflow.listTeamMembers().catch(() => []),
      workflow.listTeamFieldMaps(user).catch(() => []),
    ]);
    res.json({ maps, history, team, teamFieldMaps });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
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

router.post(
  "/import-csv/preview",
  requireRoles(RoleName.OPS_ADMIN, RoleName.GRAPHIC_TEAM_LEADER),
  async (req, res) => {
    try {
      const { csv } = req.body as { csv?: string };
      if (!csv?.trim()) {
        res.status(400).json({ error: "csv is required" });
        return;
      }
      const preview = await previewSamsClubCsv(csv);
      res.json(preview);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/import-csv",
  requireRoles(RoleName.OPS_ADMIN, RoleName.GRAPHIC_TEAM_LEADER),
  async (req, res) => {
    try {
      const { csv, clearExisting, defaultClient } = req.body as {
        csv?: string;
        clearExisting?: boolean;
        defaultClient?: string;
      };
      if (!csv?.trim()) {
        res.status(400).json({ error: "csv is required" });
        return;
      }
      const result = await importSamsClubCsv(csv, (req as AuthedRequest).user, {
        clearExisting,
        defaultClient,
      });
      res.json(result);
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
  "/:id/release-to-graphics",
  requireRoles(RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const map = await workflow.releaseToGraphics(
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
  "/:id/assign-supervisor",
  requireRoles(RoleName.OPS_ADMIN),
  async (req, res) => {
    try {
      const { supervisorId, attachment } = req.body as {
        supervisorId?: string;
        attachment?: { fileName: string; mimeType: string; data: string };
      };
      if (!supervisorId) {
        res.status(400).json({ error: "supervisorId required" });
        return;
      }
      const map = await workflow.assignSupervisor(
        req.params.id,
        supervisorId,
        (req as AuthedRequest).user,
        attachment
      );
      res.json(map);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

router.patch("/:id/supervisor-status", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { status, note } = req.body as { status?: SupervisorStatus; note?: string };
    if (!status || !Object.values(SupervisorStatus).includes(status)) {
      res.status(400).json({ error: "Valid status required: ACCEPTED, PROCESSING, DONE" });
      return;
    }
    const map = await workflow.updateSupervisorStatus(
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

router.patch("/:id/supervisor-field", requireRoles(RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER), async (req, res) => {
  try {
    const { loomDone, positioning, mapperName, fieldDate, opsManagerComment, fieldWorkStatus } = req.body as {
      loomDone?: boolean;
      positioning?: boolean;
      mapperName?: string | null;
      fieldDate?: string | null;
      opsManagerComment?: string | null;
      fieldWorkStatus?: FieldWorkStatus;
    };
    if (
      fieldWorkStatus !== undefined &&
      !Object.values(FieldWorkStatus).includes(fieldWorkStatus)
    ) {
      res.status(400).json({ error: "Invalid fieldWorkStatus" });
      return;
    }
    const map = await workflow.updateSupervisorFieldWork(
      req.params.id,
      { loomDone, positioning, mapperName, fieldDate, opsManagerComment, fieldWorkStatus },
      (req as AuthedRequest).user
    );
    res.json(map);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post(
  "/:id/field-complete",
  requireRoles(RoleName.OPS_ADMIN),
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
    if (
      status === "fix_done" &&
      !user.roles.includes(RoleName.MAPPING_INSPECTOR) &&
      !userHasOpsManagerRole(user)
    ) {
      res.status(403).json({ error: "Only inspector can mark fix done" });
      return;
    }
    if (
      (status === "fix" || status === "approved") &&
      !user.roles.includes(RoleName.GRAPHIC_QA) &&
      !userHasOpsManagerRole(user)
    ) {
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

/** Import / update maps from Oriient Field Operations spreadsheet (CSV upload or Google Sheets). */
router.post("/sync-spreadsheet", requireRoles(RoleName.OPS_ADMIN, RoleName.OPS_MANAGER_2), async (req, res) => {
  try {
    const { csv, sheetTab } = req.body as { csv?: string; sheetTab?: string };
    if (!csv?.trim() && !process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
      res.status(400).json({
        error: "Upload a CSV file from Google Sheets (File → Download → CSV).",
      });
      return;
    }
    const result = await syncMapsFromSpreadsheet((req as AuthedRequest).user, {
      csv: csv?.trim() || undefined,
      sheetTab,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;
