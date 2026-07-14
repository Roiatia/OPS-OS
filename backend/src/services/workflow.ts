import {
  MapPhase,
  MapStatus,
  TaskStatus,
  RoleName,
  WorkflowPhaseTarget,
  type Prisma,
} from "@prisma/client";
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
    })
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

/** Lean map graph — never includes attachment base64 blobs. */
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

const listMapIncludes = mapIncludes;

async function reloadMap(mapId: string) {
  return prisma.map.findUnique({ where: { id: mapId }, include: mapIncludes });
}

let qaBackfillInFlight: Promise<void> | null = null;

function scheduleQaBackfill(user: AuthUser) {
  if (qaBackfillInFlight) return;
  qaBackfillInFlight = backfillMissingQaAssignments(user)
    .catch((err) => console.error("QA backfill failed:", err))
    .finally(() => {
      qaBackfillInFlight = null;
    });
}

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

  const action =
    map.assignedInspectorId && map.assignedInspectorId !== inspectorId
      ? "reassigned_inspector"
      : "assigned_inspector";

  await prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: {
        assignedInspectorId: inspectorId,
        phase: isIntake ? MapPhase.INTAKE : map.phase,
        status: isIntake ? null : isReassign ? null : map.status,
        inspectorAssignAccepted: isIntake ? false : map.inspectorAssignAccepted,
      },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action,
        note: `${action === "reassigned_inspector" ? "Reassigned" : "Assigned"} to ${inspector.name}`,
      },
    });
    if (attachment) {
      await tx.mapAttachment.create({
        data: {
          mapId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          data: attachment.data,
          context: "assign_inspector",
          uploadedById: user.id,
        },
      });
      await tx.mapEvent.create({
        data: {
          mapId,
          userId: user.id,
          action: "attachment_added",
          note: attachment.fileName,
          metadata: JSON.stringify({ context: "assign_inspector" }),
        },
      });
    }
  });

  await maybeAutoAssignQa(mapId, user);
  await maybeAutoReleaseNewMap(mapId, user);
  return reloadMap(mapId);
}

function groupMapIdsByKey<T extends { mapId: string }>(
  items: T[],
  keyFn: (item: T) => string
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = groups.get(key);
    if (list) list.push(item.mapId);
    else groups.set(key, [item.mapId]);
  }
  return groups;
}

async function applyGroupedMapUpdates(
  groups: { mapIds: string[]; data: Prisma.MapUpdateManyMutationInput }[]
) {
  const ops = groups
    .filter((g) => g.mapIds.length > 0)
    .map((g) =>
      prisma.map.updateMany({
        where: { id: { in: g.mapIds } },
        data: g.data,
      })
    );
  if (ops.length === 0) return;
  await prisma.$transaction(ops);
}

function releasePhaseForTarget(
  target: WorkflowPhaseTarget | null | undefined
): MapPhase {
  const t = target ?? WorkflowPhaseTarget.PRE_UPLOAD;
  if (t === WorkflowPhaseTarget.UPLOADED) return MapPhase.FIELD;
  if (t === WorkflowPhaseTarget.POLISH) return MapPhase.POLISH;
  if (t === WorkflowPhaseTarget.POLISHED) return MapPhase.APPROVED;
  return MapPhase.INTAKE;
}

