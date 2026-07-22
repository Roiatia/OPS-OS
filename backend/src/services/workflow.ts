import { Prisma, MapPhase, MapTask, MapStation, InspectorStatus, SupervisorStatus, FieldWorkStatus, QaStatus, TaskStatus, RoleName, SlCheckStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { mapListIncludes, mapDetailIncludes, mapHistoryIncludes } from "../lib/mapIncludes.js";
import { broadcastMapsInvalidate, broadcastMapsUpsert, withSuppressedBroadcasts } from "../lib/realtimeBus.js";
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
/** Approved maps leave the main board; cancelled stay visible (marked cancelled). */
const HIDDEN_FROM_ACTIVE_BOARD: MapPhase[] = [MapPhase.APPROVED];

/**
 * After a bulk mutation, re-read the affected maps in list shape and push them
 * as a single surgical `maps:upsert` so clients patch those rows in place
 * instead of refetching every board. Falls back to a coarse invalidate if the
 * read fails, so clients never end up with stale data.
 */
async function broadcastChangedMaps(mapIds: string[]): Promise<void> {
  if (mapIds.length === 0) return;
  try {
    const changed = await prisma.map.findMany({
      where: { id: { in: mapIds } },
      include: mapListIncludes,
    });
    if (changed.length > 0) broadcastMapsUpsert(changed);
    else broadcastMapsInvalidate();
  } catch {
    broadcastMapsInvalidate();
  }
}

// Resolved shapes of the reshaping read used to return mutation responses.
type MapDetailPayload = Prisma.MapGetPayload<{ include: typeof mapDetailIncludes }>;
type MapListPayload = Prisma.MapGetPayload<{ include: typeof mapListIncludes }>;

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

/**
 * Hub maps: only those already on the status board, or assigned and still in
 * progress. Mapping/fieldDate alone must NOT auto-load maps into the Hub —
 * intake will use a separate technique later.
 */
function hubMapsWhereClause() {
  return {
    phase: MapPhase.FIELD,
    uploadApproved: true,
    uploadCompletedAt: { not: null },
    AND: [
      {
        OR: [
          { fieldWorkStatus: { not: FieldWorkStatus.CANCELLED } },
          { fieldWorkStatus: FieldWorkStatus.CANCELLED, onHubStatusBoard: true },
        ],
      },
      {
        OR: [
          { onHubStatusBoard: true },
          {
            assignedSupervisorId: { not: null },
            fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
          },
        ],
      },
    ],
  };
}

function onShiftTodayWhereClause() {
  return {
    roles: { some: { role: { in: [...SUPERVISOR_ROLE_NAMES] } } },
    shiftStartedAt: { gte: startOfToday(), lte: endOfToday() },
  };
}

// Builders return the (unawaited) Prisma promise so callers can either await
// them directly or batch them into a single array-form `$transaction([...])`,
// collapsing multiple writes into one DB round-trip.
function buildLogEvent(
  mapId: string,
  userId: string,
  action: string,
  note?: string,
  metadata?: Record<string, unknown>
) {
  return prisma.mapEvent.create({
    data: {
      mapId,
      userId,
      action,
      note,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

async function logEvent(
  mapId: string,
  userId: string,
  action: string,
  note?: string,
  metadata?: Record<string, unknown>
) {
  await buildLogEvent(mapId, userId, action, note, metadata);
}

function buildLogPhaseEntry(
  mapId: string,
  phase: MapPhase,
  userId: string,
  note?: string
) {
  return prisma.mapPhaseHistory.create({
    data: { mapId, phase, userId, note },
  });
}

async function logPhaseEntry(
  mapId: string,
  phase: MapPhase,
  userId: string,
  note?: string
) {
  await buildLogPhaseEntry(mapId, phase, userId, note);
}

function buildSaveAttachment(
  mapId: string,
  userId: string,
  context: string,
  attachment: AttachmentInput
) {
  return prisma.mapAttachment.create({
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

function buildAddMapNote(mapId: string, userId: string, body: string) {
  return prisma.mapNote.create({
    data: { mapId, userId, body },
  });
}

/** Hub board + PATCH /hub — no events/notes/tasks (much faster over remote DB) */
const hubMapIncludes = {
  assignedInspector: { select: { id: true, name: true, email: true } },
  assignedQa: { select: { id: true, name: true, email: true } },
  assignedSupervisor: { select: { id: true, name: true, email: true } },
  swapOfferedBy: { select: { id: true, name: true } },
  slCheckRequestedBy: { select: { id: true, name: true } },
  slCheckClaimedBy: { select: { id: true, name: true } },
};

export async function listMapsForUser(user: AuthUser) {
  if (isLeaderOrAdmin(user)) {
    return prisma.map.findMany({
      where: { phase: { notIn: HIDDEN_FROM_ACTIVE_BOARD } },
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
        OR: [
          { assignedSupervisorId: user.id },
          // SL check claim: also show on claimer's Maps list (owner still has hub column)
          { slCheckStatus: "CLAIMED", slCheckClaimedById: user.id },
        ],
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

export async function createSwapOffer(mapIds: string[], user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can call for a swap");
  }

  const maps = await prisma.map.findMany({
    where: {
      id: { in: mapIds },
      assignedSupervisorId: user.id,
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      onHubStatusBoard: false,
    },
    select: { id: true, mapNumber: true },
  });
  if (maps.length === 0) {
    throw new Error("No eligible maps to offer");
  }

  const batchId = `swap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const ids = maps.map((m) => m.id);

  await prisma.$transaction([
    prisma.map.updateMany({
      where: { id: { in: ids } },
      data: {
        swapBatchId: batchId,
        swapOfferedAt: now,
        swapOfferedById: user.id,
      },
    }),
    prisma.mapEvent.createMany({
      data: maps.map((map) => ({
        mapId: map.id,
        userId: user.id,
        action: "swap_offer_created",
        note: `${user.name} called for a swap on ${map.mapNumber}`,
      })),
    }),
  ]);

  return { batchId, offered: maps.length };
}

/** Open swap offers visible to this user (excludes own + declined). */
export async function listOpenSwapOffers(user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    return [];
  }

  const declined = await prisma.swapOfferDecline.findMany({
    where: { userId: user.id },
    select: { batchId: true },
  });
  const declinedBatches = new Set(declined.map((d) => d.batchId));

  const maps = await prisma.map.findMany({
    where: {
      swapBatchId: { not: null },
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      onHubStatusBoard: false,
      NOT: { assignedSupervisorId: user.id },
    },
    include: {
      assignedSupervisor: { select: { id: true, name: true, email: true } },
      swapOfferedBy: { select: { id: true, name: true } },
    },
    orderBy: { swapOfferedAt: "asc" },
  });

  const byBatch = new Map<
    string,
    {
      batchId: string;
      offeredAt: string;
      from: { id: string; name: string };
      maps: Array<{
        id: string;
        mapNumber: string;
        client: string;
        assignedSupervisor: { id: string; name: string; email: string } | null;
      }>;
    }
  >();

  for (const map of maps) {
    const batchId = map.swapBatchId;
    if (!batchId || declinedBatches.has(batchId)) continue;
    const from = map.swapOfferedBy;
    if (!from) continue;
    let group = byBatch.get(batchId);
    if (!group) {
      group = {
        batchId,
        offeredAt: (map.swapOfferedAt ?? map.updatedAt).toISOString(),
        from: { id: from.id, name: from.name },
        maps: [],
      };
      byBatch.set(batchId, group);
    }
    group.maps.push({
      id: map.id,
      mapNumber: map.mapNumber,
      client: map.client,
      assignedSupervisor: map.assignedSupervisor,
    });
  }

  return [...byBatch.values()];
}

/** My open offers (so I can cancel). */
export async function listMySwapOffers(user: AuthUser) {
  if (!userHasSupervisorRole(user)) return [];

  const maps = await prisma.map.findMany({
    where: {
      swapBatchId: { not: null },
      swapOfferedById: user.id,
      assignedSupervisorId: user.id,
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    },
    include: {
      swapOfferedBy: { select: { id: true, name: true } },
    },
    orderBy: { swapOfferedAt: "asc" },
  });

  const byBatch = new Map<
    string,
    {
      batchId: string;
      offeredAt: string;
      maps: Array<{ id: string; mapNumber: string; client: string }>;
    }
  >();

  for (const map of maps) {
    const batchId = map.swapBatchId;
    if (!batchId) continue;
    let group = byBatch.get(batchId);
    if (!group) {
      group = {
        batchId,
        offeredAt: (map.swapOfferedAt ?? map.updatedAt).toISOString(),
        maps: [],
      };
      byBatch.set(batchId, group);
    }
    group.maps.push({
      id: map.id,
      mapNumber: map.mapNumber,
      client: map.client,
    });
  }

  return [...byBatch.values()];
}

/** Ask to take another supervisor's maps — owner must accept/reject. */
export async function createHelpAsk(mapIds: string[], user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can ask to help take maps");
  }

  const maps = await prisma.map.findMany({
    where: {
      id: { in: mapIds },
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      onHubStatusBoard: false,
      assignedSupervisorId: { not: null },
      helpAskBatchId: null,
      NOT: { assignedSupervisorId: user.id },
    },
    select: { id: true, mapNumber: true, assignedSupervisorId: true },
  });
  if (maps.length === 0) {
    throw new Error("No maps available to ask for");
  }

  const byOwner = new Map<string, typeof maps>();
  for (const map of maps) {
    const ownerId = map.assignedSupervisorId!;
    const list = byOwner.get(ownerId) ?? [];
    list.push(map);
    byOwner.set(ownerId, list);
  }

  const now = new Date();
  const batches: Array<{ batchId: string; asked: number; ownerId: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const [ownerId, ownerMaps] of byOwner) {
      const batchId = `help_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const ids = ownerMaps.map((m) => m.id);
      await tx.map.updateMany({
        where: { id: { in: ids } },
        data: {
          helpAskBatchId: batchId,
          helpAskAt: now,
          helpAskById: user.id,
        },
      });
      await tx.mapEvent.createMany({
        data: ownerMaps.map((map) => ({
          mapId: map.id,
          userId: user.id,
          action: "help_ask_created",
          note: `${user.name} asked to take ${map.mapNumber}`,
        })),
      });
      batches.push({ batchId, asked: ownerMaps.length, ownerId });
    }
  });

  return { batches, asked: maps.length };
}

/** Incoming help asks on my maps (I accept/reject). */
export async function listIncomingHelpAsks(user: AuthUser) {
  if (!userHasSupervisorRole(user)) return [];

  const maps = await prisma.map.findMany({
    where: {
      helpAskBatchId: { not: null },
      assignedSupervisorId: user.id,
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    },
    include: {
      helpAskBy: { select: { id: true, name: true } },
    },
    orderBy: { helpAskAt: "asc" },
  });

  const byBatch = new Map<
    string,
    {
      batchId: string;
      askedAt: string;
      from: { id: string; name: string };
      maps: Array<{ id: string; mapNumber: string; client: string }>;
    }
  >();

  for (const map of maps) {
    const batchId = map.helpAskBatchId;
    const from = map.helpAskBy;
    if (!batchId || !from) continue;
    let group = byBatch.get(batchId);
    if (!group) {
      group = {
        batchId,
        askedAt: (map.helpAskAt ?? map.updatedAt).toISOString(),
        from: { id: from.id, name: from.name },
        maps: [],
      };
      byBatch.set(batchId, group);
    }
    group.maps.push({
      id: map.id,
      mapNumber: map.mapNumber,
      client: map.client,
    });
  }

  return [...byBatch.values()];
}

/** My outgoing help asks (so I can cancel). */
export async function listMyHelpAsks(user: AuthUser) {
  if (!userHasSupervisorRole(user)) return [];

  const maps = await prisma.map.findMany({
    where: {
      helpAskBatchId: { not: null },
      helpAskById: user.id,
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    },
    include: {
      assignedSupervisor: { select: { id: true, name: true } },
    },
    orderBy: { helpAskAt: "asc" },
  });

  const byBatch = new Map<
    string,
    {
      batchId: string;
      askedAt: string;
      to: { id: string; name: string } | null;
      maps: Array<{ id: string; mapNumber: string; client: string }>;
    }
  >();

  for (const map of maps) {
    const batchId = map.helpAskBatchId;
    if (!batchId) continue;
    let group = byBatch.get(batchId);
    if (!group) {
      group = {
        batchId,
        askedAt: (map.helpAskAt ?? map.updatedAt).toISOString(),
        to: map.assignedSupervisor
          ? { id: map.assignedSupervisor.id, name: map.assignedSupervisor.name }
          : null,
        maps: [],
      };
      byBatch.set(batchId, group);
    }
    group.maps.push({
      id: map.id,
      mapNumber: map.mapNumber,
      client: map.client,
    });
  }

  return [...byBatch.values()];
}

function clearHelpAskData() {
  return {
    helpAskBatchId: null as string | null,
    helpAskAt: null as Date | null,
    helpAskById: null as string | null,
  };
}

/** Owner accepts — maps move to the requester. */
export async function acceptHelpAsk(batchId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can accept help asks");
  }

  const maps = await prisma.map.findMany({
    where: {
      helpAskBatchId: batchId,
      assignedSupervisorId: user.id,
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      helpAskById: { not: null },
    },
    select: { id: true, mapNumber: true, helpAskById: true },
  });
  if (maps.length === 0) {
    throw new Error("No help ask found for you to accept");
  }

  const requesterId = maps[0].helpAskById!;
  if (maps.some((m) => m.helpAskById !== requesterId)) {
    throw new Error("Invalid help ask batch");
  }

  const shiftStart = new Date();
  shiftStart.setSeconds(0, 0);
  const ids = maps.map((m) => m.id);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: requesterId },
      data: { shiftStartedAt: shiftStart },
    }),
    prisma.map.updateMany({
      where: { id: { in: ids } },
      data: {
        assignedSupervisorId: requesterId,
        supervisorStatus: null,
        swapBatchId: null,
        swapOfferedAt: null,
        swapOfferedById: null,
        onHubStatusBoard: false,
        ...clearHelpAskData(),
      },
    }),
    prisma.mapEvent.createMany({
      data: maps.map((map) => ({
        mapId: map.id,
        userId: user.id,
        action: "help_ask_accepted",
        note: `${user.name} accepted help — ${map.mapNumber} moved`,
      })),
    }),
  ]);

  return { accepted: maps.length };
}

/** Owner rejects the help ask. */
export async function rejectHelpAsk(batchId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can reject help asks");
  }

  const maps = await prisma.map.findMany({
    where: {
      helpAskBatchId: batchId,
      assignedSupervisorId: user.id,
    },
    select: { id: true, mapNumber: true },
  });
  if (maps.length === 0) {
    throw new Error("No help ask found for you to reject");
  }

  const ids = maps.map((m) => m.id);
  await prisma.$transaction([
    prisma.map.updateMany({
      where: { id: { in: ids } },
      data: clearHelpAskData(),
    }),
    prisma.mapEvent.createMany({
      data: maps.map((map) => ({
        mapId: map.id,
        userId: user.id,
        action: "help_ask_rejected",
        note: `${user.name} rejected help ask on ${map.mapNumber}`,
      })),
    }),
  ]);

  return { rejected: maps.length };
}

/** Requester cancels their own help ask. */
export async function cancelHelpAsk(batchId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can cancel help asks");
  }

  const maps = await prisma.map.findMany({
    where: {
      helpAskBatchId: batchId,
      helpAskById: user.id,
    },
    select: { id: true, mapNumber: true },
  });
  if (maps.length === 0) {
    throw new Error("No help ask found to cancel");
  }

  const ids = maps.map((m) => m.id);
  await prisma.$transaction([
    prisma.map.updateMany({
      where: { id: { in: ids } },
      data: clearHelpAskData(),
    }),
    prisma.mapEvent.createMany({
      data: maps.map((map) => ({
        mapId: map.id,
        userId: user.id,
        action: "help_ask_cancelled",
        note: `${user.name} cancelled help ask on ${map.mapNumber}`,
      })),
    }),
  ]);

  return { cancelled: maps.length };
}

