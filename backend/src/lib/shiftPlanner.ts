import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  MAX_NIGHT_SHIFTS_PER_TWO_WEEKS,
  isNightShiftDay,
} from "./availabilityRules.js";

export type PlannerStaff = {
  userId: string;
  name: string;
  isShiftLeader: boolean;
  submitted: boolean;
  days: {
    dayOfWeek: number;
    canWork: boolean;
    allDay?: boolean;
    startMinutes?: number | null;
    endMinutes?: number | null;
    isNight?: boolean;
  }[];
  priorWeekNights: number;
};

export type PlannerAssignment = {
  dayOfWeek: number;
  userId: string;
  userName: string;
  isShiftLeader: boolean;
};

export type DayPlan = {
  dayOfWeek: number;
  label: string;
  mapsCount: number;
  staffNeeded: number;
  assignments: PlannerAssignment[];
  ok: boolean;
  issues: string[];
};

const MAPS_PER_SUPERVISOR = 3;

export function staffNeededForMaps(mapsCount: number): number {
  if (mapsCount <= 0) return 0;
  return Math.max(2, Math.ceil(mapsCount / MAPS_PER_SUPERVISOR));
}

function dayLabel(dayOfWeek: number): string {
  const idx = AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number]);
  return DAY_LABELS[idx >= 0 ? idx : 0];
}

function canWorkOnDay(staff: PlannerStaff, dayOfWeek: number): boolean {
  const day = staff.days.find((d) => d.dayOfWeek === dayOfWeek);
  return Boolean(day?.canWork);
}

function nightShiftsIfAssigned(staff: PlannerStaff, assignedDays: Set<number>): number {
  let count = staff.priorWeekNights;
  for (const dayOfWeek of assignedDays) {
    const day = staff.days.find((d) => d.dayOfWeek === dayOfWeek);
    if (day && isNightShiftDay(day)) count += 1;
  }
  return count;
}

