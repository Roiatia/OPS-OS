import { MapPhase, InspectorStatus, QaStatus, TaskStatus, RoleName, WorkflowPhaseTarget } from "@prisma/client";
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

/** When both inspector and QA accept on INTAKE, advance to pre-upload (PREP). */
async function maybeAdvanceFromIntake(mapId: string, userId: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map || map.phase !== MapPhase.INTAKE) return;
  if (!map.assignedInspectorId || !map.assignedQaId) return;
  if (!map.inspectorAssignAccepted || !map.qaAssignAccepted) return;

  await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.PREP,
      inspectorStatus: InspectorStatus.ACCEPTED,
    },
  });
  await logPhaseEntry(
    mapId,
    MapPhase.PREP,
    userId,
    "Inspector and QA accepted assignment — pre-upload started"
  );
  await logEvent(mapId, userId, "phase_advanced", "INTAKE → PREP after team acceptance");
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
          {
            assignedInspectorId: user.id,
            OR: [{ phase: { not: MapPhase.INTAKE } }, { releasedToPipeline: true }],
          },
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
          {
            assignedQaId: user.id,
            OR: [{ phase: { not: MapPhase.INTAKE } }, { releasedToPipeline: true }],
          },
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
      (map.assignedQaId === user.id &&
        (map.phase !== MapPhase.INTAKE || map.releasedToPipeline)) ||
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

  const isIntake = map.phase === MapPhase.INTAKE;
  const isReassign = Boolean(map.assignedInspectorId && map.assignedInspectorId !== inspectorId);

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedInspectorId: inspectorId,
      phase: isIntake ? MapPhase.INTAKE : map.phase,
      inspectorStatus: isIntake ? null : isReassign ? null : map.inspectorStatus,
      qaStatus: isIntake ? null : map.qaStatus,
      inspectorAssignAccepted: isIntake ? false : map.inspectorAssignAccepted,
    },
    include: mapIncludes,
  });

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

  await maybeAutoReleaseNewMap(mapId, user);
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

  const operations = assignments.map(({ mapId, inspectorId }) =>
    prisma.map.update({
      where: { id: mapId },
      data: {
        assignedInspectorId: inspectorId,
        phase: MapPhase.INTAKE,
        inspectorStatus: null,
        qaStatus: null,
        inspectorAssignAccepted: false,
        qaAssignAccepted: false,
      },
    })
  );

  if (operations.length > 0) {
    await prisma.$transaction(operations, { timeout: 60_000 });
  }

  if (assignments.length > 0) {
    await prisma.mapEvent.createMany({
      data: assignments.map(({ mapId, inspectorName }) => ({
        mapId,
        userId: user.id,
        action: "assigned_inspector",
        note: `Shuffle assigned to ${inspectorName}`,
      })),
    });
  }

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

type ShuffleDistribution = {
  userId: string;
  userName: string;
  assigned: number;
  totalAfter: number;
};