/** Take one or more offered maps onto my shift. */
export async function takeSwapMaps(mapIds: string[], user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can take a swap");
  }

  const maps = await prisma.map.findMany({
    where: {
      id: { in: mapIds },
      swapBatchId: { not: null },
      phase: MapPhase.FIELD,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      onHubStatusBoard: false,
      NOT: { assignedSupervisorId: user.id },
    },
    select: { id: true, mapNumber: true },
  });
  if (maps.length === 0) {
    throw new Error("No offered maps to take");
  }

  const shiftStart = new Date();
  shiftStart.setSeconds(0, 0);
  const ids = maps.map((m) => m.id);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { shiftStartedAt: shiftStart },
    }),
    prisma.map.updateMany({
      where: { id: { in: ids } },
      data: {
        assignedSupervisorId: user.id,
        supervisorStatus: null,
        swapBatchId: null,
        swapOfferedAt: null,
        swapOfferedById: null,
        onHubStatusBoard: false,
        ...clearHelpAskData(),
      },
    }),
    prisma.mapEvent.createMany({
      data: maps.map((map) => ({
        mapId: map.id,
        userId: user.id,
        action: "swap_offer_taken",
        note: `${user.name} took swap for ${map.mapNumber}`,
      })),
    }),
  ]);

  return maps.length;
}

