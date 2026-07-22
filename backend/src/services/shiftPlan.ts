import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { formatWeekRange, weekStartSunday, isNightShift, availableDaysCount, formatAvailabilityWindow, clockMinutesFromDate } from "../domain/availabilityRules.js";
import {
  autoPlanShifts,
  validatePlanAssignments,
  type PlannerAssignment,
  type PlannerStaff,
} from "../domain/shiftPlanner.js";
import type { AuthUser } from "../lib/types.js";
import { supervisorRolesWhere, userHasOpsManagerRole, userHasSupervisorRole } from "../domain/roles.js";
import { getPriorWeekNightCount } from "./availability.js";

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

function fieldDateToDayOfWeek(fieldDate: Date, weekStart: Date): number | null {
  const d = new Date(fieldDate);
  const start = new Date(weekStart);
  const diff = Math.round((d.getTime() - start.getTime()) / 86400000);
  if (diff < 0 || diff > 6) return null;
  if (diff === 6) return null;
  return diff;
}

async function loadPlannerContext(weekStart: Date) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const supervisors = await prisma.user.findMany({
    where: { active: true, ...supervisorRolesWhere() },
    include: { roles: true, supervisorClients: true },
    orderBy: { name: "asc" },
  });

  const submissions = await prisma.availabilitySubmission.findMany({
    where: { weekStart },
    include: { days: true },
  });
  const byUserId = new Map(submissions.map((s) => [s.userId, s]));

  const maps = await prisma.map.findMany({
    where: {
      phase: "FIELD",
      fieldDate: { gte: weekStart, lt: weekEnd },
    },
    select: {
      id: true,
      mapNumber: true,
      client: true,
      taskKind: true,
      taskEndMinutes: true,
      fieldDate: true,
      mapperName: true,
    },
    orderBy: { fieldDate: "asc" },
  });

  const mapsPerDay: Record<number, number> = {};
  const mapsByDay: Record<
    number,
    {
      id: string;
      mapNumber: string;
      client: string;
      taskKind: "MAP" | "HAPPY_HOUR" | "COMPANY_MEETING" | "MAPPING_REFRESH";
      fieldDate: string | null;
      mapperName: string | null;
      startMinutes: number | null;
      endMinutes: number | null;
    }[]
  > = {};
  for (const day of [0, 1, 2, 3, 4, 5]) {
    mapsPerDay[day] = 0;
    mapsByDay[day] = [];
  }

  const taskKindOrder: Record<string, number> = {
    MAP: 0,
    MAPPING_REFRESH: 1,
    HAPPY_HOUR: 2,
    COMPANY_MEETING: 3,
  };

  for (const map of maps) {
    if (!map.fieldDate) continue;
    const dow = fieldDateToDayOfWeek(map.fieldDate, weekStart);
    if (dow == null) continue;
    mapsPerDay[dow] = (mapsPerDay[dow] ?? 0) + 1;
    mapsByDay[dow].push({
      id: map.id,
      mapNumber: map.mapNumber,
      client: map.client,
      taskKind: map.taskKind,
      fieldDate: map.fieldDate.toISOString(),
      mapperName: map.mapperName,
      startMinutes: clockMinutesFromDate(map.fieldDate),
      endMinutes: map.taskEndMinutes ?? null,
    });
  }

  for (const day of [0, 1, 2, 3, 4, 5]) {
    mapsByDay[day].sort(
      (a, b) =>
        (taskKindOrder[a.taskKind] ?? 99) - (taskKindOrder[b.taskKind] ?? 99) ||
        (a.startMinutes ?? 0) - (b.startMinutes ?? 0) ||
        a.mapNumber.localeCompare(b.mapNumber)
    );
  }

  const staff: PlannerStaff[] = await Promise.all(
    supervisors.map(async (sup) => {
      const sub = byUserId.get(sup.id);
      const priorWeekNights = await getPriorWeekNightCount(sup.id, weekStart);
      const isShiftLeader = sup.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER);
      return {
        userId: sup.id,
        name: sup.name,
        isShiftLeader,
        submitted: Boolean(sub?.submittedAt),
        fridayContract: sub?.fridayContract ?? sup.fridayContract,
        hagimOk: sub?.hagimOk ?? sup.hagimOk,
        // SLs are senior supervisors — always capacity as rating 9
        supervisorRating: isShiftLeader ? 9 : (sup.supervisorRating ?? 5),
        allowedClients: sup.supervisorClients.map((c) => c.client),
        days:
          sub?.days.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            canWork: d.canWork,
            allDay: d.allDay,
            startMinutes: d.startMinutes,
            endMinutes: d.endMinutes,
            startMinutes2: d.startMinutes2,
            endMinutes2: d.endMinutes2,
            isNight:
              d.canWork &&
              !d.allDay &&
              d.startMinutes != null &&
              d.endMinutes != null &&
              isNightShift(d.startMinutes, d.endMinutes),
          })) ?? [],
        priorWeekNights,
      };
    })
  );

  return { staff, mapsPerDay, mapsByDay, weekStart };
}

function serializeAssignments(
  assignments: { dayOfWeek: number; userId: string; user: { name: string }; isShiftLeader?: boolean }[],
  staff: PlannerStaff[]
): PlannerAssignment[] {
  const staffById = new Map(staff.map((s) => [s.userId, s]));
  return assignments.map((a) => ({
    dayOfWeek: a.dayOfWeek,
    userId: a.userId,
    userName: a.user?.name ?? staffById.get(a.userId)?.name ?? "Unknown",
    isShiftLeader: staffById.get(a.userId)?.isShiftLeader ?? false,
  }));
}

