import { MapPhase, MapStatus, TaskStatus, RoleName, WorkflowPhaseTarget } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";
import { hasRole, isLeaderOrAdmin } from "../lib/types.js";

export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  data: string;
}

const ARCHIVED_PHASES: MapPhase[] = [MapPhase.APPROVED, MapPhase.CANCELLED];

/** Append an activity-log event for a map. */
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

/** Record that a map entered a workflow phase. */
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

/** Count active maps per QA user id. */
async function loadQaWorkload(qaIds: string[]): Promise<Map<string, number>> {
  const workload = new Map<string, number>();
  for (const id of qaIds) workload.set(id, 0);
  if (qaIds.length === 0) return workload;

  const activeCounts = await prisma.map.groupBy({
    by: ["assignedQaId"],
    where: {
      assignedQaId: { in: qaIds },
      phase: { notIn: ARCHIVED_PHASES },
    },
    _count: { _all: true },
  });

  for (const row of activeCounts) {
    if (row.assignedQaId) {
      workload.set(row.assignedQaId, row._count._all);
    }
  }

  return workload;
}

/** List Graphic QA users (optionally filtered by ids). */
async function listQaMembers(qaIds?: string[]) {
  return prisma.user.findMany({
    where: {
      ...(qaIds?.length ? { id: { in: qaIds } } : {}),
      roles: { some: { role: RoleName.GRAPHIC_QA } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Auto-assign QA from the least-loaded member when none is set yet. */
async function maybeAutoAssignQa(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map || map.assignedQaId) return;

  const qaMembers = await listQaMembers();
  if (qaMembers.length === 0) return;

  const workload = await loadQaWorkload(qaMembers.map((m) => m.id));
  const [pick] = buildBalancedAssignments([{ id: mapId }], qaMembers, workload);
  if (!pick) return;

  const isIntake = map.phase === MapPhase.INTAKE;
  await prisma.map.update({
    where: { id: mapId },
    data: {
      assignedQaId: pick.userId,
      qaAssignAccepted: isIntake ? false : map.qaAssignAccepted,
    },
  });

  await logEvent(
    mapId,
    user.id,
    "assigned_qa",
    `Auto-assigned to ${pick.userName} (least loaded)`,
    { source: "auto" }
  );
}

/** Batch auto-assign QA for maps missing a reviewer. */
async function autoAssignQaForMaps(maps: { id: string }[], qaIds?: string[]) {
  if (maps.length === 0) return [];

  const qaMembers = await listQaMembers(qaIds);
  if (qaMembers.length === 0) return [];

  const workload = await loadQaWorkload(qaMembers.map((m) => m.id));
  return buildBalancedAssignments(maps, qaMembers, workload);
}

/**
 * Repair path: maps that have an inspector but no QA (e.g. assigned before
 * auto-QA shipped, or after a QA unassign). Assigns least-loaded QA.
 */
async function backfillMissingQaAssignments(user: AuthUser) {
  const maps = await prisma.map.findMany({
    where: {
      phase: { notIn: ARCHIVED_PHASES },
      assignedInspectorId: { not: null },
      assignedQaId: null,
    },
    select: { id: true, phase: true },
    orderBy: { mapNumber: "asc" },
  });
  if (maps.length === 0) return;

  const qaAssignments = await autoAssignQaForMaps(maps);
  if (qaAssignments.length === 0) return;

  await prisma.$transaction(
    qaAssignments.map(({ mapId, userId }) => {
      const map = maps.find((m) => m.id === mapId);
      const isIntake = map?.phase === MapPhase.INTAKE;
      return prisma.map.update({
        where: { id: mapId },
        data: {
          assignedQaId: userId,
          ...(isIntake ? { qaAssignAccepted: false } : {}),
        },
      });
    }),
    { timeout: 60_000 }
  );

  await prisma.mapEvent.createMany({
    data: qaAssignments.map(({ mapId, userName }) => ({
      mapId,
      userId: user.id,
      action: "assigned_qa",
      note: `Auto-assigned to ${userName} (least loaded · backfill)`,
    })),
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
      status: MapStatus.ACCEPTED,
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

/** Persist a base64 file attachment on a map. */
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

/** Detail/mutation responses: full related rows, including base64 attachment blobs. */
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

/**
 * List endpoints: same relations as detail, but attachment `data` (base64) is
 * omitted and events are capped — keeps GET /maps payloads smaller.
 */
const listMapIncludes = {
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
    take: 10,
  },
  phaseHistory: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { enteredAt: "asc" as const },
  },
  attachments: {
    select: {
      id: true,
      mapId: true,
      fileName: true,
      mimeType: true,
      context: true,
      uploadedById: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  notes: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

let qaBackfillInFlight: Promise<void> | null = null;

/** Fire-and-forget QA backfill so listMaps stays responsive. */
function scheduleQaBackfill(user: AuthUser) {
  if (qaBackfillInFlight) return;
  qaBackfillInFlight = backfillMissingQaAssignments(user)
    .catch((err) => console.error("QA backfill failed:", err))
    .finally(() => {
      qaBackfillInFlight = null;
    });
}

/** Active maps visible to this user (role-filtered). */
export async function listMapsForUser(user: AuthUser) {
  if (isLeaderOrAdmin(user) || hasRole(user, RoleName.OPS_ADMIN)) {
    scheduleQaBackfill(user);
    return prisma.map.findMany({
      where: { phase: { notIn: ARCHIVED_PHASES } },
      include: listMapIncludes,
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
      include: listMapIncludes,
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
          { status: { not: null } },
          { tasks: { some: { assignedToId: user.id } } },
        ],
      },
      include: listMapIncludes,
      orderBy: { updatedAt: "desc" },
    });
  }

  return [];
}

/** Approved/cancelled maps for leaders/admins. */
export async function listHistoryMaps(user: AuthUser) {
  if (!isLeaderOrAdmin(user) && !hasRole(user, RoleName.OPS_ADMIN)) {
    throw new Error("Not allowed to view history");
  }

  return prisma.map.findMany({
    where: { phase: { in: ARCHIVED_PHASES } },
    include: listMapIncludes,
    orderBy: { updatedAt: "desc" },
  });
}

/** Full map detail if the user is allowed to see it. */
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
      map.status !== null ||
      map.tasks.some((t) => t.assignedToId === user.id);
    if (qaAccess) return map;
  }

  return null;
}

/** Assign an inspector to a map (leader/admin). */
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
      status: isIntake ? null : isReassign ? null : map.status,
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

  await maybeAutoAssignQa(mapId, user);
  await maybeAutoReleaseNewMap(mapId, user);
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

/** Balance-assign inspectors across selected maps. */
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
        status: null,
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

  const mapsAfterInspector = await prisma.map.findMany({
    where: { id: { in: mapIds }, assignedQaId: null },
    select: { id: true },
    orderBy: { mapNumber: "asc" },
  });
  if (mapsAfterInspector.length > 0) {
    const qaAssignments = await autoAssignQaForMaps(mapsAfterInspector);
    if (qaAssignments.length > 0) {
      await prisma.$transaction(
        qaAssignments.map(({ mapId, userId }) =>
          prisma.map.update({
            where: { id: mapId },
            data: {
              assignedQaId: userId,
              qaAssignAccepted: false,
            },
          })
        ),
        { timeout: 60_000 }
      );
      await prisma.mapEvent.createMany({
        data: qaAssignments.map(({ mapId, userName }) => ({
          mapId,
          userId: user.id,
          action: "assigned_qa",
          note: `Auto-assigned to ${userName} (least loaded)`,
        })),
      });
    }
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

/**
 * Server-side shuffle helper (same idea as frontend assignment.ts):
 * repeatedly give the next map to the member with the lowest workload count.
 * Mutates `workload` in place so callers can reuse it across inspector + QA passes.
 */
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

/** Summarize assignment counts per user for API responses. */
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

/**
 * Balanced inspector + QA assignment for unreleased intake maps.
 * Only assigns missing roles; does not reassign maps that already have someone.
 * Assignments start with *AssignAccepted=false so both roles must Accept.
 */
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
    qaMembers = await listQaMembers(qaIds.length > 0 ? qaIds : undefined);
    if (qaMembers.length === 0) throw new Error("No QA members available for auto-assign");

    const memberIds = qaMembers.map((m) => m.id);
    const counts = await loadQaWorkload(memberIds);
    for (const [id, count] of counts) qaWorkload.set(id, count);
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
      note:
        qaIds.length > 0
          ? `Shuffle assigned to ${userName}`
          : `Auto-assigned to ${userName} (least loaded)`,
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

/** Assign a QA reviewer to a map. */
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

/**
 * Leader "Save to pipeline": flip releasedToPipeline and optionally jump phase
 * based on workflowPhaseTarget (CSV imports can already be mid-station).
 * Still INTAKE + PRE_UPLOAD → stays INTAKE but leaves the new-maps box.
 */
export async function releaseMapToPipeline(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.releasedToPipeline) {
    return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  }
  if (map.phase !== MapPhase.INTAKE) {
    throw new Error("This map cannot be saved from the new maps box");
  }

  // Prefer having QA before the map shows in the pipeline table.
  if (map.assignedInspectorId && !map.assignedQaId) {
    await maybeAutoAssignQa(mapId, user);
  }

  // Station target → concrete phase when releasing mid-flow imports.
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

/**
 * Assigning an inspector on an unreleased intake map auto-releases it so the
 * leader does not need a separate "Save to pipeline" click.
 */
async function maybeAutoReleaseNewMap(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) return;
  if (map.phase !== MapPhase.INTAKE || map.releasedToPipeline) return;
  if (!map.assignedInspectorId) return;
  await releaseMapToPipeline(mapId, user);
}

/** Clear the inspector assignment on a map. */
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
      status: null,
      inspectorAssignAccepted: false,
    },
  });

  await logEvent(mapId, user.id, "unassigned_inspector", "Inspector removed from map");
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

/** Clear the QA assignment on a map. */
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

/** Inspector accepts their map assignment. */
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

/** QA accepts their map assignment. */
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

/** Cancel a map and move it to CANCELLED. */
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

/** Permanently delete one map. */
export async function deleteMap(mapId: string, _user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase === MapPhase.APPROVED) {
    throw new Error("Approved maps cannot be deleted");
  }

  await prisma.map.delete({ where: { id: mapId } });
  return { ok: true as const };
}