/** Bulk-release unreleased intake maps that already have an inspector. */
async function bulkReleaseIntakeMaps(mapIds: string[], user: AuthUser) {
  if (mapIds.length === 0) return;

  const maps = await prisma.map.findMany({
    where: {
      id: { in: mapIds },
      phase: MapPhase.INTAKE,
      releasedToPipeline: false,
      assignedInspectorId: { not: null },
    },
    select: { id: true, workflowPhaseTarget: true },
  });
  if (maps.length === 0) return;

  const byPhase = new Map<MapPhase, string[]>();
  for (const map of maps) {
    const phase = releasePhaseForTarget(map.workflowPhaseTarget);
    const list = byPhase.get(phase);
    if (list) list.push(map.id);
    else byPhase.set(phase, [map.id]);
  }

  await applyGroupedMapUpdates(
    [...byPhase.entries()].map(([phase, ids]) => ({
      mapIds: ids,
      data: { releasedToPipeline: true, phase },
    }))
  );

  await prisma.mapEvent.createMany({
    data: maps.map((m) => ({
      mapId: m.id,
      userId: user.id,
      action: "released_to_pipeline",
      note: "Map saved to pipeline by leader",
    })),
  });

  const phaseHistoryRows = maps.flatMap((m) => {
    const phase = releasePhaseForTarget(m.workflowPhaseTarget);
    if (phase === MapPhase.INTAKE) return [];
    const target = m.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD;
    return [
      {
        mapId: m.id,
        phase,
        userId: user.id,
        note: `Released to pipeline as ${target.toLowerCase().replace("_", " ")}`,
      },
    ];
  });

  if (phaseHistoryRows.length > 0) {
    await prisma.mapPhaseHistory.createMany({ data: phaseHistoryRows });
  }
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

  await applyGroupedMapUpdates(
    [...groupMapIdsByKey(assignments, (a) => a.inspectorId).entries()].map(
      ([inspectorId, ids]) => ({
        mapIds: ids,
        data: {
          assignedInspectorId: inspectorId,
          phase: MapPhase.INTAKE,
          status: null,
          inspectorAssignAccepted: false,
          qaAssignAccepted: false,
        },
      })
    )
  );

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
      await applyGroupedMapUpdates(
        [...groupMapIdsByKey(qaAssignments, (a) => a.userId).entries()].map(
          ([userId, ids]) => ({
            mapIds: ids,
            data: {
              assignedQaId: userId,
              qaAssignAccepted: false,
            },
          })
        )
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
/** Clear inspector + QA on unreleased intake maps so shuffle can be re-run. */
export async function bulkUnassignNewMaps(mapIds: string[], user: AuthUser) {
  if (mapIds.length === 0) throw new Error("No maps selected");

  const maps = await prisma.map.findMany({
    where: {
      id: { in: mapIds },
      phase: MapPhase.INTAKE,
      releasedToPipeline: false,
    },
    select: {
      id: true,
      mapNumber: true,
      assignedInspectorId: true,
      assignedQaId: true,
    },
  });

  if (maps.length === 0) {
    throw new Error("No new maps found to unassign");
  }

  const toClear = maps.filter((m) => m.assignedInspectorId || m.assignedQaId);
  if (toClear.length === 0) {
    return { ok: true as const, unassigned: 0 };
  }

  const ids = toClear.map((m) => m.id);

  await prisma.$transaction(async (tx) => {
    await tx.map.updateMany({
      where: { id: { in: ids } },
      data: {
        assignedInspectorId: null,
        assignedQaId: null,
        inspectorAssignAccepted: false,
        qaAssignAccepted: false,
        status: null,
      },
    });

    await tx.mapEvent.createMany({
      data: toClear.map((m) => ({
        mapId: m.id,
        userId: user.id,
        action: "bulk_unassigned",
        note: "Inspector and QA cleared for re-shuffle",
      })),
    });
  });

  return { ok: true as const, unassigned: toClear.length };
}

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

  await applyGroupedMapUpdates([
    ...[...groupMapIdsByKey(inspectorAssignments, (a) => a.userId).entries()].map(
      ([userId, ids]) => ({
        mapIds: ids,
        data: {
          assignedInspectorId: userId,
          inspectorAssignAccepted: false,
        },
      })
    ),
    ...[...groupMapIdsByKey(qaAssignments, (a) => a.userId).entries()].map(
      ([userId, ids]) => ({
        mapIds: ids,
        data: {
          assignedQaId: userId,
          qaAssignAccepted: false,
        },
      })
    ),
  ]);

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

  await bulkReleaseIntakeMaps(mapIds, user);

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

  const action =
    map.assignedQaId && map.assignedQaId !== qaId ? "reassigned_qa" : "assigned_qa";

  await prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: {
        assignedQaId: qaId,
        qaAssignAccepted: map.phase === MapPhase.INTAKE ? false : map.qaAssignAccepted,
      },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action,
        note: `${action === "reassigned_qa" ? "Reassigned" : "Assigned"} to ${qa.name}`,
      },
    });
    if (attachment) {
      await tx.mapAttachment.create({
        data: {
          mapId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          data: attachment.data,
          context: "assign_qa",
          uploadedById: user.id,
        },
      });
      await tx.mapEvent.create({
        data: {
          mapId,
          userId: user.id,
          action: "attachment_added",
          note: attachment.fileName,
          metadata: JSON.stringify({ context: "assign_qa" }),
        },
      });
    }
  });

  await maybeAutoReleaseNewMap(mapId, user);
  return reloadMap(mapId);
}

export async function releaseMapToPipeline(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.releasedToPipeline) {
    return reloadMap(mapId);
  }
  if (map.phase !== MapPhase.INTAKE) {
    throw new Error("This map cannot be saved from the new maps box");
  }

  if (map.assignedInspectorId && !map.assignedQaId) {
    await maybeAutoAssignQa(mapId, user);
  }

  const target = map.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD;
  const releasePhase = releasePhaseForTarget(target);

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

  return prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: {
        assignedInspectorId: null,
        status: null,
        inspectorAssignAccepted: false,
      },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "unassigned_inspector",
        note: "Inspector removed from map",
      },
    });
    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
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

  return prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: {
        assignedQaId: null,
        qaAssignAccepted: false,
      },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "unassigned_qa",
        note: "QA removed from map",
      },
    });
    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
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

  await prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: { inspectorAssignAccepted: true },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "inspector_assignment_accepted",
        note: "Inspector accepted assignment",
      },
    });
  });
  await maybeAdvanceFromIntake(mapId, user.id);

  return reloadMap(mapId);
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

  await prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: { qaAssignAccepted: true },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "qa_assignment_accepted",
        note: "QA accepted assignment",
      },
    });
  });
  await maybeAdvanceFromIntake(mapId, user.id);

  return reloadMap(mapId);
}