function buildBalancedAssignments(
  maps: { id: string }[],
  members: { id: string; name: string }[],
  workload: Map<string, number>
): { mapId: string; userId: string; userName: string }[] {
  const assignments: { mapId: string; userId: string; userName: string }[] = [];
  for (const map of maps) {
    const pick = [...members].sort((a, b) => {
      const diff = (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    })[0]!;
    workload.set(pick.id, (workload.get(pick.id) ?? 0) + 1);
    assignments.push({ mapId: map.id, userId: pick.id, userName: pick.name });
  }
  return assignments;
}

function toDistribution(
  members: { id: string; name: string }[],
  assignments: { userId: string }[],
  initialWorkload: Map<string, number>
): ShuffleDistribution[] {
  return members.map((member) => {
    const assigned = assignments.filter((a) => a.userId === member.id).length;
    const current = initialWorkload.get(member.id) ?? 0;
    return {
      userId: member.id,
      userName: member.name,
      assigned,
      totalAfter: current + assigned,
    };
  });
}

/** Balanced inspector + QA assignment for unreleased intake maps. */
export async function shuffleAssignNewMaps(
  mapIds: string[],
  inspectorIds: string[],
  qaIds: string[],
  user: AuthUser
) {
  if (mapIds.length === 0) throw new Error("No maps selected");

  const maps = await prisma.map.findMany({
    where: { id: { in: mapIds } },
    orderBy: { mapNumber: "asc" },
  });
  if (maps.length !== mapIds.length) throw new Error("Some maps were not found");

  for (const map of maps) {
    if (map.phase !== MapPhase.INTAKE || map.releasedToPipeline) {
      throw new Error(`${map.mapNumber} is not a new map`);
    }
  }

  const mapsNeedingInspector = maps.filter((m) => !m.assignedInspectorId);
  const mapsNeedingQa = maps.filter((m) => !m.assignedQaId);

  if (mapsNeedingInspector.length > 0 && inspectorIds.length === 0) {
    throw new Error("Select at least one inspector");
  }
  if (mapsNeedingQa.length > 0 && qaIds.length === 0) {
    throw new Error("Select at least one QA member");
  }

  let inspectors: { id: string; name: string }[] = [];
  let qaMembers: { id: string; name: string }[] = [];
  const inspectorWorkload = new Map<string, number>();
  const qaWorkload = new Map<string, number>();

  if (mapsNeedingInspector.length > 0) {
    inspectors = await prisma.user.findMany({
      where: {
        id: { in: inspectorIds },
        roles: { some: { role: RoleName.MAPPING_INSPECTOR } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    if (inspectors.length === 0) throw new Error("No valid inspectors found");

    const inspectorCounts = await prisma.map.groupBy({
      by: ["assignedInspectorId"],
      where: {
        assignedInspectorId: { in: inspectorIds },
        phase: { notIn: ARCHIVED_PHASES },
      },
      _count: { _all: true },
    });
    for (const id of inspectorIds) inspectorWorkload.set(id, 0);
    for (const row of inspectorCounts) {
      if (row.assignedInspectorId) {
        inspectorWorkload.set(row.assignedInspectorId, row._count._all);
      }
    }
  }

  if (mapsNeedingQa.length > 0) {
    qaMembers = await prisma.user.findMany({
      where: {
        id: { in: qaIds },
        roles: { some: { role: RoleName.GRAPHIC_QA } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    if (qaMembers.length === 0) throw new Error("No valid QA members found");

    const qaCounts = await prisma.map.groupBy({
      by: ["assignedQaId"],
      where: {
        assignedQaId: { in: qaIds },
        phase: { notIn: ARCHIVED_PHASES },
      },
      _count: { _all: true },
    });
    for (const id of qaIds) qaWorkload.set(id, 0);
    for (const row of qaCounts) {
      if (row.assignedQaId) {
        qaWorkload.set(row.assignedQaId, row._count._all);
      }
    }
  }

  const initialInspectorWorkload = new Map(inspectorWorkload);
  const initialQaWorkload = new Map(qaWorkload);

  const inspectorAssignments = buildBalancedAssignments(
    mapsNeedingInspector,
    inspectors,
    inspectorWorkload
  );
  const qaAssignments = buildBalancedAssignments(mapsNeedingQa, qaMembers, qaWorkload);

  const updateOperations = [
    ...inspectorAssignments.map(({ mapId, userId }) =>
      prisma.map.update({
        where: { id: mapId },
        data: {
          assignedInspectorId: userId,
          inspectorAssignAccepted: false,
        },
      })
    ),
    ...qaAssignments.map(({ mapId, userId }) =>
      prisma.map.update({
        where: { id: mapId },
        data: {
          assignedQaId: userId,
          qaAssignAccepted: false,
        },
      })
    ),
  ];

  if (updateOperations.length > 0) {
    await prisma.$transaction(updateOperations, { timeout: 60_000 });
  }

  const eventRows = [
    ...inspectorAssignments.map(({ mapId, userName }) => ({
      mapId,
      userId: user.id,
      action: "assigned_inspector",
      note: `Shuffle assigned to ${userName}`,
    })),
    ...qaAssignments.map(({ mapId, userName }) => ({
      mapId,
      userId: user.id,
      action: "assigned_qa",
      note: `Shuffle assigned to ${userName}`,
    })),
  ];

  if (eventRows.length > 0) {
    await prisma.mapEvent.createMany({ data: eventRows });
  }

  for (const mapId of mapIds) {
    await maybeAutoReleaseNewMap(mapId, user);
  }

  return {
    inspectorAssigned: inspectorAssignments.length,
    qaAssigned: qaAssignments.length,
    inspectorDistribution: toDistribution(
      inspectors,
      inspectorAssignments,
      initialInspectorWorkload
    ),
    qaDistribution: toDistribution(qaMembers, qaAssignments, initialQaWorkload),
  };
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

  const assignablePhases: MapPhase[] = [
    MapPhase.INTAKE,
    MapPhase.PREP,
    MapPhase.UPLOAD_REVIEW,
    MapPhase.QA_REVIEW,
  ];
  if (!assignablePhases.includes(map.phase)) {
    throw new Error("Map cannot be assigned to QA in current phase");
  }
  if (map.phase === MapPhase.PREP && map.assignedQaId) {
    throw new Error("QA already assigned for this map");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedQaId: qaId,
      qaAssignAccepted: map.phase === MapPhase.INTAKE ? false : map.qaAssignAccepted,
    },
  });

  const action =
    map.assignedQaId && map.assignedQaId !== qaId ? "reassigned_qa" : "assigned_qa";
  await logEvent(
    mapId,
    user.id,
    action,
    `${action === "reassigned_qa" ? "Reassigned" : "Assigned"} to ${qa.name}`
  );

  if (attachment) {
    await saveAttachment(mapId, user.id, "assign_qa", attachment);
    await logEvent(mapId, user.id, "attachment_added", attachment.fileName, {
      context: "assign_qa",
    });
  }

  await maybeAutoReleaseNewMap(mapId, user);
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function releaseMapToPipeline(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.releasedToPipeline) {
    return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  }
  if (map.phase !== MapPhase.INTAKE) {
    throw new Error("This map cannot be saved from the new maps box");
  }

  const target = map.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD;
  const releasePhase =
    target === WorkflowPhaseTarget.UPLOADED
      ? MapPhase.FIELD
      : target === WorkflowPhaseTarget.POLISH
        ? MapPhase.POLISH
        : target === WorkflowPhaseTarget.POLISHED
          ? MapPhase.APPROVED
          : MapPhase.INTAKE;

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: { releasedToPipeline: true, phase: releasePhase },
    include: mapIncludes,
  });

  if (releasePhase !== MapPhase.INTAKE) {
    await logPhaseEntry(
      mapId,
      releasePhase,
      user.id,
      `Released to pipeline as ${target.toLowerCase().replace("_", " ")}`
    );
  }

  await logEvent(mapId, user.id, "released_to_pipeline", "Map saved to pipeline by leader");
  return updated;
}

/** When an inspector is assigned on an unreleased intake map, move it to the pipeline. */
async function maybeAutoReleaseNewMap(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) return;
  if (map.phase !== MapPhase.INTAKE || map.releasedToPipeline) return;
  if (!map.assignedInspectorId) return;
  await releaseMapToPipeline(mapId, user);
}

export async function unassignInspector(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Cannot unassign archived map");
  }
  const assignablePhases: MapPhase[] = [MapPhase.INTAKE, MapPhase.PREP, MapPhase.POLISH];
  if (!assignablePhases.includes(map.phase)) {
    throw new Error("Cannot unassign inspector in current phase");
  }
  if (!map.assignedInspectorId) {
    throw new Error("No inspector assigned");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedInspectorId: null,
      inspectorStatus: null,
      inspectorAssignAccepted: false,
    },
  });

  await logEvent(mapId, user.id, "unassigned_inspector", "Inspector removed from map");
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function unassignQa(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Cannot unassign archived map");
  }
  const assignablePhases: MapPhase[] = [
    MapPhase.INTAKE,
    MapPhase.PREP,
    MapPhase.UPLOAD_REVIEW,
    MapPhase.QA_REVIEW,
  ];
  if (!assignablePhases.includes(map.phase)) {
    throw new Error("Cannot unassign QA in current phase");
  }
  if (!map.assignedQaId) {
    throw new Error("No QA assigned");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedQaId: null,
      qaAssignAccepted: false,
    },
  });

  await logEvent(mapId, user.id, "unassigned_qa", "QA removed from map");
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function acceptInspectorAssignment(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.INTAKE) {
    throw new Error("Assignment acceptance only applies during intake");
  }
  if (!map.releasedToPipeline) {
    throw new Error("Map has not been released to the pipeline yet");
  }
  if (map.assignedInspectorId !== user.id) {
    throw new Error("Not assigned to this map");
  }
  if (map.inspectorAssignAccepted) {
    throw new Error("Assignment already accepted");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: { inspectorAssignAccepted: true },
  });
  await logEvent(mapId, user.id, "inspector_assignment_accepted", "Inspector accepted assignment");
  await maybeAdvanceFromIntake(mapId, user.id);

  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

