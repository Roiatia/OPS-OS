import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  validateAvailabilityDays,
  weekStartSunday,
  isNightShift,
  minutesToTime,
  shiftDurationMinutes,
  type AvailabilityDayInput,
} from "../lib/availabilityRules.js";
import type { AuthUser } from "../lib/types.js";
import { supervisorRolesWhere, userHasOpsManagerRole, userHasSupervisorRole } from "../lib/roles.js";

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

const submissionInclude = {
  days: { orderBy: { dayOfWeek: "asc" as const } },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      fridayContract: true,
      roles: { select: { role: true } },
    },
  },
};

type SubmissionRow = {
  id: string;
  weekStart: Date;
  fridayContract: boolean;
  note: string | null;
  submittedAt: Date | null;
  days: {
    id: string;
    dayOfWeek: number;
    canWork: boolean;
    allDay: boolean;
    startMinutes: number | null;
    endMinutes: number | null;
    note: string | null;
  }[];
  user: {
    id: string;
    name: string;
    email: string;
    fridayContract: boolean;
    roles: { role: RoleName }[];
  };
};

function serializeDay(day: SubmissionRow["days"][number]) {
  const hasHours =
    day.canWork && !day.allDay && day.startMinutes != null && day.endMinutes != null;
  return {
    id: day.id,
    dayOfWeek: day.dayOfWeek,
    canWork: day.canWork,
    allDay: day.allDay,
    note: day.note,
    startMinutes: day.startMinutes,
    endMinutes: day.endMinutes,
    startTime: hasHours ? minutesToTime(day.startMinutes!) : null,
    endTime: hasHours ? minutesToTime(day.endMinutes!) : null,
    durationHours: hasHours
      ? Math.round((shiftDurationMinutes(day.startMinutes!, day.endMinutes!) / 60) * 10) / 10
      : null,
    isNight: hasHours ? isNightShift(day.startMinutes!, day.endMinutes!) : false,
  };
}

function serializeSubmission(sub: SubmissionRow) {
  const days = sub.days.map(serializeDay);
  return {
    id: sub.id,
    weekStart: toIsoDate(sub.weekStart),
    fridayContract: sub.fridayContract,
    note: sub.note,
    submittedAt: sub.submittedAt?.toISOString() ?? null,
    user: {
      id: sub.user.id,
      name: sub.user.name,
      email: sub.user.email,
      roles: sub.user.roles.map((r) => r.role),
    },
    days,
    /** Shifts derived from can-work days — for roster compatibility */
    shifts: days
      .filter((d) => d.canWork && !d.allDay && d.startMinutes != null && d.endMinutes != null)
      .map((d) => ({
        id: d.id,
        dayOfWeek: d.dayOfWeek,
        startMinutes: d.startMinutes!,
        endMinutes: d.endMinutes!,
        startTime: d.startTime!,
        endTime: d.endTime!,
        durationHours: d.durationHours!,
        isNight: d.isNight,
        note: d.note,
      })),
  };
}

export async function getMyAvailability(user: AuthUser, weekStartRaw?: string) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors and shift leaders can submit availability");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });

  let submission = await prisma.availabilitySubmission.findUnique({
    where: { userId_weekStart: { userId: user.id, weekStart } },
    include: submissionInclude,
  });

  if (!submission) {
    submission = await prisma.availabilitySubmission.create({
      data: {
        userId: user.id,
        weekStart,
        fridayContract: dbUser?.fridayContract ?? false,
      },
      include: submissionInclude,
    });
  }

  return serializeSubmission(submission);
}

export async function saveMyAvailability(
  user: AuthUser,
  data: {
    weekStart?: string;
    fridayContract: boolean;
    note?: string | null;
    days: AvailabilityDayInput[];
  }
) {
  if (!userHasSupervisorRole(user)) {
    throw new Error("Only supervisors and shift leaders can submit availability");
  }

  const weekStart = parseWeekStart(data.weekStart);
  const errors = validateAvailabilityDays(data.days, data.fridayContract);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { fridayContract: data.fridayContract },
  });

  const submission = await prisma.availabilitySubmission.upsert({
    where: { userId_weekStart: { userId: user.id, weekStart } },
    create: {
      userId: user.id,
      weekStart,
      fridayContract: data.fridayContract,
      note: null,
      submittedAt: new Date(),
      days: {
        create: data.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          canWork: d.canWork,
          allDay: Boolean(d.canWork && d.allDay),
          startMinutes: d.canWork && !d.allDay ? (d.startMinutes ?? null) : null,
          endMinutes: d.canWork && !d.allDay ? (d.endMinutes ?? null) : null,
          note: d.note?.trim() || null,
        })),
      },
    },
    update: {
      fridayContract: data.fridayContract,
      note: null,
      submittedAt: new Date(),
      days: {
        deleteMany: {},
        create: data.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          canWork: d.canWork,
          allDay: Boolean(d.canWork && d.allDay),
          startMinutes: d.canWork && !d.allDay ? (d.startMinutes ?? null) : null,
          endMinutes: d.canWork && !d.allDay ? (d.endMinutes ?? null) : null,
          note: d.note?.trim() || null,
        })),
      },
    },
    include: submissionInclude,
  });

  return serializeSubmission(submission);
}

export async function getAvailabilityRoster(user: AuthUser, weekStartRaw?: string) {
  if (!userHasOpsManagerRole(user)) {
    throw new Error("Only OPS managers can view the full roster");
  }

  const weekStart = parseWeekStart(weekStartRaw);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const supervisors = await prisma.user.findMany({
    where: supervisorRolesWhere(),
    include: { roles: true },
    orderBy: { name: "asc" },
  });

  const submissions = await prisma.availabilitySubmission.findMany({
    where: { weekStart },
    include: submissionInclude,
  });

  const byUserId = new Map(submissions.map((s) => [s.userId, s]));

  const mapsScheduled = await prisma.map.count({
    where: {
      phase: "FIELD",
      fieldDate: { gte: weekStart, lt: weekEnd },
    },
  });

  const roster = supervisors.map((sup) => {
    const sub = byUserId.get(sup.id);
    return {
      user: {
        id: sup.id,
        name: sup.name,
        email: sup.email,
        roles: sup.roles.map((r) => r.role),
        isShiftLeader: sup.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER),
      },
      submission: sub ? serializeSubmission(sub) : null,
    };
  });

  const submitted = roster.filter((r) => r.submission?.submittedAt).length;
  const totalNightShifts = roster.reduce((n, r) => {
    return n + (r.submission?.shifts.filter((s) => s.isNight).length ?? 0);
  }, 0);

  return {
    weekStart: toIsoDate(weekStart),
    weekEnd: toIsoDate(new Date(weekEnd.getTime() - 86400000)),
    stats: {
      supervisorsTotal: supervisors.length,
      submitted,
      missing: supervisors.length - submitted,
      mapsScheduled,
      totalNightShifts,
      suggestedSupervisorsNeeded: Math.max(1, Math.ceil(mapsScheduled / 3)),
    },
    roster,
  };
}

export async function validateAvailabilityDraft(
  days: AvailabilityDayInput[],
  fridayContract: boolean
) {
  return validateAvailabilityDays(days, fridayContract);
}