/** Permanently delete many maps. */
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

/**
 * Shared status field used by both inspector and QA UIs.
 * FIX requires a note (+ optional attachment); APPROVED/FIX also ensure
 * the acting user is recorded as QA when missing.
 */
export async function updateMapStatus(
  mapId: string,
  status: MapStatus,
  user: AuthUser,
  note?: string,
  attachment?: AttachmentInput
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  if (status === MapStatus.FIX && !note?.trim()) {
    throw new Error("A fix description is required");
  }

  // Approve / request-fix imply this user is acting as QA.
  if (status === MapStatus.FIX || status === MapStatus.APPROVED) {
    await ensureQaAssigned(mapId, user.id);
  }

  await prisma.map.update({
    where: { id: mapId },
    data: {
      status,
      // Keep uploadApproved in sync with terminal QA outcomes.
      uploadApproved: status === MapStatus.APPROVED ? true : status === MapStatus.FIX ? false : map.uploadApproved,
    },
  });

  await logEvent(mapId, user.id, "map_status", `Status → ${status}`, { status });
  if (status === MapStatus.FIX && note?.trim()) {
    await addMapNote(mapId, user.id, note.trim());
    if (attachment) await saveAttachment(mapId, user.id, "qa_fix", attachment);
  } else if (note?.trim()) {
    await addMapNote(mapId, user.id, note.trim());
  }

  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

/** Inspector-facing status update on their assigned map. */
export async function updateInspectorStatus(
  mapId: string,
  status: MapStatus,
  user: AuthUser,
  note?: string
) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.assignedInspectorId !== user.id) {
    throw new Error("Not assigned to this map");
  }

  const allowed: MapStatus[] = [
    MapStatus.ACCEPTED,
    MapStatus.PROCESSING,
    MapStatus.DONE,
    MapStatus.FIX_DONE,
  ];
  if (!allowed.includes(status)) {
    throw new Error("Invalid inspector status");
  }

  return updateMapStatus(mapId, status, user, note);
}