function pickStaff(
  pool: PlannerStaff[],
  dayOfWeek: number,
  load: Map<string, number>,
  assignedDaysByUser: Map<string, Set<number>>,
  wantShiftLeader: boolean
): PlannerStaff | null {
  const candidates = pool
    .filter((s) => s.isShiftLeader === wantShiftLeader)
    .filter((s) => canWorkOnDay(s, dayOfWeek))
    .filter((s) => {
      const days = assignedDaysByUser.get(s.userId) ?? new Set();
      const next = new Set(days);
      next.add(dayOfWeek);
      return nightShiftsIfAssigned(s, next) <= MAX_NIGHT_SHIFTS_PER_TWO_WEEKS;
    })
    .sort((a, b) => {
      const loadA = load.get(a.userId) ?? 0;
      const loadB = load.get(b.userId) ?? 0;
      if (loadA !== loadB) return loadA - loadB;
      if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return candidates[0] ?? null;
}

export function autoPlanShifts(input: {
  staff: PlannerStaff[];
  mapsPerDay: Record<number, number>;
}): { assignments: PlannerAssignment[]; dayPlans: DayPlan[]; warnings: string[] } {
  const assignments: PlannerAssignment[] = [];
  const warnings: string[] = [];
  const load = new Map<string, number>();
  const assignedDaysByUser = new Map<string, Set<number>>();
  const dayPlans: DayPlan[] = [];

  for (const dayOfWeek of AVAILABILITY_DAYS) {
    const mapsCount = input.mapsPerDay[dayOfWeek] ?? 0;
    const needed = staffNeededForMaps(mapsCount);
    const dayAssignments: PlannerAssignment[] = [];
    const issues: string[] = [];

    if (needed === 0) {
      dayPlans.push({
        dayOfWeek,
        label: dayLabel(dayOfWeek),
        mapsCount,
        staffNeeded: 0,
        assignments: [],
        ok: true,
        issues: [],
      });
      continue;
    }

    const sl = pickStaff(input.staff, dayOfWeek, load, assignedDaysByUser, true);
    if (!sl) {
      issues.push("No shift leader available.");
    } else {
      dayAssignments.push({
        dayOfWeek,
        userId: sl.userId,
        userName: sl.name,
        isShiftLeader: true,
      });
      load.set(sl.userId, (load.get(sl.userId) ?? 0) + 1);
      const set = assignedDaysByUser.get(sl.userId) ?? new Set();
      set.add(dayOfWeek);
      assignedDaysByUser.set(sl.userId, set);
    }

    const supSlots = Math.max(1, needed - dayAssignments.length);
    for (let i = 0; i < supSlots; i++) {
      const sup = pickStaff(input.staff, dayOfWeek, load, assignedDaysByUser, false);
      if (!sup) {
        issues.push(`Need ${supSlots - i} more supervisor(s).`);
        break;
      }
      if (dayAssignments.some((a) => a.userId === sup.userId)) continue;
      dayAssignments.push({
        dayOfWeek,
        userId: sup.userId,
        userName: sup.name,
        isShiftLeader: false,
      });
      load.set(sup.userId, (load.get(sup.userId) ?? 0) + 1);
      const set = assignedDaysByUser.get(sup.userId) ?? new Set();
      set.add(dayOfWeek);
      assignedDaysByUser.set(sup.userId, set);
    }

    const hasSl = dayAssignments.some((a) => a.isShiftLeader);
    const supCount = dayAssignments.filter((a) => !a.isShiftLeader).length;
    const ok = hasSl && supCount >= 1 && issues.length === 0;

    if (!hasSl) issues.push("Missing shift leader.");
    if (supCount < 1) issues.push("Missing supervisor.");

    dayPlans.push({
      dayOfWeek,
      label: dayLabel(dayOfWeek),
      mapsCount,
      staffNeeded: needed,
      assignments: dayAssignments,
      ok,
      issues,
    });

    assignments.push(...dayAssignments);
    if (!ok) warnings.push(`${dayLabel(dayOfWeek)}: ${issues.join(" ")}`);
  }

  return { assignments, dayPlans, warnings };
}

export function validatePlanAssignments(input: {
  staff: PlannerStaff[];
  assignments: PlannerAssignment[];
  mapsPerDay: Record<number, number>;
}): { dayPlans: DayPlan[]; warnings: string[] } {
  const warnings: string[] = [];
  const dayPlans: DayPlan[] = [];
  const byDay = new Map<number, PlannerAssignment[]>();

  for (const a of input.assignments) {
    const list = byDay.get(a.dayOfWeek) ?? [];
    list.push(a);
    byDay.set(a.dayOfWeek, list);
  }

  const staffById = new Map(input.staff.map((s) => [s.userId, s]));

  for (const dayOfWeek of AVAILABILITY_DAYS) {
    const mapsCount = input.mapsPerDay[dayOfWeek] ?? 0;
    const needed = staffNeededForMaps(mapsCount);
    const dayAssignments = byDay.get(dayOfWeek) ?? [];
    const issues: string[] = [];

    if (needed === 0 && dayAssignments.length === 0) {
      dayPlans.push({
        dayOfWeek,
        label: dayLabel(dayOfWeek),
        mapsCount,
        staffNeeded: 0,
        assignments: dayAssignments,
        ok: true,
        issues: [],
      });
      continue;
    }

    for (const a of dayAssignments) {
      const person = staffById.get(a.userId);
      if (!person) issues.push(`${a.userName} not in roster.`);
      else if (!canWorkOnDay(person, dayOfWeek)) issues.push(`${a.userName} not available.`);
    }

    const hasSl = dayAssignments.some((a) => a.isShiftLeader);
    const supCount = dayAssignments.filter((a) => !a.isShiftLeader).length;
    if (mapsCount > 0) {
      if (!hasSl) issues.push("Need a shift leader to open/close.");
      if (supCount < 1) issues.push("Need at least one supervisor.");
      if (dayAssignments.length < needed) {
        issues.push(`Understaffed for ${mapsCount} map(s) (need ~${needed}).`);
      }
    }

    const ok = issues.length === 0;
    if (!ok) warnings.push(`${dayLabel(dayOfWeek)}: ${issues.join(" ")}`);

    dayPlans.push({
      dayOfWeek,
      label: dayLabel(dayOfWeek),
      mapsCount,
      staffNeeded: needed,
      assignments: dayAssignments,
      ok,
      issues,
    });
  }

  return { dayPlans, warnings };
}