/** Hide this swap batch for me — others can still take it. */
export async function declineSwapOffer(batchId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can decline a swap");
  }
  if (!batchId.trim()) throw new Error("batchId required");

  await prisma.swapOfferDecline.upsert({
    where: {
      batchId_userId: { batchId, userId: user.id },
    },
    create: { batchId, userId: user.id },
    update: {},
  });

  return { declined: true };
}

/** Cancel my open offer (maps stay with me). */
export async function cancelSwapOffer(batchId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can cancel a swap");
  }

  const maps = await prisma.map.findMany({
    where: {
      swapBatchId: batchId,
      swapOfferedById: user.id,
      assignedSupervisorId: user.id,
    },
    select: { id: true, mapNumber: true },
  });
  if (maps.length === 0) {
    throw new Error("No open swap offer to cancel");
  }

  const ids = maps.map((m) => m.id);
  await prisma.$transaction([
    prisma.map.updateMany({
      where: { id: { in: ids } },
      data: {
        swapBatchId: null,
        swapOfferedAt: null,
        swapOfferedById: null,
      },
    }),
    prisma.mapEvent.createMany({
      data: maps.map((map) => ({
        mapId: map.id,
        userId: user.id,
        action: "swap_offer_cancelled",
        note: `${user.name} cancelled swap offer on ${map.mapNumber}`,
      })),
    }),
    prisma.swapOfferDecline.deleteMany({ where: { batchId } }),
  ]);

  return { cancelled: maps.length };
}

/** @deprecated use createSwapOffer / takeSwapMaps — kept for old clients */
export async function swapSupervisorMaps(
  mapIds: string[],
  toSupervisorId: string,
  user: AuthUser
) {
  void toSupervisorId;
  return createSwapOffer(mapIds, user).then((r) => r.offered);
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

  const results = await prisma.$transaction([
    prisma.map.update({
      where: { id: mapId },
      data: { releasedToGraphics: true },
    }),
    buildLogEvent(mapId, user.id, "released_to_graphics", "OPS sent map to graphics team"),
    prisma.map.findUnique({ where: { id: mapId }, include: mapListIncludes }),
  ]);
  return results[results.length - 1] as MapListPayload | null;
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

  // Bulk write phase. Instead of one UPDATE per map (600+ round-trips to a
  // remote ~250ms-RTT DB), group assignments by supervisor and issue ONE
  // updateMany per distinct supervisor — every map in a group receives the
  // same field values. Event rows collapse into a single createMany. All of it
  // runs in one array-form $transaction (no interactive idle timeout), so the
  // whole shuffle is atomic and costs only (#supervisors) + 1 statements.
  const mapIdsBySupervisor = new Map<string, string[]>();
  for (const { mapId, supervisorId } of assignments) {
    const list = mapIdsBySupervisor.get(supervisorId);
    if (list) list.push(mapId);
    else mapIdsBySupervisor.set(supervisorId, [mapId]);
  }

  const updateManyOps = [...mapIdsBySupervisor.entries()].map(([supervisorId, groupMapIds]) =>
    prisma.map.updateMany({
      where: { id: { in: groupMapIds } },
      data: {
        assignedSupervisorId: supervisorId,
        supervisorStatus: null,
        fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      },
    })
  );

  // createMany takes plain scalar rows (no nested relation builders), so build
  // the event rows directly rather than via buildLogEvent (which creates one
  // at a time).
  const eventRows = assignments.map(({ mapId, supervisorName }) => ({
    mapId,
    userId: user.id,
    action: "assigned_supervisor",
    note: `Shuffle assigned to ${supervisorName}`,
  }));

  await withSuppressedBroadcasts(() =>
    prisma.$transaction([
      ...updateManyOps,
      prisma.mapEvent.createMany({ data: eventRows }),
    ])
  );

  // Surgical realtime: push the exact changed rows so clients patch in place
  // instead of refetching every board.
  await broadcastChangedMaps(assignments.map((a) => a.mapId));

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
    include: mapHistoryIncludes,
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

  const action =
    map.assignedInspectorId && map.assignedInspectorId !== inspectorId
      ? "reassigned_inspector"
      : "assigned_inspector";

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.map.update({
      where: { id: mapId },
      data: {
        assignedInspectorId: inspectorId,
        phase: newPhase,
        inspectorStatus: isNewAssignment ? null : map.inspectorStatus,
        qaStatus: isNewAssignment ? null : map.qaStatus,
      },
    }),
  ];

  if (isNewAssignment && newPhase !== map.phase) {
    ops.push(buildLogPhaseEntry(mapId, MapPhase.PREP, user.id, `Assigned to ${inspector.name}`));
  }

  ops.push(
    buildLogEvent(
      mapId,
      user.id,
      action,
      `${action === "reassigned_inspector" ? "Reassigned" : "Assigned"} to ${inspector.name}`
    )
  );

  if (attachment) {
    ops.push(buildSaveAttachment(mapId, user.id, "assign_inspector", attachment));
    ops.push(
      buildLogEvent(mapId, user.id, "attachment_added", attachment.fileName, {
        context: "assign_inspector",
      })
    );
  }

  ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
  const results = await prisma.$transaction(ops);
  return results[results.length - 1] as MapDetailPayload | null;
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

  // Bulk write phase. Instead of one UPDATE + phaseHistory + event per map
  // (1800+ round-trips to a remote ~250ms-RTT DB), group assignments by
  // inspector and issue ONE updateMany per distinct inspector — every map in a
  // group receives the same field values. Phase-history and event rows each
  // collapse into a single createMany. All of it runs in one array-form
  // $transaction (no interactive idle timeout), so the whole shuffle is atomic
  // and costs only (#inspectors) + 2 statements.
  const mapIdsByInspector = new Map<string, string[]>();
  for (const { mapId, inspectorId } of assignments) {
    const list = mapIdsByInspector.get(inspectorId);
    if (list) list.push(mapId);
    else mapIdsByInspector.set(inspectorId, [mapId]);
  }

  const updateManyOps = [...mapIdsByInspector.entries()].map(([inspectorId, groupMapIds]) =>
    prisma.map.updateMany({
      where: { id: { in: groupMapIds } },
      data: {
        assignedInspectorId: inspectorId,
        phase: MapPhase.PREP,
        inspectorStatus: null,
        qaStatus: null,
      },
    })
  );

  // createMany takes plain scalar rows (no nested relation builders), so build
  // the phase-history and event rows directly rather than via the
  // buildLogPhaseEntry / buildLogEvent helpers (which create one at a time).
  const phaseHistoryRows = assignments.map(({ mapId, inspectorName }) => ({
    mapId,
    phase: MapPhase.PREP,
    userId: user.id,
    note: `Shuffle assigned to ${inspectorName}`,
  }));
  const eventRows = assignments.map(({ mapId, inspectorName }) => ({
    mapId,
    userId: user.id,
    action: "assigned_inspector",
    note: `Shuffle assigned to ${inspectorName}`,
  }));

  await withSuppressedBroadcasts(() =>
    prisma.$transaction([
      ...updateManyOps,
      prisma.mapPhaseHistory.createMany({ data: phaseHistoryRows }),
      prisma.mapEvent.createMany({ data: eventRows }),
    ])
  );

  // Surgical realtime: push the exact changed rows so clients patch in place
  // instead of refetching every board.
  await broadcastChangedMaps(assignments.map((a) => a.mapId));

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

