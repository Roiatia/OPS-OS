import { MapPhase, InspectorStatus, QaStatus, TaskStatus, RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";
import { hasRole, isLeaderOrAdmin } from "../lib/types.js";

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

export async function listMapsForUser(user: AuthUser) {
  if (isLeaderOrAdmin(user) || hasRole(user, RoleName.OPS_ADMIN)) {
    return prisma.map.findMany({
      include: mapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  if (hasRole(user, RoleName.MAPPING_INSPECTOR)) {
    return prisma.map.findMany({
      where: { assignedInspectorId: user.id },
      include: mapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  if (hasRole(user, RoleName.GRAPHIC_QA)) {
    return prisma.map.findMany({
      where: {
        OR: [
          { phase: { in: [MapPhase.UPLOAD_REVIEW, MapPhase.QA_REVIEW] } },
          { assignedQaId: user.id },
          { qaStatus: { not: null } },
        ],
      },
      include: mapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  return [];
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
    take: 20,
  },
};

export async function getMapForUser(mapId: string, user: AuthUser) {
  const maps = await listMapsForUser(user);
  return maps.find((m) => m.id === mapId) ?? null;
}

export async function assignInspector(
  mapId: string,
  inspectorId: string,
  user: AuthUser
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.INTAKE && map.phase !== MapPhase.PREP) {
    throw new Error("Map cannot be assigned in current phase");
  }

  const inspector = await prisma.user.findFirst({
    where: { id: inspectorId, roles: { some: { role: RoleName.MAPPING_INSPECTOR } } },
  });
  if (!inspector) throw new Error("Inspector not found");

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedInspectorId: inspectorId,
      phase: map.phase === MapPhase.INTAKE ? MapPhase.PREP : map.phase,
      inspectorStatus: map.phase === MapPhase.INTAKE ? InspectorStatus.ACCEPTED : map.inspectorStatus,
      qaStatus: map.phase === MapPhase.INTAKE ? null : map.qaStatus,
    },
    include: mapIncludes,
  });

  await logEvent(mapId, user.id, "assigned_inspector", `Assigned to ${inspector.name}`);
  return updated;
}

export async function assignQa(mapId: string, qaId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  const qa = await prisma.user.findFirst({
    where: { id: qaId, roles: { some: { role: RoleName.GRAPHIC_QA } } },
  });
  if (!qa) throw new Error("QA member not found");

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: { assignedQaId: qaId },
    include: mapIncludes,
  });

  await logEvent(mapId, user.id, "assigned_qa", `Assigned to ${qa.name}`);
  return updated;
}

export async function updateInspectorStatus(
  mapId: string,
  status: InspectorStatus,
  user: AuthUser
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.assignedInspectorId !== user.id && !isLeaderOrAdmin(user)) {
    throw new Error("Not assigned to this map");
  }
  if (map.phase !== MapPhase.PREP && map.phase !== MapPhase.POLISH) {
    throw new Error("Inspector status only applies during prep or polish");
  }

  let phase = map.phase;
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

  await logEvent(mapId, user.id, "inspector_status", `Status → ${status}`, { status });
  return updated;
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

  if (!approved) {
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: {
        phase: MapPhase.PREP,
        inspectorStatus: InspectorStatus.ACCEPTED,
        uploadApproved: false,
      },
      include: mapIncludes,
    });
    await logEvent(mapId, user.id, "upload_rejected", note ?? "Upload not approved");
    return updated;
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
  await logEvent(mapId, user.id, "upload_approved", note ?? "Approved for dashboard upload");
  return updated;
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
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: {
        qaStatus: QaStatus.FIX,
        phase: MapPhase.POLISH,
        inspectorStatus: InspectorStatus.ACCEPTED,
      },
      include: mapIncludes,
    });
    await logEvent(mapId, user.id, "qa_fix", note ?? "QA requested fixes");
    return updated;
  }

  if (status === "fix_done") {
    if (map.qaStatus !== QaStatus.FIX) {
      throw new Error("No active fix request");
    }
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: { qaStatus: QaStatus.FIX_DONE, phase: MapPhase.QA_REVIEW },
      include: mapIncludes,
    });
    await logEvent(mapId, user.id, "fix_done", note ?? "Inspector completed fixes");
    return updated;
  }

  if (status === "approved") {
    if (map.phase !== MapPhase.QA_REVIEW && map.qaStatus !== QaStatus.FIX_DONE) {
      throw new Error("Map is not ready for final approval");
    }
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: { qaStatus: QaStatus.APPROVED, phase: MapPhase.APPROVED },
      include: mapIncludes,
    });
    await logEvent(mapId, user.id, "qa_approved", note ?? "QA approved polish");
    return updated;
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
  if (task.assignedToId !== user.id && !isLeaderOrAdmin(user) && !hasRole(user, RoleName.GRAPHIC_QA)) {
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
      phase: MapPhase.INTAKE,
    },
    include: mapIncludes,
  });
  await logEvent(map.id, user.id, "map_created", `From Jira ${data.jiraTicketId ?? ""}`);
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
