import { RoleName, ShiftChangeStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { formatAvailabilityWindow, weekStartSunday } from "../domain/availabilityRules.js";
import type { AuthUser } from "../lib/types.js";
import {
  supervisorRolesWhere,
  userHasOpsManagerRole,
  userHasSupervisorRole,
} from "../domain/roles.js";

function parseWeekStart(raw?: string): Date {
  const toUtcDate = (d: Date) =>
    new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  if (raw) {
    const [y, m, d] = raw.split("-").map(Number);
    if (y && m && d) return toUtcDate(weekStartSunday(new Date(y, m - 1, d)));
  }
  return toUtcDate(weekStartSunday(new Date()));
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const userSelect = { id: true, name: true, email: true } as const;

function serializeRequest(r: {
  id: string;
  planId: string;
  weekStart: Date;
  dayOfWeek: number;
  status: ShiftChangeStatus;
  note: string | null;
  counterpartAt: Date | null;
  opsAt: Date | null;
  createdAt: Date;
  fromUser: { id: string; name: string; email: string };
  toUser: { id: string; name: string; email: string };
  opsBy: { id: string; name: string; email: string } | null;
}) {
  return {
    id: r.id,
    planId: r.planId,
    weekStart: toIsoDate(r.weekStart),
    dayOfWeek: r.dayOfWeek,
    status: r.status,
    note: r.note,
    counterpartAt: r.counterpartAt?.toISOString() ?? null,
    opsAt: r.opsAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    fromUser: r.fromUser,
    toUser: r.toUser,
    opsBy: r.opsBy,
  };
}

const requestInclude = {
  fromUser: { select: userSelect },
  toUser: { select: userSelect },
  opsBy: { select: userSelect },
} as const;

/** People who offered availability for this day and are not already on the published roster for it. */
export async function listShiftChangeCandidates(
  user: AuthUser,
  weekStartRaw: string | undefined,
  dayOfWeek: number
) {
  if (!userHasSupervisorRole(user) && !userHasOpsManagerRole(user)) {
    throw new Error("Not allowed");
  }
  if (dayOfWeek < 0 || dayOfWeek > 5) {
    throw new Error("dayOfWeek must be Sun–Fri (0–5)");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const plan = await prisma.shiftPlan.findUnique({
    where: { weekStart },
    include: { assignments: { where: { dayOfWeek } } },
  });
  if (!plan?.publishedAt) {
    throw new Error("Schedule is not published yet");
  }

  const myAssignment = plan.assignments.find((a) => a.userId === user.id);
  if (!userHasOpsManagerRole(user) && !myAssignment) {
    throw new Error("You are not scheduled on this day");
  }

  const assignedIds = new Set(plan.assignments.map((a) => a.userId));

  const submissions = await prisma.availabilitySubmission.findMany({
    where: {
      weekStart,
      days: { some: { dayOfWeek, canWork: true } },
      user: supervisorRolesWhere(),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          roles: { select: { role: true } },
        },
      },
      days: { where: { dayOfWeek } },
    },
  });

  return submissions
    .filter((s) => s.userId !== user.id && !assignedIds.has(s.userId))
    .map((s) => {
      const day = s.days[0];
      const isShiftLeader = s.user.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER);
      return {
        userId: s.user.id,
        name: s.user.name,
        email: s.user.email,
        isShiftLeader,
        hoursLabel: day
          ? formatAvailabilityWindow({
              canWork: day.canWork,
              allDay: day.allDay,
              startMinutes: day.startMinutes,
              endMinutes: day.endMinutes,
              startMinutes2: day.startMinutes2,
              endMinutes2: day.endMinutes2,
            })
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createShiftChangeRequest(
  user: AuthUser,
  data: { weekStart?: string; dayOfWeek: number; toUserId: string; note?: string }
) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can ask for a shift change");
  }

  const weekStart = parseWeekStart(data.weekStart);
  const dayOfWeek = data.dayOfWeek;
  if (dayOfWeek < 0 || dayOfWeek > 5) {
    throw new Error("dayOfWeek must be Sun–Fri (0–5)");
  }

  const plan = await prisma.shiftPlan.findUnique({
    where: { weekStart },
    include: { assignments: true },
  });
  if (!plan?.publishedAt) {
    throw new Error("Schedule is not published yet");
  }

  const fromAssigned = plan.assignments.some(
    (a) => a.dayOfWeek === dayOfWeek && a.userId === user.id
  );
  if (!fromAssigned) {
    throw new Error("You are not scheduled on this day");
  }

  if (data.toUserId === user.id) {
    throw new Error("Pick someone else");
  }

  const toAssigned = plan.assignments.some(
    (a) => a.dayOfWeek === dayOfWeek && a.userId === data.toUserId
  );
  if (toAssigned) {
    throw new Error("That person is already scheduled that day");
  }

  const availability = await prisma.availabilityDay.findFirst({
    where: {
      dayOfWeek,
      canWork: true,
      submission: { userId: data.toUserId, weekStart },
    },
  });
  if (!availability) {
    throw new Error("That person did not offer availability for this day");
  }

  const existing = await prisma.shiftChangeRequest.findFirst({
    where: {
      planId: plan.id,
      dayOfWeek,
      fromUserId: user.id,
      toUserId: data.toUserId,
      status: { in: [ShiftChangeStatus.PENDING_COUNTERPART, ShiftChangeStatus.PENDING_OPS] },
    },
  });
  if (existing) {
    throw new Error("You already have an open request to this person for this day");
  }

  const created = await prisma.shiftChangeRequest.create({
    data: {
      planId: plan.id,
      weekStart,
      dayOfWeek,
      fromUserId: user.id,
      toUserId: data.toUserId,
      note: data.note?.trim() || null,
      status: ShiftChangeStatus.PENDING_COUNTERPART,
    },
    include: requestInclude,
  });

  return serializeRequest(created);
}

export async function listShiftChangeRequests(user: AuthUser, weekStartRaw?: string) {
  if (!userHasSupervisorRole(user) && !userHasOpsManagerRole(user)) {
    throw new Error("Not allowed");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const openStatuses: ShiftChangeStatus[] = [
    ShiftChangeStatus.PENDING_COUNTERPART,
    ShiftChangeStatus.PENDING_OPS,
  ];

  const whereBase = { weekStart };

  const [incoming, outgoing, pendingOps] = await Promise.all([
    prisma.shiftChangeRequest.findMany({
      where: {
        ...whereBase,
        toUserId: user.id,
        status: ShiftChangeStatus.PENDING_COUNTERPART,
      },
      include: requestInclude,
      orderBy: { createdAt: "asc" },
    }),
    prisma.shiftChangeRequest.findMany({
      where: {
        ...whereBase,
        fromUserId: user.id,
        status: { in: openStatuses },
      },
      include: requestInclude,
      orderBy: { createdAt: "asc" },
    }),
    userHasOpsManagerRole(user)
      ? prisma.shiftChangeRequest.findMany({
          where: {
            ...whereBase,
            status: ShiftChangeStatus.PENDING_OPS,
          },
          include: requestInclude,
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return {
    weekStart: toIsoDate(weekStart),
    incoming: incoming.map(serializeRequest),
    outgoing: outgoing.map(serializeRequest),
    pendingOps: pendingOps.map(serializeRequest),
  };
}

export async function acceptShiftChangeAsCounterpart(requestId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can accept");
  }

  const req = await prisma.shiftChangeRequest.findUnique({ where: { id: requestId } });
  if (!req || req.toUserId !== user.id) {
    throw new Error("Request not found");
  }
  if (req.status !== ShiftChangeStatus.PENDING_COUNTERPART) {
    throw new Error("Request is not waiting for your response");
  }

  const updated = await prisma.shiftChangeRequest.update({
    where: { id: requestId },
    data: {
      status: ShiftChangeStatus.PENDING_OPS,
      counterpartAt: new Date(),
    },
    include: requestInclude,
  });

  return serializeRequest(updated);
}

export async function rejectShiftChangeAsCounterpart(requestId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can reject");
  }

  const req = await prisma.shiftChangeRequest.findUnique({ where: { id: requestId } });
  if (!req || req.toUserId !== user.id) {
    throw new Error("Request not found");
  }
  if (req.status !== ShiftChangeStatus.PENDING_COUNTERPART) {
    throw new Error("Request is not waiting for your response");
  }

  const updated = await prisma.shiftChangeRequest.update({
    where: { id: requestId },
    data: {
      status: ShiftChangeStatus.REJECTED,
      counterpartAt: new Date(),
    },
    include: requestInclude,
  });

  return serializeRequest(updated);
}

export async function cancelShiftChangeRequest(requestId: string, user: AuthUser) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors can cancel");
  }

  const req = await prisma.shiftChangeRequest.findUnique({ where: { id: requestId } });
  if (!req || req.fromUserId !== user.id) {
    throw new Error("Request not found");
  }
  if (
    req.status !== ShiftChangeStatus.PENDING_COUNTERPART &&
    req.status !== ShiftChangeStatus.PENDING_OPS
  ) {
    throw new Error("Request is already closed");
  }

  const updated = await prisma.shiftChangeRequest.update({
    where: { id: requestId },
    data: { status: ShiftChangeStatus.CANCELLED },
    include: requestInclude,
  });

  return serializeRequest(updated);
}

export async function acceptShiftChangeAsOps(requestId: string, user: AuthUser) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS can approve shift changes");
  }

  const req = await prisma.shiftChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new Error("Request not found");
  if (req.status !== ShiftChangeStatus.PENDING_OPS) {
    throw new Error("Request is not waiting for OPS");
  }

  await prisma.$transaction(async (tx) => {
    const existingTo = await tx.shiftPlanAssignment.findUnique({
      where: {
        planId_dayOfWeek_userId: {
          planId: req.planId,
          dayOfWeek: req.dayOfWeek,
          userId: req.toUserId,
        },
      },
    });
    if (existingTo) {
      throw new Error("Target is already on the roster for that day");
    }

    await tx.shiftPlanAssignment.deleteMany({
      where: {
        planId: req.planId,
        dayOfWeek: req.dayOfWeek,
        userId: req.fromUserId,
      },
    });

    await tx.shiftPlanAssignment.create({
      data: {
        planId: req.planId,
        dayOfWeek: req.dayOfWeek,
        userId: req.toUserId,
      },
    });

    await tx.shiftChangeRequest.update({
      where: { id: requestId },
      data: {
        status: ShiftChangeStatus.ACCEPTED,
        opsAt: new Date(),
        opsById: user.id,
      },
    });

    // Close other open requests for the same from-user day
    await tx.shiftChangeRequest.updateMany({
      where: {
        planId: req.planId,
        dayOfWeek: req.dayOfWeek,
        fromUserId: req.fromUserId,
        status: { in: [ShiftChangeStatus.PENDING_COUNTERPART, ShiftChangeStatus.PENDING_OPS] },
        NOT: { id: requestId },
      },
      data: { status: ShiftChangeStatus.CANCELLED },
    });
  });

  const updated = await prisma.shiftChangeRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: requestInclude,
  });
  return serializeRequest(updated);
}

export async function rejectShiftChangeAsOps(requestId: string, user: AuthUser) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS can reject shift changes");
  }

  const req = await prisma.shiftChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new Error("Request not found");
  if (req.status !== ShiftChangeStatus.PENDING_OPS) {
    throw new Error("Request is not waiting for OPS");
  }

  const updated = await prisma.shiftChangeRequest.update({
    where: { id: requestId },
    data: {
      status: ShiftChangeStatus.REJECTED,
      opsAt: new Date(),
      opsById: user.id,
    },
    include: requestInclude,
  });

  return serializeRequest(updated);
}
