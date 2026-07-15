import { MapPhase, InspectorStatus, SupervisorStatus, FieldWorkStatus, QaStatus, TaskStatus, RoleName, SlCheckStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { mapListIncludes, mapDetailIncludes } from "../lib/mapIncludes.js";
import { broadcastMapsInvalidate } from "../lib/realtimeBus.js";
import { assertUploadCompleteForMapping } from "../domain/pipeline.js";
import {
  getActivityLabel,
  getActivityTeam,
  isMilestoneEvent,
  MILESTONE_ACTIONS,
  normalizeMilestoneAction,
} from "../domain/activityFeed.js";
import {
  SUPERVISOR_ROLE_NAMES,
  supervisorRolesWhere,
  userHasShiftLeaderRole,
  userHasSupervisorRole,
  userIsShiftLeader,
} from "../domain/roles.js";
import type { AuthUser } from "../lib/types.js";
import { hasRole, isLeaderOrAdmin, isOpsManager } from "../lib/types.js";

export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  data: string;
}

const ARCHIVED_PHASES: MapPhase[] = [MapPhase.APPROVED, MapPhase.CANCELLED];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function hubMapsWhereClause() {
  return {
    phase: MapPhase.FIELD,
    uploadApproved: true,
    uploadCompletedAt: { not: null },
    OR: [
      { fieldWorkStatus: { not: FieldWorkStatus.CANCELLED } },
      { fieldWorkStatus: FieldWorkStatus.CANCELLED, onHubStatusBoard: true },
    ],
  };
}

function onShiftTodayWhereClause() {
  return {
    roles: { some: { role: { in: [...SUPERVISOR_ROLE_NAMES] } } },
    shiftStartedAt: { gte: startOfToday(), lte: endOfToday() },
  };
}

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

/** Hub board + PATCH /hub — no events/notes/tasks (much faster over remote DB) */
const hubMapIncludes = {
  assignedInspector: { select: { id: true, name: true, email: true } },
  assignedQa: { select: { id: true, name: true, email: true } },
  assignedSupervisor: { select: { id: true, name: true, email: true } },
};

