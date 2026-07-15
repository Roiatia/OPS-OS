import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { formatWeekRange, weekStartSunday, isNightShift } from "../domain/availabilityRules.js";
import {
  autoPlanShifts,
  validatePlanAssignments,
  type PlannerAssignment,
  type PlannerStaff,
} from "../domain/shiftPlanner.js";
import type { AuthUser } from "../lib/types.js";
import { supervisorRolesWhere, userHasOpsManagerRole } from "../domain/roles.js";
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
    where: supervisorRolesWhere(),
    include: { roles: true },
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
    select: { id: true, mapNumber: true, client: true, fieldDate: true },
    orderBy: { fieldDate: "asc" },
  });

  const mapsPerDay: Record<number, number> = {};
  const mapsByDay: Record<number, { id: string; mapNumber: string; client: string }[]> = {};
  for (const day of [0, 1, 2, 3, 4, 5]) {
    mapsPerDay[day] = 0;
    mapsByDay[day] = [];
  }

  for (const map of maps) {
    if (!map.fieldDate) continue;
    const dow = fieldDateToDayOfWeek(map.fieldDate, weekStart);
    if (dow == null) continue;
    mapsPerDay[dow] = (mapsPerDay[dow] ?? 0) + 1;
    mapsByDay[dow].push({
      id: map.id,
      mapNumber: map.mapNumber,
      client: map.client,
    });
  }

  const staff: PlannerStaff[] = await Promise.all(
    supervisors.map(async (sup) => {
      const sub = byUserId.get(sup.id);
      const priorWeekNights = await getPriorWeekNightCount(sup.id, weekStart);
      return {
        userId: sup.id,
        name: sup.name,
        isShiftLeader: sup.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER),
        submitted: Boolean(sub?.submittedAt),
        days:
          sub?.days.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            canWork: d.canWork,
            allDay: d.allDay,
            startMinutes: d.startMinutes,
            endMinutes: d.endMinutes,
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

  return { staff, mapsPerDay, mapsByDay };
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
  });

  return {
    weekStart: toIsoDate(weekStart),
    weekLabel: formatWeekRange(weekStart),
    mapsPerDay: Object.entries(mapsPerDay).map(([day, count]) => ({
      dayOfWeek: Number(day),
      count,
      maps: mapsByDay[Number(day)] ?? [],
    })),
    staff: staff.map((s) => ({
      userId: s.userId,
      name: s.name,
      isShiftLeader: s.isShiftLeader,
      submitted: s.submitted,
      days: s.days,
    })),
    assignments,
    dayPlans,
    warnings,
    saved: Boolean(plan),
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
  });

  const plan = await prisma.shiftPlan.upsert({
    where: { weekStart },
    create: {
      weekStart,
      createdById: user.id,
      assignments: {
        create: data.assignments.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          userId: a.userId,
        })),
      },
    },
    update: {
      createdById: user.id,
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

  const { dayPlans } = validatePlanAssignments({ staff, assignments, mapsPerDay });

  return { assignments, dayPlans, warnings, saved: true };
}

export async function autoGenerateShiftPlan(user: AuthUser, weekStartRaw?: string) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS managers can plan shifts");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const { staff, mapsPerDay } = await loadPlannerContext(weekStart);
  const { assignments, dayPlans, warnings } = autoPlanShifts({ staff, mapsPerDay });
  return { assignments, dayPlans, warnings };
}