// Reverse of shuffleAssignInspectors: return shuffle-assigned maps to the intake
// queue. Like shuffle, the route guard (leader/admin) is the role gate; we just
// validate a non-empty selection and only touch maps that are actually eligible.
export async function unassignInspectors(mapIds: string[], user: AuthUser) {
  if (mapIds.length === 0) throw new Error("No maps to unassign");

  const maps = await prisma.map.findMany({ where: { id: { in: mapIds } } });

  // Only maps a shuffle placed in PREP can be returned to the queue; skip the
  // rest silently rather than failing the whole batch.
  const eligibleIds = maps.filter((m) => m.phase === MapPhase.PREP).map((m) => m.id);

  if (eligibleIds.length > 0) {
    await withSuppressedBroadcasts(() =>
      prisma.$transaction([
        prisma.map.updateMany({
          where: { id: { in: eligibleIds } },
          data: {
            assignedInspectorId: null,
            phase: MapPhase.INTAKE,
            inspectorStatus: null,
            qaStatus: null,
          },
        }),
        prisma.mapEvent.createMany({
          data: eligibleIds.map((id) => ({
            mapId: id,
            userId: user.id,
            action: "unassigned_inspector",
            note: "Unassigned — returned to queue",
          })),
        }),
      ])
    );

    await broadcastChangedMaps(eligibleIds);
  }

  return { unassigned: eligibleIds.length };
}

// Reverse of shuffleAssignSupervisors: clear the supervisor from field maps.
export async function unassignSupervisors(mapIds: string[], user: AuthUser) {
  if (!isOpsManager(user)) {
    throw new Error("Only OPS manager can unassign supervisors");
  }
  if (mapIds.length === 0) throw new Error("No maps to unassign");

  const maps = await prisma.map.findMany({ where: { id: { in: mapIds } } });

  const eligibleIds = maps
    .filter((m) => m.phase === MapPhase.FIELD && m.assignedSupervisorId !== null)
    .map((m) => m.id);

  if (eligibleIds.length > 0) {
    await withSuppressedBroadcasts(() =>
      prisma.$transaction([
        prisma.map.updateMany({
          where: { id: { in: eligibleIds } },
          data: {
            assignedSupervisorId: null,
            supervisorStatus: null,
          },
        }),
        prisma.mapEvent.createMany({
          data: eligibleIds.map((id) => ({
            mapId: id,
            userId: user.id,
            action: "unassigned_supervisor",
            note: "Supervisor unassigned",
          })),
        }),
      ])
    );

    await broadcastChangedMaps(eligibleIds);
  }

  return { unassigned: eligibleIds.length };
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

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.map.update({
      where: { id: mapId },
      data: { assignedQaId: qaId },
    }),
    buildLogEvent(mapId, user.id, "assigned_qa", `Assigned to ${qa.name}`),
  ];

  if (attachment) {
    ops.push(buildSaveAttachment(mapId, user.id, "assign_qa", attachment));
    ops.push(
      buildLogEvent(mapId, user.id, "attachment_added", attachment.fileName, {
        context: "assign_qa",
      })
    );
  }

  ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
  const results = await prisma.$transaction(ops);
  return results[results.length - 1] as MapDetailPayload | null;
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
  // The assigned inspector owns this status, but the graphics team leader (and
  // OPS admin) may override it from their board to correct/nudge the pipeline.
  if (map.assignedInspectorId !== user.id && !isLeaderOrAdmin(user)) {
    throw new Error("Not assigned to this map");
  }
  if (map.phase !== MapPhase.PREP && map.phase !== MapPhase.POLISH) {
    throw new Error("Inspector status only applies during prep or polish");
  }

  let phase: MapPhase = map.phase;
  let resetQaStatus = false;
  if (status === InspectorStatus.DONE && map.phase === MapPhase.PREP) {
    phase = MapPhase.UPLOAD_REVIEW;
  } else if (status === InspectorStatus.DONE && map.phase === MapPhase.POLISH) {
    phase = MapPhase.QA_REVIEW;
    resetQaStatus = true;
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.map.update({
      where: { id: mapId },
      data: { inspectorStatus: status, phase, ...(resetQaStatus ? { qaStatus: null } : {}) },
    }),
  ];

  if (phase !== map.phase) {
    ops.push(buildLogPhaseEntry(mapId, phase, user.id, `Inspector status → ${status}`));
  }

  ops.push(buildLogEvent(mapId, user.id, "inspector_status", `Status → ${status}`, { status }));
  if (note?.trim()) {
    const body = note.trim();
    ops.push(buildAddMapNote(mapId, user.id, body));
    ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
  }

  ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
  const results = await prisma.$transaction(ops);
  return results[results.length - 1] as MapDetailPayload | null;
}

/**
 * Status transitions the graphics team leader (or OPS admin) may drive from the
 * assignment board — the same moves the assigned inspector / QA can make, but
 * unlocked for the leader so they can correct or advance a map. Each branch
 * reuses the canonical workflow function (which does the phase transition,
 * history + event logging, and — via the Prisma extension — broadcasts the
 * change to every connected client so all users see it live).
 */
export type LeaderStatusAction =
  | { kind: "inspector"; status: InspectorStatus }
  | { kind: "qa_review"; status: "fix" | "fix_done" | "approved" }
  | { kind: "upload_review"; approved: boolean };

export async function setMapStatusAsLeader(
  mapId: string,
  action: LeaderStatusAction,
  user: AuthUser,
  note?: string
) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Only the graphics team leader can change status here");
  }

  switch (action.kind) {
    case "inspector":
      if (!Object.values(InspectorStatus).includes(action.status)) {
        throw new Error("Invalid inspector status");
      }
      return updateInspectorStatus(mapId, action.status, user, note);
    case "upload_review":
      return qaUploadDecision(mapId, action.approved, user, note);
    case "qa_review":
      return qaPolishDecision(mapId, action.status, user, note);
    default:
      throw new Error("Invalid status action");
  }
}