export async function listMapsForUser(user: AuthUser) {
  if (isLeaderOrAdmin(user)) {
    return prisma.map.findMany({
      where: { phase: { notIn: ARCHIVED_PHASES } },
      include: mapListIncludes,
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
      include: mapListIncludes,
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
      include: mapListIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  if (userHasSupervisorRole(user)) {
    return prisma.map.findMany({
      where: {
        phase: MapPhase.FIELD,
        assignedSupervisorId: user.id,
      },
      include: mapListIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  return [];
}

export async function listTeamFieldMaps(user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Not allowed to view team field maps");
  }

  return prisma.map.findMany({
    where: {
      phase: MapPhase.FIELD,
      assignedSupervisorId: { not: null },
    },
    include: mapListIncludes,
    orderBy: [{ fieldDate: "asc" }, { updatedAt: "desc" }],
  });
}

export async function swapSupervisorMaps(
  mapIds: string[],
  toSupervisorId: string,
  user: AuthUser
) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can swap assignments");
  }
  if (toSupervisorId === user.id) {
    throw new Error("Cannot swap maps to yourself");
  }

  const toSupervisor = await prisma.user.findFirst({
    where: { id: toSupervisorId, ...supervisorRolesWhere() },
  });
  if (!toSupervisor) throw new Error("Target supervisor not found");

  const maps = await prisma.map.findMany({
    where: {
      id: { in: mapIds },
      assignedSupervisorId: user.id,
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    },
  });
  if (maps.length === 0) {
    throw new Error("No eligible maps to swap");
  }

  for (const map of maps) {
    await prisma.map.update({
      where: { id: map.id },
      data: {
        assignedSupervisorId: toSupervisorId,
        supervisorStatus: null,
      },
    });
    await logEvent(
      map.id,
      user.id,
      "supervisor_swap",
      `Shift swap → ${toSupervisor.name}`
    );
  }

  return maps.length;
}

export async function releaseToGraphics(mapId: string, user: AuthUser) {
  if (!isOpsManager(user)) {
    throw new Error("Only OPS manager can release maps to graphics");
  }

  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.INTAKE) {
    throw new Error("Only new maps from CS can be sent to graphics");
  }
  if (map.releasedToGraphics) {
    throw new Error("Map already sent to graphics");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: { releasedToGraphics: true },
  });
  await logEvent(mapId, user.id, "released_to_graphics", "OPS sent map to graphics team");
  return prisma.map.findUnique({ where: { id: mapId }, include: mapListIncludes });
}

export async function shuffleAssignSupervisors(
  mapIds: string[],
  supervisorIds: string[],
  user: AuthUser
) {
  if (!isOpsManager(user)) {
    throw new Error("Only OPS manager can shuffle supervisor assignments");
  }
  if (mapIds.length === 0) throw new Error("No maps to assign");
  if (supervisorIds.length === 0) throw new Error("Select at least one supervisor");

  const maps = await prisma.map.findMany({
    where: { id: { in: mapIds } },
    orderBy: { mapNumber: "asc" },
  });
  if (maps.length !== mapIds.length) throw new Error("Some maps were not found");

  for (const map of maps) {
    if (map.phase !== MapPhase.FIELD) {
      throw new Error(`${map.mapNumber} is not in field work`);
    }
    assertUploadCompleteForMapping(map);
    if (map.fieldWorkStatus === FieldWorkStatus.COMPLETED) {
      throw new Error(`${map.mapNumber} is already completed`);
    }
    if (map.fieldWorkStatus === FieldWorkStatus.CANCELLED) {
      throw new Error(`${map.mapNumber} is cancelled`);
    }
  }

  const supervisors = await prisma.user.findMany({
    where: {
      id: { in: supervisorIds },
      ...supervisorRolesWhere(),
    },
    orderBy: { name: "asc" },
  });
  if (supervisors.length === 0) throw new Error("No valid supervisors found");

  const activeCounts = await prisma.map.groupBy({
    by: ["assignedSupervisorId"],
    where: {
      assignedSupervisorId: { in: supervisorIds },
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    },
    _count: { _all: true },
  });

  const workload = new Map<string, number>();
  for (const id of supervisorIds) workload.set(id, 0);
  for (const row of activeCounts) {
    if (row.assignedSupervisorId) {
      workload.set(row.assignedSupervisorId, row._count._all);
    }
  }

  const assignments: { mapId: string; supervisorId: string; supervisorName: string }[] = [];

  for (const map of maps) {
    const pick = [...supervisors].sort((a, b) => {
      const diff = (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    })[0]!;
    workload.set(pick.id, (workload.get(pick.id) ?? 0) + 1);
    assignments.push({ mapId: map.id, supervisorId: pick.id, supervisorName: pick.name });
  }

  await prisma.$transaction(async (tx) => {
    for (const { mapId, supervisorId, supervisorName } of assignments) {
      await tx.map.update({
        where: { id: mapId },
        data: {
          assignedSupervisorId: supervisorId,
          supervisorStatus: null,
          fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
        },
      });
      await tx.mapEvent.create({
        data: {
          mapId,
          userId: user.id,
          action: "assigned_supervisor",
          note: `Shuffle assigned to ${supervisorName}`,
        },
      });
    }
  });

  // Bulk change: tell clients to refetch (overrides any mid-transaction upserts).
  broadcastMapsInvalidate();

  const distribution = supervisors.map((supervisor) => ({
    supervisorId: supervisor.id,
    supervisorName: supervisor.name,
    assigned: assignments.filter((a) => a.supervisorId === supervisor.id).length,
    totalAfter:
      (activeCounts.find((r) => r.assignedSupervisorId === supervisor.id)?._count._all ?? 0) +
      assignments.filter((a) => a.supervisorId === supervisor.id).length,
  }));

  return { assigned: assignments.length, distribution };
}

export async function listHistoryMaps(user: AuthUser) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Not allowed to view history");
  }

  return prisma.map.findMany({
    where: { phase: { in: ARCHIVED_PHASES } },
    include: mapListIncludes,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getMapForUser(mapId: string, user: AuthUser) {
  let map = await prisma.map.findUnique({
    where: { id: mapId },
    include: mapDetailIncludes,
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
        map.assignedInspectorId ?? map.assignedSupervisorId ?? map.assignedQaId ?? creator;
      if (map.phase !== MapPhase.INTAKE) {
        await backfillPhaseHistory(map.id, actorId, map.phase, map.updatedAt);
      }
      map = await prisma.map.findUnique({
        where: { id: mapId },
        include: mapDetailIncludes,
      });
    }
  }

  if (!map) return null;

  if (isLeaderOrAdmin(user)) {
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

  if (userHasSupervisorRole(user) && map.assignedSupervisorId === user.id && map.phase === MapPhase.FIELD) {
    return map;
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

  await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedInspectorId: inspectorId,
      phase: newPhase,
      inspectorStatus: isNewAssignment ? null : map.inspectorStatus,
      qaStatus: isNewAssignment ? null : map.qaStatus,
    },
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

  return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
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

  // Bulk change: tell clients to refetch (overrides any mid-transaction upserts).
  broadcastMapsInvalidate();

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

  return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
}

export async function cancelMap(mapId: string, user: AuthUser, note?: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Map is already archived");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.CANCELLED,
      fieldWorkStatus: FieldWorkStatus.CANCELLED,
    },
    include: mapDetailIncludes,
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

  await prisma.map.update({
    where: { id: mapId },
    data: { inspectorStatus: status, phase },
  });

  if (phase !== map.phase) {
    await logPhaseEntry(mapId, phase, user.id, `Inspector status → ${status}`);
  }

  await logEvent(mapId, user.id, "inspector_status", `Status → ${status}`, { status });
  if (note?.trim()) {
    await addMapNote(mapId, user.id, note.trim());
  }
  return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
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

  return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
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
    await prisma.map.update({
      where: { id: mapId },
      data: {
        phase: MapPhase.PREP,
        inspectorStatus: null,
        uploadApproved: false,
        uploadCompletedAt: null,
      },
    });
    await logPhaseEntry(mapId, MapPhase.PREP, user.id, note ?? "Upload rejected");
    await logEvent(mapId, user.id, "upload_rejected", note ?? "Upload not approved");
    if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
    return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
  }

  await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.FIELD,
      uploadApproved: true,
      uploadCompletedAt: new Date(),
      qaStatus: null,
      supervisorStatus: null,
    },
  });
  await logPhaseEntry(mapId, MapPhase.FIELD, user.id, note ?? "Upload approved");
  await logEvent(mapId, user.id, "upload_approved", note ?? "Approved for dashboard upload");
  if (note?.trim()) await addMapNote(mapId, user.id, note.trim());
  return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
}