export async function getShiftPlan(user: AuthUser, weekStartRaw?: string) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS managers can plan shifts");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const { staff, mapsPerDay, mapsByDay } = await loadPlannerContext(weekStart);

  const plan = await prisma.shiftPlan.findUnique({
    where: { weekStart },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: [{ dayOfWeek: "asc" }, { user: { name: "asc" } }],
      },
    },
  });

  const assignments = plan
    ? serializeAssignments(
        plan.assignments.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          userId: a.userId,
          user: a.user,
        })),
        staff
      )
    : [];

  const { dayPlans, warnings } = validatePlanAssignments({
    staff,
    assignments,
    mapsPerDay,
    weekStart,
  });

  return {
    weekStart: toIsoDate(weekStart),
    weekLabel: formatWeekRange(weekStart),
    mapsPerDay: Object.entries(mapsPerDay).map(([day, count]) => ({
      dayOfWeek: Number(day),
      count,
      maps: mapsByDay[Number(day)] ?? [],
    })),
    staff: staff.map((s) => {
      const daysOffered = availableDaysCount(s.days);
      return {
        userId: s.userId,
        name: s.name,
        isShiftLeader: s.isShiftLeader,
        submitted: s.submitted,
        fridayContract: s.fridayContract,
        hagimOk: s.hagimOk,
        supervisorRating: s.supervisorRating,
        allowedClients: s.allowedClients,
        daysOffered,
        days: s.days.map((d) => ({
          ...d,
          hoursLabel: formatAvailabilityWindow(d),
        })),
      };
    }),
    assignments,
    dayPlans,
    warnings,
    saved: Boolean(plan),
    published: Boolean(plan?.publishedAt),
    publishedAt: plan?.publishedAt?.toISOString() ?? null,
  };
}

export async function saveShiftPlan(
  user: AuthUser,
  data: { weekStart?: string; assignments: PlannerAssignment[] }
) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS managers can plan shifts");
  }

  const weekStart = parseWeekStart(data.weekStart);
  const { staff, mapsPerDay } = await loadPlannerContext(weekStart);

  const { warnings } = validatePlanAssignments({
    staff,
    assignments: data.assignments,
    mapsPerDay,
    weekStart,
  });

  const plan = await prisma.shiftPlan.upsert({
    where: { weekStart },
    create: {
      weekStart,
      createdById: user.id,
      publishedAt: new Date(),
      assignments: {
        create: data.assignments.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          userId: a.userId,
        })),
      },
    },
    update: {
      createdById: user.id,
      publishedAt: new Date(),
      assignments: {
        deleteMany: {},
        create: data.assignments.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          userId: a.userId,
        })),
      },
    },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  const assignments = serializeAssignments(
    plan.assignments.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      userId: a.userId,
      user: a.user,
    })),
    staff
  );

  const { dayPlans } = validatePlanAssignments({ staff, assignments, mapsPerDay, weekStart });

  return {
    assignments,
    dayPlans,
    warnings,
    saved: true,
    published: true,
    publishedAt: plan.publishedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function autoGenerateShiftPlan(
  user: AuthUser,
  weekStartRaw?: string,
  opts?: {
    dayOfWeek?: number;
    lockedAssignments?: {
      dayOfWeek: number;
      userId: string;
      userName: string;
      isShiftLeader: boolean;
    }[];
    variant?: number;
    avoidUserIds?: string[];
  }
) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS managers can plan shifts");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const { staff, mapsPerDay, mapsByDay } = await loadPlannerContext(weekStart);

  const dayOfWeek = opts?.dayOfWeek;
  const daysToPlan =
    dayOfWeek != null && dayOfWeek >= 0 && dayOfWeek <= 5 ? [dayOfWeek] : undefined;

  const lockedAssignments = daysToPlan
    ? (opts?.lockedAssignments ?? []).filter((a) => a.dayOfWeek !== dayOfWeek)
    : undefined;

  const { assignments, dayPlans, warnings } = autoPlanShifts({
    staff,
    mapsPerDay,
    mapsByDay,
    weekStart,
    daysToPlan,
    lockedAssignments,
    variant: opts?.variant,
    avoidUserIds: opts?.avoidUserIds,
  });
  return { assignments, dayPlans, warnings, published: false };
}

/**
 * Published weekly schedule — visible to OPS, supervisors, and shift leaders.
 * Returns empty assignments until OPS saves (publishes) the plan.
 */
export async function getPublishedSchedule(user: AuthUser, weekStartRaw?: string) {
  if (!userHasOpsManagerRole(user) && !userHasSupervisorRole(user)) {
    throw new Error("Not allowed to view the shift schedule");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const { staff, mapsPerDay, mapsByDay } = await loadPlannerContext(weekStart);

  const plan = await prisma.shiftPlan.findUnique({
    where: { weekStart },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: [{ dayOfWeek: "asc" }, { user: { name: "asc" } }],
      },
    },
  });

  const published = Boolean(plan?.publishedAt);
  const assignments = published
    ? serializeAssignments(
        plan!.assignments.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          userId: a.userId,
          user: a.user,
        })),
        staff
      )
    : [];

  const { dayPlans, warnings } = validatePlanAssignments({
    staff,
    assignments,
    mapsPerDay,
    weekStart,
  });

  return {
    weekStart: toIsoDate(weekStart),
    weekLabel: formatWeekRange(weekStart),
    published,
    publishedAt: plan?.publishedAt?.toISOString() ?? null,
    mapsPerDay: Object.entries(mapsPerDay).map(([day, count]) => ({
      dayOfWeek: Number(day),
      count,
      maps: (mapsByDay[Number(day)] ?? []).slice(0, 5),
    })),
    assignments,
    dayPlans,
    warnings: published ? warnings : [],
    viewerUserId: user.id,
  };
}