export async function addMapNote(mapId: string, userId: string, body: string) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");

  const results = await prisma.$transaction([
    buildAddMapNote(mapId, userId, body),
    buildLogEvent(mapId, userId, "note_added", body.slice(0, 120)),
    prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }),
  ]);
  return results[results.length - 1] as MapDetailPayload | null;
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

  // Fold the previous ensureQaAssigned() read+update into the main update.
  const qaPatch = map.assignedQaId ? {} : { assignedQaId: user.id };

  if (!approved) {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.map.update({
        where: { id: mapId },
        data: {
          phase: MapPhase.PREP,
          inspectorStatus: null,
          uploadApproved: false,
          uploadCompletedAt: null,
          ...qaPatch,
        },
      }),
      buildLogPhaseEntry(mapId, MapPhase.PREP, user.id, note ?? "Upload rejected"),
      buildLogEvent(mapId, user.id, "upload_rejected", note ?? "Upload not approved"),
    ];
    if (note?.trim()) {
      const body = note.trim();
      ops.push(buildAddMapNote(mapId, user.id, body));
      ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
    }
    ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
    const results = await prisma.$transaction(ops);
    return results[results.length - 1] as MapDetailPayload | null;
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.map.update({
      where: { id: mapId },
      data: {
        phase: MapPhase.FIELD,
        uploadApproved: true,
        uploadCompletedAt: new Date(),
        qaStatus: null,
        supervisorStatus: null,
        ...qaPatch,
      },
    }),
    buildLogPhaseEntry(mapId, MapPhase.FIELD, user.id, note ?? "Upload approved"),
    buildLogEvent(mapId, user.id, "upload_approved", note ?? "Approved for dashboard upload"),
  ];
  if (note?.trim()) {
    const body = note.trim();
    ops.push(buildAddMapNote(mapId, user.id, body));
    ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
  }
  ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
  const results = await prisma.$transaction(ops);
  return results[results.length - 1] as MapDetailPayload | null;
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

  const action =
    map.assignedSupervisorId && map.assignedSupervisorId !== supervisorId
      ? "reassigned_supervisor"
      : "assigned_supervisor";

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.user.update({
      where: { id: supervisorId },
      data: { shiftStartedAt: shiftStart },
    }),
    prisma.map.update({
      where: { id: mapId },
      data: {
        assignedSupervisorId: supervisorId,
        supervisorStatus: null,
        fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
        onHubStatusBoard: false,
        fieldDate: map.fieldDate ?? new Date(),
        loomDone: false,
      },
    }),
    buildLogEvent(
      mapId,
      user.id,
      action,
      `${action === "reassigned_supervisor" ? "Reassigned" : "Assigned"} to ${supervisor.name}`
    ),
  ];

  if (attachment) {
    ops.push(buildSaveAttachment(mapId, user.id, "assign_supervisor", attachment));
    ops.push(
      buildLogEvent(mapId, user.id, "attachment_added", attachment.fileName, {
        context: "assign_supervisor",
      })
    );
  }

  ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapListIncludes }));
  const results = await prisma.$transaction(ops);
  return results[results.length - 1] as MapListPayload | null;
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

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.map.update({
      where: { id: mapId },
      data: {
        supervisorStatus: status,
        ...(status === SupervisorStatus.DONE
          ? { fieldWorkStatus: FieldWorkStatus.COMPLETED }
          : {}),
      },
    }),
    buildLogEvent(mapId, user.id, "supervisor_status", `Status → ${status}`, { status }),
  ];

  if (status === SupervisorStatus.DONE) {
    ops.push(
      buildLogEvent(
        mapId,
        user.id,
        "supervisor_field_done",
        note ?? "Field mapping complete — awaiting OPS manager review"
      )
    );
  }
  if (note?.trim()) {
    const body = note.trim();
    ops.push(buildAddMapNote(mapId, user.id, body));
    ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
  }

  ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
  const results = await prisma.$transaction(ops);
  return results[results.length - 1] as MapDetailPayload | null;
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
    // Fold the previous ensureQaAssigned() read+update into the main update.
    const qaPatch = map.assignedQaId ? {} : { assignedQaId: user.id };
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.map.update({
        where: { id: mapId },
        data: {
          qaStatus: QaStatus.FIX,
          phase: MapPhase.POLISH,
          inspectorStatus: InspectorStatus.ACCEPTED,
          ...qaPatch,
        },
      }),
      buildLogPhaseEntry(mapId, MapPhase.POLISH, user.id, note ?? "QA requested fixes"),
      buildLogEvent(mapId, user.id, "qa_fix", note ?? "QA requested fixes"),
    ];
    if (note?.trim()) {
      const body = note.trim();
      ops.push(buildAddMapNote(mapId, user.id, body));
      ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
    }
    ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
    const results = await prisma.$transaction(ops);
    return results[results.length - 1] as MapDetailPayload | null;
  }

  if (status === "fix_done") {
    if (map.qaStatus !== QaStatus.FIX) {
      throw new Error("No active fix request");
    }
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.map.update({
        where: { id: mapId },
        data: { qaStatus: QaStatus.FIX_DONE, phase: MapPhase.QA_REVIEW },
      }),
      buildLogPhaseEntry(mapId, MapPhase.QA_REVIEW, user.id, note ?? "Fixes completed"),
      buildLogEvent(mapId, user.id, "fix_done", note ?? "Inspector completed fixes"),
    ];
    if (note?.trim()) {
      const body = note.trim();
      ops.push(buildAddMapNote(mapId, user.id, body));
      ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
    }
    ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
    const results = await prisma.$transaction(ops);
    return results[results.length - 1] as MapDetailPayload | null;
  }

  if (status === "approved") {
    if (map.phase !== MapPhase.QA_REVIEW && map.qaStatus !== QaStatus.FIX_DONE) {
      throw new Error("Map is not ready for final approval");
    }
    // Fold the previous ensureQaAssigned() read+update into the main update.
    const qaPatch = map.assignedQaId ? {} : { assignedQaId: user.id };
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.map.update({
        where: { id: mapId },
        data: { qaStatus: QaStatus.APPROVED, phase: MapPhase.APPROVED, ...qaPatch },
      }),
      buildLogPhaseEntry(mapId, MapPhase.APPROVED, user.id, note ?? "QA approved polish"),
      buildLogEvent(mapId, user.id, "qa_approved", note ?? "QA approved polish"),
    ];
    if (note?.trim()) {
      const body = note.trim();
      ops.push(buildAddMapNote(mapId, user.id, body));
      ops.push(buildLogEvent(mapId, user.id, "note_added", body.slice(0, 120)));
    }
    ops.push(prisma.map.findUnique({ where: { id: mapId }, include: mapDetailIncludes }));
    const results = await prisma.$transaction(ops);
    return results[results.length - 1] as MapDetailPayload | null;
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

const MAP_TASKS = new Set<string>(Object.values(MapTask));
const MAP_STATIONS = new Set<string>(Object.values(MapStation));

/**
 * Set board Task and/or Station. Independent of MapPhase — no phase
 * restrictions; graphics team leader (or OPS admin) may change anytime.
 */
export async function setMapTaskStation(
  mapId: string,
  patch: { task?: MapTask; station?: MapStation },
  user: AuthUser
) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Only the graphics team leader can change task or station");
  }
  if (patch.task === undefined && patch.station === undefined) {
    throw new Error("task or station required");
  }
  if (patch.task !== undefined && !MAP_TASKS.has(patch.task)) {
    throw new Error("Invalid task");
  }
  if (patch.station !== undefined && !MAP_STATIONS.has(patch.station)) {
    throw new Error("Invalid station");
  }

  const existing = await prisma.map.findUnique({ where: { id: mapId } });
  if (!existing) throw new Error("Map not found");

  const map = await prisma.map.update({
    where: { id: mapId },
    data: {
      ...(patch.task !== undefined ? { task: patch.task } : {}),
      ...(patch.station !== undefined ? { station: patch.station } : {}),
    },
    include: mapDetailIncludes,
  });

  const parts: string[] = [];
  if (patch.task !== undefined && patch.task !== existing.task) parts.push(`task → ${patch.task}`);
  if (patch.station !== undefined && patch.station !== existing.station) {
    parts.push(`station → ${patch.station}`);
  }
  if (parts.length) {
    await logEvent(mapId, user.id, "task_station_updated", parts.join(", "));
  }
  return map;
}

/**
 * Set CSV "Map received" flag. Stores "v" when received, null when not.
 * Does not change phase — leaders/OPS update pipeline separately.
 */
export async function setMapReceived(mapId: string, received: boolean, user: AuthUser) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Only leaders or OPS managers can change map received");
  }

  const existing = await prisma.map.findUnique({ where: { id: mapId } });
  if (!existing) throw new Error("Map not found");
  if (existing.phase === MapPhase.CANCELLED) {
    throw new Error("Cannot change map received on a cancelled map");
  }

  const nextValue = received ? "v" : null;
  const map = await prisma.map.update({
    where: { id: mapId },
    data: { mapReceived: nextValue },
    include: mapDetailIncludes,
  });

  await logEvent(
    mapId,
    user.id,
    "map_received_updated",
    received ? "Map received" : "Not received yet"
  );
  return map;
}


export type SpreadsheetDatePatch = {
  scheduleAt?: string | null;
  mappingAt?: string | null;
  sentToStudioAt?: string | null;
  receivedFromStudioAt?: string | null;
  activationAt?: string | null;
  client?: string | null;
  batch?: string | null;
  area?: string | null;
  address?: string | null;
  mapperName?: string | null;
  polishStage?: string | null;
  opsManagerComment?: string | null;
  fieldWorkStatus?: "UNCOMPLETED" | "COMPLETED" | "CANCELLED" | null;
};

function parseOptionalIsoDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  d.setHours(0, 0, 0, 0);
  return d;
}

function toSpreadsheetDateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Edit spreadsheet / board fields from the maps table.
 * Mapping date also drives Hub fieldDate.
 */
export async function updateMapSpreadsheetDates(
  mapId: string,
  patch: SpreadsheetDatePatch,
  user: AuthUser
) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Only leaders or OPS managers can change spreadsheet dates");
  }

  const existing = await prisma.map.findUnique({ where: { id: mapId } });
  if (!existing) throw new Error("Map not found");
  if (existing.phase === MapPhase.CANCELLED) {
    throw new Error("Cannot change dates on a cancelled map");
  }

  const scheduleAt = parseOptionalIsoDate(patch.scheduleAt);
  const mappingAt = parseOptionalIsoDate(patch.mappingAt);
  const sentToStudioAt = parseOptionalIsoDate(patch.sentToStudioAt);
  const receivedFromStudioAt = parseOptionalIsoDate(patch.receivedFromStudioAt);
  const activationAt = parseOptionalIsoDate(patch.activationAt);

  const hasStringField =
    patch.client !== undefined ||
    patch.batch !== undefined ||
    patch.area !== undefined ||
    patch.address !== undefined ||
    patch.mapperName !== undefined ||
    patch.polishStage !== undefined ||
    patch.opsManagerComment !== undefined ||
    patch.fieldWorkStatus !== undefined;

  if (
    scheduleAt === undefined &&
    mappingAt === undefined &&
    sentToStudioAt === undefined &&
    receivedFromStudioAt === undefined &&
    activationAt === undefined &&
    !hasStringField
  ) {
    throw new Error("At least one field is required");
  }

  const data: Prisma.MapUpdateInput = {};
  const notes: string[] = [];

  const trimOrNull = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    return t ? t : null;
  };

  if (scheduleAt !== undefined) {
    data.scheduleAt = scheduleAt;
    data.scheduleDate = scheduleAt ? toSpreadsheetDateLabel(scheduleAt) : null;
    notes.push(scheduleAt ? `schedule → ${toSpreadsheetDateLabel(scheduleAt)}` : "schedule cleared");
  }
  if (mappingAt !== undefined) {
    data.mappingAt = mappingAt;
    data.mappingDate = mappingAt ? toSpreadsheetDateLabel(mappingAt) : null;
    // Hub uses fieldDate from the actual Mapping date
    data.fieldDate = mappingAt;
    notes.push(mappingAt ? `mapping → ${toSpreadsheetDateLabel(mappingAt)}` : "mapping cleared");
  }
  if (sentToStudioAt !== undefined) {
    data.sentToStudioAt = sentToStudioAt;
    data.sentToStudio = sentToStudioAt ? toSpreadsheetDateLabel(sentToStudioAt) : null;
    notes.push(
      sentToStudioAt
        ? `sent to studio → ${toSpreadsheetDateLabel(sentToStudioAt)}`
        : "sent to studio cleared"
    );
  }
  if (receivedFromStudioAt !== undefined) {
    data.receivedFromStudioAt = receivedFromStudioAt;
    data.receivedFromStudio = receivedFromStudioAt
      ? toSpreadsheetDateLabel(receivedFromStudioAt)
      : null;
    notes.push(
      receivedFromStudioAt
        ? `received from studio → ${toSpreadsheetDateLabel(receivedFromStudioAt)}`
        : "received from studio cleared"
    );
  }
  if (activationAt !== undefined) {
    data.activationAt = activationAt;
    data.activation = activationAt ? toSpreadsheetDateLabel(activationAt) : null;
    data.dueDate = activationAt;
    notes.push(
      activationAt
        ? `activation → ${toSpreadsheetDateLabel(activationAt)}`
        : "activation cleared"
    );
  }
  if (patch.client !== undefined) {
    const client = trimOrNull(patch.client);
    if (!client) throw new Error("Client cannot be empty");
    data.client = client;
    notes.push(`client → ${client}`);
  }
  if (patch.batch !== undefined) {
    data.batch = trimOrNull(patch.batch);
    notes.push(`batch → ${data.batch ?? "—"}`);
  }
  if (patch.area !== undefined) {
    data.area = trimOrNull(patch.area);
    notes.push(`address → ${data.area ?? "—"}`);
  }
  if (patch.address !== undefined) {
    data.address = trimOrNull(patch.address);
    if (patch.area === undefined) data.area = data.address;
    notes.push(`address field → ${data.address ?? "—"}`);
  }
  if (patch.mapperName !== undefined) {
    data.mapperName = trimOrNull(patch.mapperName);
    notes.push(`mapper → ${data.mapperName ?? "—"}`);
  }
  if (patch.polishStage !== undefined) {
    data.polishStage = trimOrNull(patch.polishStage);
    notes.push(`polish → ${data.polishStage ?? "—"}`);
  }
  if (patch.opsManagerComment !== undefined) {
    data.opsManagerComment = trimOrNull(patch.opsManagerComment);
    notes.push("supervisor note updated");
  }
  if (patch.fieldWorkStatus !== undefined && patch.fieldWorkStatus !== null) {
    data.fieldWorkStatus = patch.fieldWorkStatus as FieldWorkStatus;
    notes.push(`field status → ${patch.fieldWorkStatus}`);
  }

  const map = await prisma.map.update({
    where: { id: mapId },
    data,
    include: mapDetailIncludes,
  });

  if (notes.length) {
    await logEvent(mapId, user.id, "spreadsheet_dates_updated", notes.join(", "));
  }
  return map;
}

const PIPELINE_STAGES = new Set(["UPLOAD", "MAPPING", "POLISH", "ACTIVATION"]);

/**
 * Set business pipeline stage (Upload / Mapping / Polish / Activation) by updating phase.
 * Mapping → FIELD only enables Hub gates when a mapping/field date already exists.
 */
export async function setMapPipeline(
  mapId: string,
  stage: "UPLOAD" | "MAPPING" | "POLISH" | "ACTIVATION",
  user: AuthUser
) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Only graphics team leader or OPS managers can change pipeline");
  }
  if (!PIPELINE_STAGES.has(stage)) {
    throw new Error("Invalid pipeline stage");
  }

  const existing = await prisma.map.findUnique({ where: { id: mapId } });
  if (!existing) throw new Error("Map not found");
  if (existing.phase === MapPhase.CANCELLED) {
    throw new Error("Cannot change pipeline on a cancelled map");
  }

  let phase: MapPhase;
  const data: Prisma.MapUpdateInput = {};

  switch (stage) {
    case "UPLOAD":
      phase =
        existing.phase === MapPhase.UPLOAD_REVIEW ? MapPhase.UPLOAD_REVIEW : MapPhase.PREP;
      data.phase = phase;
      data.releasedToGraphics = true;
      break;
    case "MAPPING": {
      phase = MapPhase.FIELD;
      data.phase = phase;
      data.releasedToGraphics = true;
      const hasMappingDate = Boolean(existing.mappingAt || existing.fieldDate);
      if (hasMappingDate) {
        data.uploadApproved = true;
        data.uploadCompletedAt = existing.uploadCompletedAt ?? new Date();
        if (!existing.fieldDate && existing.mappingAt) {
          data.fieldDate = existing.mappingAt;
        }
      } else {
        // Enter FIELD without Hub eligibility until a mapping date exists.
        data.uploadApproved = false;
        data.uploadCompletedAt = null;
      }
      data.fieldWorkStatus = FieldWorkStatus.UNCOMPLETED;
      break;
    }
    case "POLISH":
      phase = MapPhase.POLISH;
      data.phase = phase;
      data.releasedToGraphics = true;
      data.task = MapTask.POLISH;
      break;
    case "ACTIVATION": {
      // Stay on the active Maps board — APPROVED archives to History (LIVE only).
      phase = MapPhase.POLISH;
      data.phase = phase;
      data.releasedToGraphics = true;
      data.task = MapTask.POLISH;
      data.uploadApproved = true;
      data.uploadCompletedAt = existing.uploadCompletedAt ?? new Date();
      data.fieldWorkStatus = FieldWorkStatus.COMPLETED;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      data.activationAt = today;
      data.activation = toSpreadsheetDateLabel(today);
      data.dueDate = today;
      break;
    }
  }

  const map = await prisma.map.update({
    where: { id: mapId },
    data,
    include: mapDetailIncludes,
  });

  if (phase !== existing.phase) {
    await logPhaseEntry(mapId, phase, user.id, `Pipeline → ${stage}`);
    await logEvent(mapId, user.id, "pipeline_updated", `Pipeline → ${stage}`);
  }
  return map;
}