export async function assignSupervisor(
  mapId: string,
  supervisorId: string,
  user: AuthUser,
  attachment?: AttachmentInput
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) {
    throw new Error("Supervisor can only be assigned during field work");
  }
  assertUploadCompleteForMapping(map);
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Cannot assign archived map");
  }

  const supervisor = await prisma.user.findFirst({
    where: { id: supervisorId, ...supervisorRolesWhere() },
  });
  if (!supervisor) throw new Error("Supervisor not found");

  const shiftStart = new Date();
  shiftStart.setSeconds(0, 0);

  await prisma.user.update({
    where: { id: supervisorId },
    data: { shiftStartedAt: shiftStart },
  });

  await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedSupervisorId: supervisorId,
      supervisorStatus: null,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      onHubStatusBoard: false,
      fieldDate: map.fieldDate ?? new Date(),
      loomDone: false,
    },
  });

  const action =
    map.assignedSupervisorId && map.assignedSupervisorId !== supervisorId
      ? "reassigned_supervisor"
      : "assigned_supervisor";
  await logEvent(
    mapId,
    user.id,
    action,
    `${action === "reassigned_supervisor" ? "Reassigned" : "Assigned"} to ${supervisor.name}`
  );

  if (attachment) {
    await saveAttachment(mapId, user.id, "assign_supervisor", attachment);
    await logEvent(mapId, user.id, "attachment_added", attachment.fileName, {
      context: "assign_supervisor",
    });
  }

  return prisma.map.findUnique({ where: { id: mapId }, include: mapListIncludes });
}

export async function updateSupervisorStatus(
  mapId: string,
  status: SupervisorStatus,
  user: AuthUser,
  note?: string
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.assignedSupervisorId !== user.id) {
    throw new Error("Not assigned to this map");
  }
  if (map.phase !== MapPhase.FIELD) {
    throw new Error("Supervisor status only applies during field work");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: {
      supervisorStatus: status,
      ...(status === SupervisorStatus.DONE
        ? { fieldWorkStatus: FieldWorkStatus.COMPLETED }
        : {}),
    },
  });

  await logEvent(mapId, user.id, "supervisor_status", `Status → ${status}`, { status });
  if (status === SupervisorStatus.DONE) {
    await logEvent(
      mapId,
      user.id,
      "supervisor_field_done",
      note ?? "Field mapping complete — awaiting OPS manager review"
    );
  }
  if (note?.trim()) {
    await addMapNote(mapId, user.id, note.trim());
  }
  return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
}