/** Ensure assignedQaId is set to the given QA. */
async function ensureQaAssigned(mapId: string, qaId: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (map && !map.assignedQaId) {
    await prisma.map.update({
      where: { id: mapId },
      data: { assignedQaId: qaId },
    });
  }
}

/** Add a note to a map. */
export async function addMapNote(mapId: string, userId: string, body: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  await prisma.mapNote.create({
    data: { mapId, userId, body },
  });
  await logEvent(mapId, userId, "note_added", body.slice(0, 120));

  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

/** QA approve/reject upload review (pre-upload). */
export async function qaUploadDecision(
  mapId: string,
  approved: boolean,
  user: AuthUser,
  note?: string,
  attachment?: AttachmentInput
) {
  return qaPolishDecision(
    mapId,
    approved ? "approved" : "fix",
    user,
    note,
    attachment
  );
}

/** Mark field/dashboard work complete; advance toward polish. */
export async function completeFieldWork(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) throw new Error("Map is not in field phase");

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      phase: MapPhase.POLISH,
      status: null,
    },
    include: mapIncludes,
  });
  await logPhaseEntry(mapId, MapPhase.POLISH, user.id, "Polish phase started");
  await logEvent(mapId, user.id, "field_complete", "Uploaded to dashboard — polish started");
  return updated;
}

/** QA approve/fix after polish review. */
export async function qaPolishDecision(
  mapId: string,
  status: "fix" | "fix_done" | "approved",
  user: AuthUser,
  note?: string,
  attachment?: AttachmentInput
) {
  const mapStatus =
    status === "fix"
      ? MapStatus.FIX
      : status === "fix_done"
        ? MapStatus.FIX_DONE
        : MapStatus.APPROVED;

  if (status === "fix_done") {
    const map = await prisma.map.findUnique({ where: { id: mapId } });
    if (!map) throw new Error("Map not found");
    if (map.assignedInspectorId !== user.id && !isLeaderOrAdmin(user) && !hasRole(user, RoleName.OPS_ADMIN)) {
      throw new Error("Not assigned to this map");
    }
  }

  return updateMapStatus(mapId, mapStatus, user, note, attachment);
}

/** Create a task on a map. */
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

/** Update a task's status. */
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

/** Create a new map in INTAKE from Jira-style fields. */
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

/** Move map station/workflow phase target (pre-upload/uploaded/polish). */
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

/** Map a station target enum to the concrete MapPhase. */
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

/** Set or clear a map's due date. */
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

/** All users with graphics roles for assignment UIs. */
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