export async function cancelMap(mapId: string, user: AuthUser, note?: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (ARCHIVED_PHASES.includes(map.phase)) {
    throw new Error("Map is already archived");
  }

  return prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: { phase: MapPhase.CANCELLED },
    });
    await tx.mapPhaseHistory.create({
      data: { mapId, phase: MapPhase.CANCELLED, userId: user.id, note: note ?? "Map cancelled" },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "map_cancelled",
        note: note ?? "Map cancelled by leader",
      },
    });
    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
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

  await prisma.$transaction(async (tx) => {
    if ((status === MapStatus.FIX || status === MapStatus.APPROVED) && !map.assignedQaId) {
      await tx.map.update({
        where: { id: mapId },
        data: { assignedQaId: user.id },
      });
    }

    await tx.map.update({
      where: { id: mapId },
      data: {
        status,
        uploadApproved:
          status === MapStatus.APPROVED
            ? true
            : status === MapStatus.FIX
              ? false
              : map.uploadApproved,
      },
    });

    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "map_status",
        note: `Status → ${status}`,
        metadata: JSON.stringify({ status }),
      },
    });

    if (note?.trim()) {
      await tx.mapNote.create({
        data: { mapId, userId: user.id, body: note.trim() },
      });
      await tx.mapEvent.create({
        data: {
          mapId,
          userId: user.id,
          action: "note_added",
          note: note.trim().slice(0, 120),
        },
      });
    }

    if (status === MapStatus.FIX && attachment) {
      await tx.mapAttachment.create({
        data: {
          mapId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          data: attachment.data,
          context: "qa_fix",
          uploadedById: user.id,
        },
      });
    }
  });

  return reloadMap(mapId);
}

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

export async function addMapNote(mapId: string, userId: string, body: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  return prisma.$transaction(async (tx) => {
    await tx.mapNote.create({
      data: { mapId, userId, body },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId,
        action: "note_added",
        note: body.slice(0, 120),
      },
    });
    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
}

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

export async function completeFieldWork(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) throw new Error("Map is not in field phase");

  return prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: {
        phase: MapPhase.POLISH,
        status: null,
      },
    });
    await tx.mapPhaseHistory.create({
      data: {
        mapId,
        phase: MapPhase.POLISH,
        userId: user.id,
        note: "Polish phase started",
      },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "field_complete",
        note: "Uploaded to dashboard — polish started",
      },
    });
    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
}

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
  return prisma.$transaction(async (tx) => {
    const map = await tx.map.create({
      data: {
        mapNumber: data.mapNumber,
        jiraTicketId: data.jiraTicketId,
        client: data.client,
        area: data.area,
        description: data.description,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        phase: MapPhase.INTAKE,
      },
    });
    await tx.mapPhaseHistory.create({
      data: {
        mapId: map.id,
        phase: MapPhase.INTAKE,
        userId: user.id,
        note: "Map created from CS",
      },
    });
    await tx.mapEvent.create({
      data: {
        mapId: map.id,
        userId: user.id,
        action: "map_created",
        note: `From Jira ${data.jiraTicketId ?? ""}`,
      },
    });
    const created = await tx.map.findUnique({ where: { id: map.id }, include: mapIncludes });
    if (!created) throw new Error("Failed to load created map");
    return created;
  });
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
      ( [MapPhase.UPLOAD_REVIEW, MapPhase.QA_REVIEW] as MapPhase[]).includes(map.phase));
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

  return prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: { workflowPhaseTarget: target, phase: nextPhase },
    });

    if (phaseChanged) {
      await tx.mapPhaseHistory.create({
        data: {
          mapId,
          phase: nextPhase,
          userId: user.id,
          note: `Station → ${target}`,
        },
      });
    }

    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "station_updated",
        note: `Station set to ${target}`,
      },
    });

    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
}

function phaseForStationTarget(
  target: WorkflowPhaseTarget,
  current: MapPhase,
  released: boolean
): MapPhase {
  switch (target) {
    case WorkflowPhaseTarget.PRE_UPLOAD:
      if (([MapPhase.INTAKE, MapPhase.PREP, MapPhase.UPLOAD_REVIEW] as MapPhase[]).includes(current)) {
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

  return prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: mapId },
      data: { dueDate: dueDate ? new Date(dueDate) : null },
    });
    await tx.mapEvent.create({
      data: {
        mapId,
        userId: user.id,
        action: "due_date_updated",
        note: dueDate ? `Deadline set to ${dueDate}` : "Deadline cleared",
      },
    });
    return tx.map.findUnique({ where: { id: mapId }, include: mapIncludes });
  });
}

export async function getAttachmentForUser(attachmentId: string, user: AuthUser) {
  const attachment = await prisma.mapAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      uploadedBy: { select: { id: true, name: true } },
    },
  });
  if (!attachment) return null;

  const map = await getMapForUser(attachment.mapId, user);
  if (!map) return null;

  return attachment;
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