export async function updateSupervisorFieldWork(
  mapId: string,
  data: {
    loomDone?: boolean;
    positioning?: boolean;
    mapperName?: string | null;
    fieldDate?: string | null;
    opsManagerComment?: string | null;
    fieldWorkStatus?: FieldWorkStatus;
  },
  user: AuthUser
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.assignedSupervisorId !== user.id) {
    throw new Error("Not assigned to this map");
  }
  if (map.phase !== MapPhase.FIELD) {
    throw new Error("Field work can only be updated during field phase");
  }
  if (map.fieldWorkStatus === FieldWorkStatus.CANCELLED) {
    throw new Error("Map is cancelled");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      ...(data.loomDone !== undefined ? { loomDone: data.loomDone } : {}),
      ...(data.positioning !== undefined ? { positioning: data.positioning } : {}),
      ...(data.mapperName !== undefined ? { mapperName: data.mapperName } : {}),
      ...(data.fieldDate !== undefined
        ? { fieldDate: data.fieldDate ? new Date(data.fieldDate) : null }
        : {}),
      ...(data.opsManagerComment !== undefined
        ? { opsManagerComment: data.opsManagerComment }
        : {}),
      ...(data.fieldWorkStatus !== undefined ? { fieldWorkStatus: data.fieldWorkStatus } : {}),
      ...(data.fieldWorkStatus === FieldWorkStatus.COMPLETED
        ? { supervisorStatus: SupervisorStatus.DONE }
        : {}),
    },
    include: mapListIncludes,
  });

  if (data.opsManagerComment?.trim()) {
    await logEvent(mapId, user.id, "ops_manager_comment", data.opsManagerComment.trim());
  } else {
    await logEvent(mapId, user.id, "supervisor_field_updated", "Field work details updated");
  }
  return updated;
}

export async function completeFieldWork(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) throw new Error("Map is not in field phase");
  assertUploadCompleteForMapping(map);
  if (map.assignedSupervisorId && map.supervisorStatus !== SupervisorStatus.DONE) {
    throw new Error("Supervisor must mark field work as Done before releasing to graphics");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.POLISH,
      inspectorStatus: null,
      supervisorStatus: null,
      qaStatus: null,
    },
    include: mapDetailIncludes,
  });
  await logPhaseEntry(mapId, MapPhase.POLISH, user.id, "OPS released to graphics polish");
  await logEvent(mapId, user.id, "field_complete", "Released to graphics for polish");
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
    return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
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
    return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
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
    return prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes });
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
    include: mapListIncludes,
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
    include: mapDetailIncludes,
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
            in: [
              RoleName.MAPPING_INSPECTOR,
              RoleName.GRAPHIC_QA,
              RoleName.GRAPHIC_TEAM_LEADER,
              RoleName.SUPERVISOR,
              RoleName.SUPERVISOR_SHIFT_LEADER,
            ],
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      shiftStartedAt: true,
      roles: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function listHubMaps(user: AuthUser) {
  const isOps = isOpsManager(user);
  const isSupervisor = userHasSupervisorRole(user);

  if (!isOps && !isSupervisor) {
    throw new Error("Not allowed to view hub");
  }

  // Full board for everyone with hub access (managers, shift leaders, supervisors).
  // Drag/update is enforced in updateHubMap + frontend canDrag — supervisors
  // may only move maps assigned to them.
  return prisma.map.findMany({
    where: hubMapsWhereClause(),
    include: hubMapIncludes,
    orderBy: [{ fieldDate: "asc" }, { updatedAt: "desc" }],
  });
}

export async function listHubSupervisors() {
  /** Hub columns = only supervisors & shift leaders clocked in for today */
  const onShift = await prisma.user.findMany({
    where: onShiftTodayWhereClause(),
    select: {
      id: true,
      name: true,
      email: true,
      shiftStartedAt: true,
      roles: true,
    },
    orderBy: [{ shiftStartedAt: "asc" }, { name: "asc" }],
  });

  return onShift;
}

export interface OpsShiftAlert {
  id: string;
  type: "no_shift_leader";
  message: string;
  detail: string;
  createdAt: string;
  supervisorNames: string[];
}