export async function acceptQaAssignment(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.INTAKE) {
    throw new Error("Assignment acceptance only applies during intake");
  }
  if (!map.releasedToPipeline) {
    throw new Error("Map has not been released to the pipeline yet");
  }
  if (map.assignedQaId !== user.id) {
    throw new Error("Not assigned to this map");
  }
  if (map.qaAssignAccepted) {
    throw new Error("Assignment already accepted");
  }

  await prisma.map.update({
    where: { id: mapId },
    data: { qaAssignAccepted: true },
  });
  await logEvent(mapId, user.id, "qa_assignment_accepted", "QA accepted assignment");
  await maybeAdvanceFromIntake(mapId, user.id);

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

export async function deleteMap(mapId: string, _user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase === MapPhase.APPROVED) {
    throw new Error("Approved maps cannot be deleted");
  }

  await prisma.map.delete({ where: { id: mapId } });
  return { ok: true as const };
}

export async function deleteMaps(mapIds: string[], _user: AuthUser) {
  if (mapIds.length === 0) throw new Error("No maps selected");

  const maps = await prisma.map.findMany({ where: { id: { in: mapIds } } });
  if (maps.length !== mapIds.length) throw new Error("Some maps were not found");

  const approved = maps.filter((m) => m.phase === MapPhase.APPROVED);
  if (approved.length > 0) {
    throw new Error(
      `Cannot delete approved maps: ${approved.map((m) => m.mapNumber).join(", ")}`
    );
  }

  const result = await prisma.map.deleteMany({ where: { id: { in: mapIds } } });
  return { ok: true as const, deleted: result.count };
}