/** Bulk set board Task and/or Station on many maps (no phase restrictions). */
export async function bulkSetMapTaskStation(
  mapIds: string[],
  patch: { task?: MapTask; station?: MapStation },
  user: AuthUser
) {
  if (!isLeaderOrAdmin(user)) {
    throw new Error("Only the graphics team leader can change task or station");
  }
  if (!mapIds.length) throw new Error("mapIds required");
  if (patch.task === undefined && patch.station === undefined) {
    throw new Error("task or station required");
  }
  if (patch.task !== undefined && !MAP_TASKS.has(patch.task)) {
    throw new Error("Invalid task");
  }
  if (patch.station !== undefined && !MAP_STATIONS.has(patch.station)) {
    throw new Error("Invalid station");
  }

  const uniqueIds = [...new Set(mapIds)];
  const data: Prisma.MapUpdateManyMutationInput = {};
  if (patch.task !== undefined) data.task = patch.task;
  if (patch.station !== undefined) data.station = patch.station;

  await prisma.map.updateMany({
    where: { id: { in: uniqueIds } },
    data,
  });

  const noteParts: string[] = [];
  if (patch.task !== undefined) noteParts.push(`task → ${patch.task}`);
  if (patch.station !== undefined) noteParts.push(`station → ${patch.station}`);
  const note = `Bulk ${noteParts.join(", ")} (${uniqueIds.length} maps)`;

  await prisma.mapEvent.createMany({
    data: uniqueIds.map((mapId) => ({
      mapId,
      userId: user.id,
      action: "task_station_updated",
      note,
    })),
  });

  broadcastMapsInvalidate();

  const maps = await prisma.map.findMany({
    where: { id: { in: uniqueIds } },
    include: mapListIncludes,
  });
  return { updated: maps.length, maps };
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

  // Claimed SL must answer before leaving shift — release stale claims
  await releaseStaleSlClaims();

  // Full board for everyone with hub access (managers, shift leaders, supervisors).
  // Drag/update is enforced in updateHubMap + frontend canDrag — supervisors
  // may only move maps assigned to them.
  return prisma.map.findMany({
    where: hubMapsWhereClause(),
    include: hubMapIncludes,
    orderBy: [{ fieldDate: "asc" }, { updatedAt: "desc" }],
  });
}

/**
 * If an SL claimed a check then left today's shift without Yes/No,
 * release the claim so another on-shift SL can take it.
 */