export async function listOpsShiftAlerts(): Promise<OpsShiftAlert[]> {
  const onShift = await prisma.user.findMany({
    where: onShiftTodayWhereClause(),
    select: {
      name: true,
      roles: { select: { role: true } },
    },
    orderBy: { name: "asc" },
  });

  if (onShift.length === 0) return [];

  const shiftLeaders = onShift.filter(userIsShiftLeader);
  if (shiftLeaders.length > 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const names = onShift.map((u) => u.name);

  return [
    {
      id: `alert:no-shift-leader:${today}`,
      type: "no_shift_leader",
      message: "No shift leader on today's shift",
      detail: `${names.length} supervisor${names.length === 1 ? "" : "s"} on shift (${names.join(", ")}) but no shift leader is clocked in. Assign a shift leader to review supervisor work.`,
      createdAt: new Date().toISOString(),
      supervisorNames: names,
    },
  ];
}

export async function listOpsActivityFeed(options: {
  since?: Date;
  query?: string;
  limit?: number;
}) {
  const { since, query, limit = 120 } = options;
  const sinceDate =
    since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const events = await prisma.mapEvent.findMany({
    where: {
      createdAt: { gt: sinceDate },
      OR: [
        { action: { in: [...MILESTONE_ACTIONS] } },
        { action: "inspector_status" },
      ],
    },
    include: {
      user: { select: { id: true, name: true } },
      map: {
        select: {
          id: true,
          mapNumber: true,
          client: true,
          mapperName: true,
          opsManagerComment: true,
          assignedInspector: { select: { name: true } },
          assignedQa: { select: { name: true } },
          assignedSupervisor: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit * 2,
  });

  const milestones = events
    .filter((e) => isMilestoneEvent(e.action, e.metadata))
    .map((e) => ({
      ...e,
      action: normalizeMilestoneAction(e.action, e.metadata),
      team: getActivityTeam(normalizeMilestoneAction(e.action, e.metadata)),
    }))
    .slice(0, limit);

  const q = query?.trim().toLowerCase();
  if (!q) {
    return milestones;
  }

  return milestones.filter((e) => activityMatchesQuery(e, q));
}

function activityMatchesQuery(
  event: {
    action: string;
    note: string | null;
    user: { name: string };
    map: {
      mapNumber: string;
      client: string;
      mapperName: string | null;
      opsManagerComment: string | null;
      assignedInspector: { name: string } | null;
      assignedQa: { name: string } | null;
      assignedSupervisor: { name: string } | null;
    };
  },
  q: string
): boolean {
  const haystack = [
    event.map.mapNumber,
    event.map.client,
    event.map.mapperName,
    event.map.opsManagerComment,
    event.map.assignedSupervisor?.name,
    event.user.name,
    event.note,
    getActivityLabel(event.action),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** @deprecated use listOpsActivityFeed */
export async function listOpsHubNotifications(since: Date) {
  return listOpsActivityFeed({ since, limit: 50 });
}

export async function updateHubMap(
  mapId: string,
  data: {
    fieldWorkStatus?: FieldWorkStatus;
    fieldProgressPercent?: number;
    assignedSupervisorId?: string | null;
    onHubStatusBoard?: boolean;
    opsManagerComment?: string | null;
    shiftLeaderApproved?: boolean | null;
    returnVisitAt?: string | null;
  },
  user: AuthUser
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) {
    throw new Error("Hub only applies to field maps");
  }
  assertUploadCompleteForMapping(map);

  const isOps = isOpsManager(user);
  const isShiftLeader = userHasShiftLeaderRole(user);
  const isAssignedSupervisor = map.assignedSupervisorId === user.id;

  // OPS managers + shift leaders can update any hub map; supervisors ONLY their assigned maps
  if (!isOps && !isShiftLeader && !isAssignedSupervisor) {
    throw new Error(
      "Not allowed — only the assigned supervisor, a shift leader, or OPS manager can move this map"
    );
  }

  if (map.fieldWorkStatus === FieldWorkStatus.CANCELLED && !isOps && !data.returnVisitAt) {
    throw new Error("Only OPS manager can restore a cancelled map");
  }

  if (!isOps && data.assignedSupervisorId !== undefined) {
    throw new Error("Only OPS manager can reassign supervisors in the hub");
  }

  if (
    data.fieldProgressPercent !== undefined &&
    (data.fieldProgressPercent < 0 || data.fieldProgressPercent > 100)
  ) {
    throw new Error("Progress must be between 0 and 100");
  }

  let returnVisitDate: Date | null | undefined = undefined;
  if (data.returnVisitAt !== undefined) {
    if (data.returnVisitAt === null || data.returnVisitAt === "") {
      returnVisitDate = null;
    } else {
      const parsed = new Date(data.returnVisitAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid return visit date/time");
      }
      returnVisitDate = parsed;
    }
  }

  const patch: {
    fieldWorkStatus?: FieldWorkStatus;
    fieldProgressPercent?: number;
    assignedSupervisorId?: string | null;
    supervisorStatus?: SupervisorStatus | null;
    onHubStatusBoard?: boolean;
    fieldDate?: Date;
    opsManagerComment?: string | null;
    shiftLeaderApproved?: boolean | null;
    returnVisitAt?: Date | null;
  } = {};

  if (data.opsManagerComment !== undefined) {
    patch.opsManagerComment = data.opsManagerComment?.trim() || null;
  }

  if (data.shiftLeaderApproved !== undefined) {
    patch.shiftLeaderApproved = data.shiftLeaderApproved;
  }

  if (returnVisitDate !== undefined) {
    patch.returnVisitAt = returnVisitDate;
  }

  if (data.assignedSupervisorId !== undefined) {
    patch.assignedSupervisorId = data.assignedSupervisorId;
    if (data.assignedSupervisorId) {
      patch.fieldWorkStatus = FieldWorkStatus.UNCOMPLETED;
      patch.supervisorStatus = null;
      patch.onHubStatusBoard = false;
      const shiftStart = new Date();
      shiftStart.setSeconds(0, 0);
      await prisma.user.update({
        where: { id: data.assignedSupervisorId },
        data: { shiftStartedAt: shiftStart },
      });
      if (!map.fieldDate) {
        patch.fieldDate = new Date();
      }
    }
  }

  if (data.fieldWorkStatus !== undefined) {
    patch.fieldWorkStatus = data.fieldWorkStatus;
    // Explicit board flag wins (assign sends false; status columns send true)
    if (data.onHubStatusBoard === undefined && data.assignedSupervisorId === undefined) {
      patch.onHubStatusBoard = true;
    }
    if (data.fieldWorkStatus === FieldWorkStatus.COMPLETED) {
      patch.supervisorStatus = SupervisorStatus.DONE;
      patch.fieldProgressPercent = 100;
      if (data.shiftLeaderApproved === undefined && !isShiftLeader && !isOps) {
        // Supervisors must answer the SL-approval question
        throw new Error("Confirm whether a shift leader approved this map");
      }
      if (isShiftLeader && data.shiftLeaderApproved === undefined) {
        patch.shiftLeaderApproved = true;
      }
    } else if (data.fieldWorkStatus === FieldWorkStatus.UNCOMPLETED) {
      patch.supervisorStatus = null;
      patch.shiftLeaderApproved = null;
    } else if (data.fieldWorkStatus === FieldWorkStatus.CANCELLED) {
      patch.supervisorStatus = null;
      patch.shiftLeaderApproved = null;
    }
  }

  if (data.onHubStatusBoard !== undefined) {
    patch.onHubStatusBoard = data.onHubStatusBoard;
  }

  // Return visit: schedule on that day as active field work (off status board)
  if (returnVisitDate) {
    patch.returnVisitAt = returnVisitDate;
    patch.fieldDate = returnVisitDate;
    patch.fieldWorkStatus = FieldWorkStatus.UNCOMPLETED;
    patch.onHubStatusBoard = false;
    patch.supervisorStatus = null;
    patch.shiftLeaderApproved = null;
    const hourLabel = returnVisitDate.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const base =
      (data.opsManagerComment ?? map.opsManagerComment)?.trim() ||
      (data.fieldWorkStatus === FieldWorkStatus.CANCELLED ? "Cancelled" : "Incomplete");
    const returnNote = `Return visit: ${hourLabel}`;
    patch.opsManagerComment = base.includes("Return visit:")
      ? base
      : `${base} — ${returnNote}`;
  }

  if (data.fieldProgressPercent !== undefined) {
    patch.fieldProgressPercent = data.fieldProgressPercent;
    // Don't auto-complete when marking uncompleted (may still report 100% then incomplete)
    const markingIncomplete =
      data.fieldWorkStatus === FieldWorkStatus.UNCOMPLETED && data.onHubStatusBoard === true;
    if (data.fieldProgressPercent === 100 && !markingIncomplete && !returnVisitDate) {
      patch.fieldWorkStatus = FieldWorkStatus.COMPLETED;
      patch.supervisorStatus = SupervisorStatus.DONE;
      patch.onHubStatusBoard = true;
    }
  }

  const actor = user.name;
  const mapLabel = map.mapNumber ?? mapId;

  const becameCompleted =
    patch.fieldWorkStatus === FieldWorkStatus.COMPLETED &&
    map.fieldWorkStatus !== FieldWorkStatus.COMPLETED;
  const becameCancelled =
    patch.fieldWorkStatus === FieldWorkStatus.CANCELLED &&
    map.fieldWorkStatus !== FieldWorkStatus.CANCELLED &&
    !returnVisitDate;
  // Onto Uncompleted column (from active field or from another status) — not assign/progress-only
  const movedOntoUncompletedBoard =
    data.fieldWorkStatus === FieldWorkStatus.UNCOMPLETED &&
    patch.onHubStatusBoard === true &&
    (!map.onHubStatusBoard || map.fieldWorkStatus !== FieldWorkStatus.UNCOMPLETED) &&
    !returnVisitDate;

  if (becameCompleted) {
    const slNote =
      patch.shiftLeaderApproved === false
        ? " — no shift leader approval"
        : patch.shiftLeaderApproved === true
          ? " — shift leader approved"
          : "";
    await logEvent(
      mapId,
      user.id,
      "hub_completed",
      `${mapLabel} field mapping complete — marked by ${actor}${slNote}`
    );
  } else if (becameCancelled) {
    await logEvent(mapId, user.id, "hub_cancelled", `${actor} marked ${mapLabel} cancelled in hub`);
  } else if (movedOntoUncompletedBoard) {
    const reason =
      data.opsManagerComment?.trim() ||
      map.opsManagerComment?.trim() ||
      null;
    const pct =
      data.fieldProgressPercent ??
      patch.fieldProgressPercent ??
      map.fieldProgressPercent;
    const parts = [`${actor} marked ${mapLabel} uncompleted`];
    if (pct != null) parts.push(`${pct}% done`);
    if (reason) parts.push(reason);
    await logEvent(
      mapId,
      user.id,
      "hub_uncompleted",
      parts.length > 1 ? `${parts[0]} — ${parts.slice(1).join(" · ")}` : parts[0]!
    );
  } else if (returnVisitDate) {
    await logEvent(
      mapId,
      user.id,
      "hub_return_scheduled",
      `${actor} scheduled return for ${mapLabel} at ${returnVisitDate.toISOString()}`
    );
  } else if (data.fieldProgressPercent !== undefined && !becameCompleted) {
    await logEvent(
      mapId,
      user.id,
      "hub_progress",
      `${actor} set ${mapLabel} progress to ${data.fieldProgressPercent}%`
    );
  } else if (data.assignedSupervisorId !== undefined) {
    const sup = data.assignedSupervisorId
      ? await prisma.user.findUnique({ where: { id: data.assignedSupervisorId } })
      : null;
    await logEvent(
      mapId,
      user.id,
      "hub_reassigned",
      sup ? `${actor} assigned to ${sup.name}` : `${actor} moved to unassigned`
    );
  }

  return prisma.map.update({
    where: { id: mapId },
    data: patch,
    include: hubMapIncludes,
  });
}

async function assertOnShiftToday(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { shiftStartedAt: true },
  });
  const start = user?.shiftStartedAt;
  if (!start || start < startOfToday() || start > endOfToday()) {
    throw new Error("You must be on today’s shift to do this");
  }
}

/** Assigned supervisor asks on-shift shift leaders to check this map (ready, before status). */
export async function requestSlCheck(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) throw new Error("Only field maps");
  if (map.assignedSupervisorId !== user.id && !isOpsManager(user)) {
    throw new Error("Only the assigned supervisor can ask for SL check");
  }
  if (map.onHubStatusBoard) {
    throw new Error("Ask for SL check before moving the map to a status column");
  }
  if ((map.fieldProgressPercent ?? 0) < 100) {
    throw new Error("Map must be at 100% progress before asking for an SL check");
  }
  if (map.slCheckStatus === SlCheckStatus.OPEN || map.slCheckStatus === SlCheckStatus.CLAIMED) {
    throw new Error("A shift-leader check is already in progress");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      slCheckStatus: SlCheckStatus.OPEN,
      slCheckRequestedById: user.id,
      slCheckRequestedAt: new Date(),
      slCheckClaimedById: null,
      slCheckClaimedAt: null,
      slCheckNote: null,
    },
    include: hubMapIncludes,
  });

  await logEvent(
    mapId,
    user.id,
    "sl_check_requested",
    `${user.name} asked shift leaders to check ${map.mapNumber}`
  );

  return updated;
}