function inspectorCanUpdateStatus(map: {
  phase: MapPhase;
  qaStatus: QaStatus | null;
  workflowPhaseTarget: WorkflowPhaseTarget;
}): boolean {
  if (ARCHIVED_PHASES.includes(map.phase)) return false;
  const station = map.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD;
  if (
    station === WorkflowPhaseTarget.UPLOADED ||
    station === WorkflowPhaseTarget.POLISHED
  ) {
    return false;
  }
  if (map.qaStatus === QaStatus.FIX) return true;
  return (
    station === WorkflowPhaseTarget.PRE_UPLOAD ||
    station === WorkflowPhaseTarget.POLISH
  );
}

/** Align granular phase with the map's station when they have drifted apart. */
function normalizeInspectorWorkPhase(map: {
  phase: MapPhase;
  workflowPhaseTarget: WorkflowPhaseTarget;
}): MapPhase {
  const station = map.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD;

  if (station === WorkflowPhaseTarget.PRE_UPLOAD) {
    if ([MapPhase.INTAKE, MapPhase.PREP, MapPhase.UPLOAD_REVIEW].includes(map.phase)) {
      return map.phase;
    }
    return MapPhase.PREP;
  }

  if (station === WorkflowPhaseTarget.POLISH) {
    if ([MapPhase.POLISH, MapPhase.QA_REVIEW].includes(map.phase)) {
      return map.phase;
    }
    return MapPhase.POLISH;
  }

  return map.phase;
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
  if (!inspectorCanUpdateStatus(map)) {
    throw new Error("Inspector cannot update status at this station");
  }

  const station = map.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD;
  let phase = normalizeInspectorWorkPhase(map);

  if (
    status === InspectorStatus.DONE &&
    station === WorkflowPhaseTarget.PRE_UPLOAD &&
    phase === MapPhase.PREP &&
    map.qaStatus !== QaStatus.FIX
  ) {
    phase = MapPhase.UPLOAD_REVIEW;
  } else if (
    status === InspectorStatus.DONE &&
    station === WorkflowPhaseTarget.POLISH &&
    phase === MapPhase.POLISH
  ) {
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
        qaStatus: QaStatus.FIX,
        phase: MapPhase.UPLOAD_REVIEW,
        inspectorStatus: InspectorStatus.ACCEPTED,
        uploadApproved: false,
      },
      include: mapIncludes,
    });
    await logEvent(mapId, user.id, "upload_rejected", note ?? "QA requested fixes");
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
  await logPhaseEntry(mapId, MapPhase.FIELD, user.id, note ?? "Uploaded to dashboard");
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
  await logPhaseEntry(mapId, MapPhase.POLISH, user.id, "Polish phase started");
  await logEvent(mapId, user.id, "field_complete", "Uploaded to dashboard — polish started");
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
    const reviewPhase =
      map.phase === MapPhase.UPLOAD_REVIEW ? MapPhase.UPLOAD_REVIEW : MapPhase.QA_REVIEW;
    await prisma.map.update({
      where: { id: mapId },
      data: { qaStatus: QaStatus.FIX_DONE, phase: reviewPhase },
    });
    if (reviewPhase !== map.phase) {
      await logPhaseEntry(mapId, reviewPhase, user.id, note ?? "Fixes completed");
    }
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