async function releaseStaleSlClaims() {
  const claimed = await prisma.map.findMany({
    where: {
      phase: MapPhase.FIELD,
      slCheckStatus: SlCheckStatus.CLAIMED,
      slCheckClaimedById: { not: null },
    },
    select: {
      id: true,
      mapNumber: true,
      fieldWorkStatus: true,
      shiftLeaderApproved: true,
      slCheckClaimedById: true,
      slCheckClaimedBy: { select: { id: true, name: true, shiftStartedAt: true } },
    },
  });

  const dayStart = startOfToday();
  const dayEnd = endOfToday();

  for (const map of claimed) {
    const start = map.slCheckClaimedBy?.shiftStartedAt;
    const onShift = !!start && start >= dayStart && start <= dayEnd;
    if (onShift) continue;

    const wasCompletedWithoutApproval =
      map.fieldWorkStatus === FieldWorkStatus.COMPLETED && map.shiftLeaderApproved === false;

    await prisma.map.update({
      where: { id: map.id },
      data: wasCompletedWithoutApproval
        ? {
            slCheckStatus: null,
            slCheckClaimedById: null,
            slCheckClaimedAt: null,
            slCheckRequestedById: null,
            slCheckRequestedAt: null,
            slCheckNote: null,
          }
        : {
            slCheckStatus: SlCheckStatus.OPEN,
            slCheckClaimedById: null,
            slCheckClaimedAt: null,
            slCheckNote: null,
          },
    });

    const who = map.slCheckClaimedBy?.name ?? "Shift leader";
    await logEvent(
      map.id,
      map.slCheckClaimedById!,
      "sl_check_released",
      `${who} left shift without answering — check released on ${map.mapNumber}`
    );
  }
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

  // OPS + shift leaders can reassign across Intake / supervisor columns
  if (!isOps && data.assignedSupervisorId !== undefined) {
    if (!isShiftLeader) {
      throw new Error("Only OPS manager or shift leader can reassign supervisors in the hub");
    }
    if (data.assignedSupervisorId) {
      const target = await prisma.user.findUnique({
        where: { id: data.assignedSupervisorId },
        include: { roles: true },
      });
      if (!target || !userHasSupervisorRole({ roles: target.roles.map((r) => r.role) })) {
        throw new Error("Target must be a supervisor or shift leader");
      }
    }
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
    slCheckStatus?: SlCheckStatus | null;
    slCheckRequestedById?: string | null;
    slCheckClaimedById?: string | null;
    slCheckRequestedAt?: Date | null;
    slCheckClaimedAt?: Date | null;
    slCheckNote?: string | null;
    swapBatchId?: string | null;
    swapOfferedAt?: Date | null;
    swapOfferedById?: string | null;
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
      // Clear any open swap offer when ownership changes
      patch.swapBatchId = null;
      patch.swapOfferedAt = null;
      patch.swapOfferedById = null;
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

  const movingOntoStatusBoard =
    data.fieldWorkStatus !== undefined &&
    data.assignedSupervisorId === undefined &&
    (data.onHubStatusBoard === true ||
      (data.onHubStatusBoard === undefined && data.fieldWorkStatus !== undefined));

  // Open / claimed SL check must be answered (Yes/No) before anyone moves the map
  if (
    movingOntoStatusBoard &&
    (map.slCheckStatus === SlCheckStatus.OPEN || map.slCheckStatus === SlCheckStatus.CLAIMED)
  ) {
    throw new Error(
      map.slCheckStatus === SlCheckStatus.CLAIMED
        ? "Shift leader must answer Yes or No before this map can be moved"
        : "Cancel or finish the SL check before moving this map"
    );
  }

  // After SL Yes: only the assigned owner (or OPS) moves the map — not the checking SL
  if (
    movingOntoStatusBoard &&
    map.slCheckStatus === SlCheckStatus.ACCEPTED &&
    !isOps &&
    !isAssignedSupervisor
  ) {
    throw new Error("Only the supervisor who owns this map can move it after SL approval");
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
      // Only auto-approve when the assigned owner (who is also SL) completes — not a checker
      if (
        isShiftLeader &&
        isAssignedSupervisor &&
        data.shiftLeaderApproved === undefined
      ) {
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

  // Owner moved after SL Yes — clear check workflow; keep shiftLeaderApproved
  if (
    (patch.onHubStatusBoard === true || data.onHubStatusBoard === true) &&
    map.slCheckStatus === SlCheckStatus.ACCEPTED
  ) {
    patch.slCheckStatus = null;
    patch.slCheckRequestedById = null;
    patch.slCheckClaimedById = null;
    patch.slCheckRequestedAt = null;
    patch.slCheckClaimedAt = null;
    patch.slCheckNote = null;
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
    const slCheckBlocksComplete =
      map.slCheckStatus === SlCheckStatus.OPEN || map.slCheckStatus === SlCheckStatus.CLAIMED;
    if (
      data.fieldProgressPercent === 100 &&
      !markingIncomplete &&
      !returnVisitDate &&
      !slCheckBlocksComplete
    ) {
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

/** Assigned supervisor reports that the mapper has not arrived — shows in OPS Updates. */
export async function reportMapperNotArrived(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  if (map.phase !== MapPhase.FIELD) throw new Error("Only field maps");
  if (!map.assignedSupervisorId) {
    throw new Error("Map must have an assigned supervisor");
  }
  if (map.fieldWorkStatus !== FieldWorkStatus.UNCOMPLETED) {
    throw new Error("Only active (uncompleted) maps");
  }

  if (map.assignedSupervisorId !== user.id) {
    throw new Error("Only the assigned supervisor can report that the mapper has not arrived");
  }

  const recent = await prisma.mapEvent.findFirst({
    where: {
      mapId,
      action: "mapper_not_arrived",
      createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    throw new Error("Already reported in the last 30 minutes");
  }

  await logEvent(
    mapId,
    user.id,
    "mapper_not_arrived",
    `${user.name}: mapper has not arrived yet for ${map.mapNumber}`
  );

  return prisma.map.findUnique({
    where: { id: mapId },
    include: hubMapIncludes,
  });
}

/** Assigned supervisor asks on-shift shift leaders to check this map (before status). */
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
  if (map.fieldWorkStatus === FieldWorkStatus.COMPLETED || map.fieldWorkStatus === FieldWorkStatus.CANCELLED) {
    throw new Error("Cannot ask for SL check on a completed or cancelled map");
  }
  // Shift leaders supervising their own maps check themselves — no Ask SL
  if (userHasShiftLeaderRole(user) && map.assignedSupervisorId === user.id) {
    throw new Error("Shift leaders do not need an SL check on their own maps");
  }
  if (map.assignedSupervisorId) {
    const owner = await prisma.user.findUnique({
      where: { id: map.assignedSupervisorId },
      include: { roles: true },
    });
    if (owner && userIsShiftLeader(owner)) {
      throw new Error("Shift leaders do not need an SL check on their own maps");
    }
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

/** First on-shift shift leader to claim wins.
 *  Also allows claiming completed maps that still need SL approval. */
export async function claimSlCheck(mapId: string, user: AuthUser) {
  if (!userHasShiftLeaderRole(user)) {
    throw new Error("Only shift leaders can claim a check");
  }
  await assertOnShiftToday(user.id);

  const current = await prisma.map.findUnique({ where: { id: mapId } });
  if (!current) throw new Error("Map not found");
  if (current.phase !== MapPhase.FIELD) throw new Error("Only field maps");
  if (current.slCheckStatus === SlCheckStatus.CLAIMED) {
    throw new Error("This check was already taken by another shift leader");
  }

  const needsApprovalReview =
    current.fieldWorkStatus === FieldWorkStatus.COMPLETED &&
    current.shiftLeaderApproved === false &&
    (current.slCheckStatus === null || current.slCheckStatus === SlCheckStatus.NEEDS_CORRECTIONS);

  const openCheck = current.slCheckStatus === SlCheckStatus.OPEN;

  if (!openCheck && !needsApprovalReview) {
    throw new Error("No open SL check on this map");
  }

  let claimedCount = 0;
  if (openCheck) {
    const claimed = await prisma.map.updateMany({
      where: { id: mapId, slCheckStatus: SlCheckStatus.OPEN },
      data: {
        slCheckStatus: SlCheckStatus.CLAIMED,
        slCheckClaimedById: user.id,
        slCheckClaimedAt: new Date(),
      },
    });
    claimedCount = claimed.count;
  } else {
    const claimed = await prisma.map.updateMany({
      where: {
        id: mapId,
        fieldWorkStatus: FieldWorkStatus.COMPLETED,
        shiftLeaderApproved: false,
        OR: [{ slCheckStatus: null }, { slCheckStatus: SlCheckStatus.NEEDS_CORRECTIONS }],
      },
      data: {
        slCheckStatus: SlCheckStatus.CLAIMED,
        slCheckClaimedById: user.id,
        slCheckClaimedAt: new Date(),
        slCheckRequestedById: current.slCheckRequestedById ?? current.assignedSupervisorId,
        slCheckRequestedAt: current.slCheckRequestedAt ?? new Date(),
      },
    });
    claimedCount = claimed.count;
  }
  if (claimedCount === 0) {
    throw new Error("This check was already taken by another shift leader");
  }

  await logEvent(mapId, user.id, "sl_check_claimed", `${user.name} claimed the SL check`);

  return prisma.map.findUniqueOrThrow({
    where: { id: mapId },
    include: hubMapIncludes,
  });
}

/**
 * Claimed SL must answer Yes or No (must be on today's shift).
 * Yes → map is completed with SL approval.
 * No → if under a supervisor: stay there; if completed without SL approval: Intake + comment.
 */
export async function resolveSlCheck(
  mapId: string,
  user: AuthUser,
  decision: "accept" | "need_corrections",
  note?: string | null
) {
  if (!userHasShiftLeaderRole(user)) {
    throw new Error("Only shift leaders can resolve a check");
  }
  await assertOnShiftToday(user.id);

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
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: {
        slCheckStatus: null,
        slCheckRequestedById: null,
        slCheckClaimedById: null,
        slCheckRequestedAt: null,
        slCheckClaimedAt: null,
        slCheckNote: cleanNote,
        shiftLeaderApproved: true,
        fieldWorkStatus: FieldWorkStatus.COMPLETED,
        fieldProgressPercent: 100,
        supervisorStatus: SupervisorStatus.DONE,
        onHubStatusBoard: true,
      },
      include: hubMapIncludes,
    });
    await logEvent(
      mapId,
      user.id,
      "sl_check_accepted",
      `${user.name} approved ${map.mapNumber} — completed`
    );
    return updated;
  }

  if (!cleanNote) {
    throw new Error("Add a short comment explaining why the check was not accepted");
  }

  const wasCompletedWithoutApproval =
    map.fieldWorkStatus === FieldWorkStatus.COMPLETED && map.shiftLeaderApproved === false;

  const comment = `SL checked — no approve: ${cleanNote}`;

  if (wasCompletedWithoutApproval) {
    // Day-after / no-SL-on-shift completion → back to Intake
    const updated = await prisma.map.update({
      where: { id: mapId },
      data: {
        slCheckStatus: null,
        slCheckRequestedById: null,
        slCheckClaimedById: null,
        slCheckRequestedAt: null,
        slCheckClaimedAt: null,
        slCheckNote: null,
        shiftLeaderApproved: null,
        assignedSupervisorId: null,
        onHubStatusBoard: false,
        fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
        supervisorStatus: null,
        opsManagerComment: comment,
      },
      include: hubMapIncludes,
    });
    await logEvent(
      mapId,
      user.id,
      "sl_check_corrections",
      `${user.name} did not accept ${map.mapNumber} — sent to Intake: ${cleanNote}`
    );
    return updated;
  }

  // Asked while under a supervisor — stay on that supervisor's column
  const updated = await prisma.map.update({
    where: { id: mapId },
    data: {
      slCheckStatus: null,
      slCheckRequestedById: null,
      slCheckClaimedById: null,
      slCheckRequestedAt: null,
      slCheckClaimedAt: null,
      slCheckNote: null,
      shiftLeaderApproved: null,
      onHubStatusBoard: false,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      supervisorStatus: null,
      opsManagerComment: comment,
    },
    include: hubMapIncludes,
  });
  await logEvent(
    mapId,
    user.id,
    "sl_check_corrections",
    `${user.name} did not accept ${map.mapNumber} — stays with supervisor: ${cleanNote}`
  );
  return updated;
}

/** Cancel an open check before anyone takes it (requesting supervisor or OPS). */
export async function cancelSlCheck(mapId: string, user: AuthUser) {
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map) throw new Error("Map not found");
  const isRequester = map.slCheckRequestedById === user.id || map.assignedSupervisorId === user.id;
  if (!isRequester && !isOpsManager(user)) {
    throw new Error("Not allowed to cancel this SL check");
  }
  if (map.slCheckStatus === SlCheckStatus.CLAIMED) {
    throw new Error("Shift leader must answer Yes or No — cancel is only before someone takes the check");
  }
  if (map.slCheckStatus !== SlCheckStatus.OPEN) {
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