/** First on-shift shift leader to claim wins. */
export async function claimSlCheck(mapId: string, user: AuthUser) {
  if (!userHasShiftLeaderRole(user)) {
    throw new Error("Only shift leaders can claim a check");
  }
  await assertOnShiftToday(user.id);

  const claimed = await prisma.map.updateMany({
    where: { id: mapId, slCheckStatus: SlCheckStatus.OPEN },
    data: {
      slCheckStatus: SlCheckStatus.CLAIMED,
      slCheckClaimedById: user.id,
      slCheckClaimedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    const current = await prisma.map.findUnique({ where: { id: mapId } });
    if (!current) throw new Error("Map not found");
    if (current.slCheckStatus === SlCheckStatus.CLAIMED) {
      throw new Error("This check was already taken by another shift leader");
    }
    throw new Error("No open SL check on this map");
  }

  await logEvent(mapId, user.id, "sl_check_claimed", `${user.name} claimed the SL check`);

  return prisma.map.findUniqueOrThrow({
    where: { id: mapId },
    include: hubMapIncludes,
  });
}

/** Claimed SL accepts the map or sends it back for corrections. */
export async function resolveSlCheck(
  mapId: string,
  user: AuthUser,
  decision: "accept" | "need_corrections",
  note?: string | null
) {
  if (!userHasShiftLeaderRole(user)) {
    throw new Error("Only shift leaders can resolve a check");
  }

  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.slCheckStatus !== SlCheckStatus.CLAIMED) {
    throw new Error("This check is not claimed");
  }
  if (map.slCheckClaimedById !== user.id && !isOpsManager(user)) {
    throw new Error("Only the shift leader who claimed this map can resolve it");
  }

  const cleanNote = note?.trim() || null;

  if (decision === "accept") {
    // Lightweight: SL says yes — supervisor still owns final status on the hub
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: {
        slCheckStatus: SlCheckStatus.ACCEPTED,
        slCheckNote: cleanNote,
        shiftLeaderApproved: true,
      },
      include: hubMapIncludes,
    });
    await logEvent(
      mapId,
      user.id,
      "sl_check_accepted",
      `${user.name} accepted check on ${map.mapNumber}${cleanNote ? ` — ${cleanNote}` : ""}`
    );
    return updated;
  }

  if (!cleanNote) {
    throw new Error("Add a short comment explaining why the check was not accepted");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      slCheckStatus: SlCheckStatus.NEEDS_CORRECTIONS,
      slCheckNote: cleanNote,
      shiftLeaderApproved: false,
      // Stay with the supervisor — they fix offline then can ask again
      onHubStatusBoard: false,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      opsManagerComment: `SL not accepted: ${cleanNote}`,
    },
    include: hubMapIncludes,
  });
  await logEvent(
    mapId,
    user.id,
    "sl_check_corrections",
    `${user.name} did not accept ${map.mapNumber} — ${cleanNote}`
  );
  return updated;
}

/** Cancel an open/claimed check (requesting supervisor or OPS). */
export async function cancelSlCheck(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  const isRequester = map.slCheckRequestedById === user.id || map.assignedSupervisorId === user.id;
  if (!isRequester && !isOpsManager(user)) {
    throw new Error("Not allowed to cancel this SL check");
  }
  if (
    map.slCheckStatus !== SlCheckStatus.OPEN &&
    map.slCheckStatus !== SlCheckStatus.CLAIMED
  ) {
    throw new Error("Nothing to cancel");
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      slCheckStatus: null,
      slCheckRequestedById: null,
      slCheckClaimedById: null,
      slCheckRequestedAt: null,
      slCheckClaimedAt: null,
      slCheckNote: null,
    },
    include: hubMapIncludes,
  });
  await logEvent(mapId, user.id, "sl_check_cancelled", `${user.name} cancelled the SL check request`);
  return updated;
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