export async function updateMapWorkflowPhaseTarget(
  mapId: string,
  target: WorkflowPhaseTarget,
  user: AuthUser
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Cannot change station on archived maps");
  }

  const isInspector =
    hasRole(user, RoleName.MAPPING_INSPECTOR) && map.assignedInspectorId === user.id;
  const isQa =
    hasRole(user, RoleName.GRAPHIC_QA) &&
    (map.assignedQaId === user.id ||
      [MapPhase.UPLOAD_REVIEW, MapPhase.QA_REVIEW].includes(map.phase));
  const isLeader = isLeaderOrAdmin(user);

  const isNewMapEdit =
    map.phase === MapPhase.INTAKE && !map.releasedToPipeline && isLeader;

  if (!isInspector && !isQa && !isLeader) {
    throw new Error("Not allowed to update station on this map");
  }
  if (map.phase === MapPhase.INTAKE && !map.releasedToPipeline && !isNewMapEdit) {
    throw new Error("Workflow phase can only be set on new maps by the team leader");
  }

  if (!Object.values(WorkflowPhaseTarget).includes(target)) {
    throw new Error("Invalid workflow phase");
  }

  const nextPhase = phaseForStationTarget(target, map.phase, map.releasedToPipeline);
  const phaseChanged = nextPhase !== map.phase;

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: { workflowPhaseTarget: target, phase: nextPhase },
    include: mapIncludes,
  });

  if (phaseChanged) {
    await logPhaseEntry(mapId, nextPhase, user.id, `Station → ${target}`);
  }

  await logEvent(mapId, user.id, "station_updated", `Station set to ${target}`);
  return updated;
}

function phaseForStationTarget(
  target: WorkflowPhaseTarget,
  current: MapPhase,
  released: boolean
): MapPhase {
  switch (target) {
    case WorkflowPhaseTarget.PRE_UPLOAD:
      if ([MapPhase.INTAKE, MapPhase.PREP, MapPhase.UPLOAD_REVIEW].includes(current)) {
        return current;
      }
      return released ? MapPhase.PREP : MapPhase.INTAKE;
    case WorkflowPhaseTarget.UPLOADED:
      return MapPhase.FIELD;
    case WorkflowPhaseTarget.POLISH:
      if (current === MapPhase.QA_REVIEW) return MapPhase.QA_REVIEW;
      return MapPhase.POLISH;
    case WorkflowPhaseTarget.POLISHED:
      return MapPhase.APPROVED;
    default:
      return current;
  }
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
