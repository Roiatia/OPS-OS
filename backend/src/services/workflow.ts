import { MapPhase, InspectorStatus, QaStatus, TaskStatus, RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";
import { hasRole, isLeaderOrAdmin } from "../lib/types.js";

export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  data: string;
}

const ARCHIVED_PHASES: MapPhase[] = [MapPhase.APPROVED, MapPhase.CANCELLED];

async function logEvent(
  mapId: string,
  userId: string,
  action: string,
  note?: string,
  metadata?: Record<string, unknown>
) {
  await prisma.mapEvent.create({
    data: {
      mapId,
      userId,
      action,
      note,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

async function logPhaseEntry(
  mapId: string,
  phase: MapPhase,
  userId: string,
  note?: string
) {
  await prisma.mapPhaseHistory.create({
    data: { mapId, phase, userId, note },
  });
}

async function saveAttachment(
  mapId: string,
  userId: string,
  context: string,
  attachment: AttachmentInput
) {
  await prisma.mapAttachment.create({
    data: {
      mapId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      data: attachment.data,
      context,
      uploadedById: userId,
    },
  });
}

const mapIncludes = {
  assignedInspector: { select: { id: true, name: true, email: true } },
  assignedQa: { select: { id: true, name: true, email: true } },
  tasks: {
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  events: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
    take: 50,
  },
  phaseHistory: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { enteredAt: "asc" as const },
  },
  attachments: {
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  notes: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

export async function listMapsForUser(user: AuthUser) {
  if (isLeaderOrAdmin(user) || hasRole(user, RoleName.OPS_ADMIN)) {
    return prisma.map.findMany({
      where: { phase: { notIn: ARCHIVED_PHASES } },
      include: mapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  if (hasRole(user, RoleName.MAPPING_INSPECTOR)) {
    return prisma.map.findMany({
      where: {
        phase: { notIn: ARCHIVED_PHASES },
        OR: [
          { assignedInspectorId: user.id },
          { tasks: { some: { assignedToId: user.id } } },
        ],
      },
      include: mapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  if (hasRole(user, RoleName.GRAPHIC_QA)) {
    return prisma.map.findMany({
      where: {
        phase: { notIn: ARCHIVED_PHASES },
        OR: [
          { phase: { in: [MapPhase.UPLOAD_REVIEW, MapPhase.QA_REVIEW] } },
          { assignedQaId: user.id },
          { qaStatus: { not: null } },
          { tasks: { some: { assignedToId: user.id } } },
        ],
      },
      include: mapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  return [];
}

export async function listHistoryMaps(user: AuthUser) {
  if (!isLeaderOrAdmin(user) && !hasRole(user, RoleName.OPS_ADMIN)) {
    throw new Error("Not allowed to view history");
  }

  return prisma.map.findMany({
    where: { phase: { in: ARCHIVED_PHASES } },
    include: mapIncludes,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getMapForUser(mapId: string, user: AuthUser) {
  let map = await prisma.map.findUnique({
    where: { id: mapId },
    include: mapIncludes,
  });
  if (!map) return null;

  if (map.phaseHistory.length === 0) {
    const creator =
      map.events.find((e) => e.action === "map_created")?.userId ??
      (await prisma.user.findFirst({
        where: { roles: { some: { role: RoleName.GRAPHIC_TEAM_LEADER } } },
      }))?.id;
    if (creator) {
      await backfillPhaseHistory(map.id, creator, MapPhase.INTAKE, map.createdAt);
      const actorId =
        map.assignedInspectorId ?? map.assignedQaId ?? creator;
      if (map.phase !== MapPhase.INTAKE) {
        await backfillPhaseHistory(map.id, actorId, map.phase, map.updatedAt);
      }
      map = await prisma.map.findUnique({
        where: { id: mapId },
        include: mapIncludes,
      });
    }
  }

  if (!map) return null;

  if (isLeaderOrAdmin(user) || hasRole(user, RoleName.OPS_ADMIN)) {
    return map;
  }

  if (hasRole(user, RoleName.MAPPING_INSPECTOR) && map.assignedInspectorId === user.id) {
    return map;
  }

  if (hasRole(user, RoleName.MAPPING_INSPECTOR)) {
    const hasTask = map.tasks.some((t) => t.assignedToId === user.id);
    if (hasTask) return map;
  }

  if (hasRole(user, RoleName.GRAPHIC_QA)) {
    const qaPhases: MapPhase[] = [MapPhase.UPLOAD_REVIEW, MapPhase.QA_REVIEW];
    const qaAccess =
      map.assignedQaId === user.id ||
      qaPhases.includes(map.phase) ||
      map.qaStatus !== null ||
      map.tasks.some((t) => t.assignedToId === user.id);
    if (qaAccess) return map;
  }

  return null;
}

export async function assignInspector(
  mapId: string,
  inspectorId: string,
  user: AuthUser,
  attachment?: AttachmentInput
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Cannot assign archived map");
  }
  const assignablePhases: MapPhase[] = [MapPhase.INTAKE, MapPhase.PREP, MapPhase.POLISH];
  if (!assignablePhases.includes(map.phase)) {
    throw new Error("Map cannot be assigned in current phase");
  }

  const inspector = await prisma.user.findFirst({
    where: { id: inspectorId, roles: { some: { role: RoleName.MAPPING_INSPECTOR } } },
  });
  if (!inspector) throw new Error("Inspector not found");

  const isNewAssignment = map.phase === MapPhase.INTAKE;
  const newPhase = isNewAssignment ? MapPhase.PREP : map.phase;

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedInspectorId: inspectorId,
      phase: newPhase,
      inspectorStatus: isNewAssignment ? null : map.inspectorStatus,
      qaStatus: isNewAssignment ? null : map.qaStatus,
    },
    include: mapIncludes,
  });

  if (isNewAssignment && newPhase !== map.phase) {
    await logPhaseEntry(mapId, MapPhase.PREP, user.id, `Assigned to ${inspector.name}`);
  }

  const action =
    map.assignedInspectorId && map.assignedInspectorId !== inspectorId
      ? "reassigned_inspector"
      : "assigned_inspector";
  await logEvent(
    mapId,
    user.id,
    action,
    `${action === "reassigned_inspector" ? "Reassigned" : "Assigned"} to ${inspector.name}`
  );

  if (attachment) {
    await saveAttachment(mapId, user.id, "assign_inspector", attachment);
    await logEvent(mapId, user.id, "attachment_added", attachment.fileName, {
      context: "assign_inspector",
    });
  }

  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function shuffleAssignInspectors(
  mapIds: string[],
  inspectorIds: string[],
  user: AuthUser
) {
  if (mapIds.length === 0) throw new Error("No maps to assign");
  if (inspectorIds.length === 0) throw new Error("Select at least one inspector");

  const maps = await prisma.map.findMany({
    where: { id: { in: mapIds } },
    orderBy: { mapNumber: "asc" },
  });
  if (maps.length !== mapIds.length) throw new Error("Some maps were not found");

  for (const map of maps) {
    if (map.phase !== MapPhase.INTAKE) {
      throw new Error(`${map.mapNumber} is not unassigned`);
    }
  }

  const inspectors = await prisma.user.findMany({
    where: {
      id: { in: inspectorIds },
      roles: { some: { role: RoleName.MAPPING_INSPECTOR } },
    },
    orderBy: { name: "asc" },
  });
  if (inspectors.length === 0) throw new Error("No valid inspectors found");

  const activeCounts = await prisma.map.groupBy({
    by: ["assignedInspectorId"],
    where: {
      assignedInspectorId: { in: inspectorIds },
      phase: { notIn: ARCHIVED_PHASES },
    },
    _count: { _all: true },
  });

  const workload = new Map<string, number>();
  for (const id of inspectorIds) workload.set(id, 0);
  for (const row of activeCounts) {
    if (row.assignedInspectorId) {
      workload.set(row.assignedInspectorId, row._count._all);
    }
  }

  const assignments: { mapId: string; inspectorId: string; inspectorName: string }[] = [];

  for (const map of maps) {
    const pick = [...inspectors].sort((a, b) => {
      const diff = (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    })[0]!;
    workload.set(pick.id, (workload.get(pick.id) ?? 0) + 1);
    assignments.push({ mapId: map.id, inspectorId: pick.id, inspectorName: pick.name });
  }

  await prisma.$transaction(async (tx) => {
    for (const { mapId, inspectorId, inspectorName } of assignments) {
      await tx.map.update({
        where: { id: mapId },
        data: {
          assignedInspectorId: inspectorId,
          phase: MapPhase.PREP,
          inspectorStatus: null,
          qaStatus: null,
        },
      });
      await tx.mapPhaseHistory.create({
        data: {
          mapId,
          phase: MapPhase.PREP,
          userId: user.id,
          note: `Shuffle assigned to ${inspectorName}`,
        },
      });
      await tx.mapEvent.create({
        data: {
          mapId,
          userId: user.id,
          action: "assigned_inspector",
          note: `Shuffle assigned to ${inspectorName}`,
        },
      });
    }
  });

  const distribution = inspectors.map((inspector) => ({
    inspectorId: inspector.id,
    inspectorName: inspector.name,
    assigned: assignments.filter((a) => a.inspectorId === inspector.id).length,
    totalAfter:
      (activeCounts.find((r) => r.assignedInspectorId === inspector.id)?._count._all ?? 0) +
      assignments.filter((a) => a.inspectorId === inspector.id).length,
  }));

  return { assigned: assignments.length, distribution };
}

export async function assignQa(
  mapId: string,
  qaId: string,
  user: AuthUser,
  attachment?: AttachmentInput
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Cannot assign archived map");
  }

  const qa = await prisma.user.findFirst({
    where: { id: qaId, roles: { some: { role: RoleName.GRAPHIC_QA } } },
  });
  if (!qa) throw new Error("QA member not found");

  await prisma.map.update({
    where: { id: mapId },
    data: { assignedQaId: qaId },
  });

  await logEvent(mapId, user.id, "assigned_qa", `Assigned to ${qa.name}`);

  if (attachment) {
    await saveAttachment(mapId, user.id, "assign_qa", attachment);
    await logEvent(mapId, user.id, "attachment_added", attachment.fileName, {
      context: "assign_qa",
    });
  }

  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function cancelMap(mapId: string, user: AuthUser, note?: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Map is already archived");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: { phase: MapPhase.CANCELLED },
    include: mapIncludes,
  });

  await logPhaseEntry(mapId, MapPhase.CANCELLED, user.id, note ?? "Map cancelled");
  await logEvent(mapId, user.id, "map_cancelled", note ?? "Map cancelled by leader");
  return updated;
}

export async function updateInspectorStatus(
  mapId: string,
  status: InspectorStatus,
  user: AuthUser,
  note?: string
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.assignedInspectorId !== user.id) {
    throw new Error("Not assigned to this map");
  }
  if (map.phase !== MapPhase.PREP && map.phase !== MapPhase.POLISH) {
    throw new Error("Inspector status only applies during prep or polish");
  }

  let phase: MapPhase = map.phase;
  if (status === InspectorStatus.DONE && map.phase === MapPhase.PREP) {
    phase = MapPhase.UPLOAD_REVIEW;
  } else if (status === InspectorStatus.DONE && map.phase === MapPhase.POLISH) {
    phase = MapPhase.QA_REVIEW;
    await prisma.map.update({
      where: { id: mapId },
      data: { qaStatus: null },
    });
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: { inspectorStatus: status, phase },
    include: mapIncludes,
  });

  if (phase !== map.phase) {
    await logPhaseEntry(mapId, phase, user.id, `Inspector status → ${status}`);
  }

  await logEvent(mapId, user.id, "inspector_status", `Status → ${status}`, { status });
  if (note?.trim()) {
    await addMapNote(mapId, user.id, note.trim());
  }
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

async function ensureQaAssigned(mapId: string, qaId: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (map && !map.assignedQaId) {
    await prisma.map.update({
      where: { id: mapId },
      data: { assignedQaId: qaId },
    });
  }
}

export async function addMapNote(mapId: string, userId: string, body: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  await prisma.mapNote.create({
    data: { mapId, userId, body },
  });
  await logEvent(mapId, userId, "note_added", body.slice(0, 120));

  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function qaUploadDecision(
  mapId: string,
  approved: boolean,
  user: AuthUser,
  note?: string
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.UPLOAD_REVIEW) {
    throw new Error("Map is not awaiting upload approval");
  }

  await ensureQaAssigned(mapId, user.id);

  if (!approved) {
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: {
        phase: MapPhase.PREP,
        inspectorStatus: null,
        uploadApproved: false,
      },
      include: mapIncludes,
    });
    await logPhaseEntry(mapId, MapPhase.PREP, user.id, note ?? "Upload rejected");
    await logEvent(mapId, user.id, "upload_rejected", note ?? "Upload not approved");
    if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
    return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.FIELD,
      uploadApproved: true,
      qaStatus: null,
    },
    include: mapIncludes,
  });
  await logPhaseEntry(mapId, MapPhase.FIELD, user.id, note ?? "Upload approved");
  await logEvent(mapId, user.id, "upload_approved", note ?? "Approved for dashboard upload");
  if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function completeFieldWork(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) throw new Error("Map is not in field phase");

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.POLISH,
      inspectorStatus: null,
      qaStatus: null,
    },
    include: mapIncludes,
  });
  await logPhaseEntry(mapId, MapPhase.POLISH, user.id, "Field work complete");
  await logEvent(mapId, user.id, "field_complete", "Supervisors finished — polish started");
  return updated;
}

export async function qaPolishDecision(
  mapId: string,
  status: "fix" | "fix_done" | "approved",
  user: AuthUser,
  note?: string
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  if (status === "fix") {
    if (map.phase !== MapPhase.QA_REVIEW) {
      throw new Error("Can only request fix during QA review");
    }
    await ensureQaAssigned(mapId, user.id);
    await prisma.map.update({
      where: { id: mapId },
      data: {
        qaStatus: QaStatus.FIX,
        phase: MapPhase.POLISH,
        inspectorStatus: InspectorStatus.ACCEPTED,
      },
    });
    await logPhaseEntry(mapId, MapPhase.POLISH, user.id, note ?? "QA requested fixes");
    await logEvent(mapId, user.id, "qa_fix", note ?? "QA requested fixes");
    if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
    return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  }

  if (status === "fix_done") {
    if (map.qaStatus !== QaStatus.FIX) {
      throw new Error("No active fix request");
    }
    await prisma.map.update({
      where: { id: mapId },
      data: { qaStatus: QaStatus.FIX_DONE, phase: MapPhase.QA_REVIEW },
    });
    await logPhaseEntry(mapId, MapPhase.QA_REVIEW, user.id, note ?? "Fixes completed");
    await logEvent(mapId, user.id, "fix_done", note ?? "Inspector completed fixes");
    if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
    return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  }

  if (status === "approved") {
    if (map.phase !== MapPhase.QA_REVIEW && map.qaStatus !== QaStatus.FIX_DONE) {
      throw new Error("Map is not ready for final approval");
    }
    await ensureQaAssigned(mapId, user.id);
    await prisma.map.update({
      where: { id: mapId },
      data: { qaStatus: QaStatus.APPROVED, phase: MapPhase.APPROVED },
    });
    await logPhaseEntry(mapId, MapPhase.APPROVED, user.id, note ?? "QA approved polish");
    await logEvent(mapId, user.id, "qa_approved", note ?? "QA approved polish");
    if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
    return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  }

  throw new Error("Invalid QA status");
}

export async function createTask(
  mapId: string,
  data: { title: string; description?: string; assignedToId?: string; phase: MapPhase },
  user: AuthUser
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  const task = await prisma.task.create({
    data: {
      mapId,
      title: data.title,
      description: data.description,
      phase: data.phase,
      assignedToId: data.assignedToId ?? map.assignedInspectorId,
      createdById: user.id,
      status: TaskStatus.PENDING,
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logEvent(mapId, user.id, "task_created", data.title);
  return task;
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  user: AuthUser
) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { map: true } });
  if (!task) throw new Error("Task not found");
  if (
    task.assignedToId !== user.id &&
    !isLeaderOrAdmin(user) &&
    !hasRole(user, RoleName.GRAPHIC_QA)
  ) {
    throw new Error("Not allowed to update this task");
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { status },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logEvent(task.mapId, user.id, "task_status", `${task.title} → ${status}`);
  return updated;
}

export async function createMapFromJira(
  data: {
    mapNumber: string;
    jiraTicketId?: string;
    client: string;
    area?: string;
    description?: string;
    dueDate?: string;
  },
  user: AuthUser
) {
  const map = await prisma.map.create({
    data: {
      mapNumber: data.mapNumber,
      jiraTicketId: data.jiraTicketId,
      client: data.client,
      area: data.area,
      description: data.description,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      phase: MapPhase.INTAKE,
    },
    include: mapIncludes,
  });
  await logPhaseEntry(map.id, MapPhase.INTAKE, user.id, "Map created from CS");
  await logEvent(map.id, user.id, "map_created", `From Jira ${data.jiraTicketId ?? ""}`);
  return map;
}

export async function updateMapDueDate(mapId: string, dueDate: string | null, user: AuthUser) {
  const existing = await prisma.map.findUnique({ where: { id: mapId } });
  if (!existing) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(existing.phase)) {
    throw new Error("Cannot update deadline on archived maps");
  }

  const map = await prisma.map.update({
    where: { id: mapId },
    data: { dueDate: dueDate ? new Date(dueDate) : null },
    include: mapIncludes,
  });

  await logEvent(
    mapId,
    user.id,
    "due_date_updated",
    dueDate ? `Deadline set to ${dueDate}` : "Deadline cleared"
  );
  return map;
}

export async function listTeamMembers() {
  return prisma.user.findMany({
    where: {
      roles: {
        some: {
          role: {
            in: [RoleName.MAPPING_INSPECTOR, RoleName.GRAPHIC_QA, RoleName.GRAPHIC_TEAM_LEADER],
          },
        },
      },
    },
    include: { roles: true },
    orderBy: { name: "asc" },
  });
}

/** Backfill phase history from map creation for maps missing entries */
export async function backfillPhaseHistory(mapId: string, userId: string, phase: MapPhase, enteredAt: Date) {
  const existing = await prisma.mapPhaseHistory.findFirst({
    where: { mapId, phase },
  });
  if (!existing) {
    await prisma.mapPhaseHistory.create({
      data: { mapId, phase, userId, enteredAt },
    });
  }
}
