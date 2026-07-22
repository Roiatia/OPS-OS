import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  MAX_MAPS_PER_SUPERVISOR,
  PREFERRED_MAPS_PER_SUPERVISOR,
  MAX_NIGHT_SHIFTS_PER_TWO_WEEKS,
  availabilityCoversClock,
  availableDaysCount,
  availabilityUtilization,
  clockMinutesFromDate,
  isNightShiftDay,
  maxMapsForRating,
} from "./availabilityRules.js";
import { canWorkHagim, isIsraelHoliday } from "./israelHolidays.js";

export type PlannerStaff = {
  userId: string;
  name: string;
  isShiftLeader: boolean;
  submitted: boolean;
  fridayContract?: boolean;
  hagimOk?: boolean;
  supervisorRating?: number | null;
  allowedClients?: string[];
  days: {
    dayOfWeek: number;
    canWork: boolean;
    allDay?: boolean;
    startMinutes?: number | null;
    endMinutes?: number | null;
    startMinutes2?: number | null;
    endMinutes2?: number | null;
    isNight?: boolean;
  }[];
  priorWeekNights: number;
};

export type PlannerMap = {
  id: string;
  mapNumber: string;
  client: string;
  taskKind?: "MAP" | "HAPPY_HOUR" | "COMPANY_MEETING" | "MAPPING_REFRESH";
  fieldDate: Date | string | null;
  mapperName?: string | null;
  endMinutes?: number | null;
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
  /**
   * TEMPORARY debug notes for OPS to review auto-plan logic.
   * Remove once the planner is trusted.
   */
  logicNotes?: string[];
};

/** Shift leaders are senior supervisors — always treated as rating 9 for capacity. */
export function effectiveRating(staff: PlannerStaff): number {
  if (staff.isShiftLeader) return 9;
  return staff.supervisorRating ?? 5;
}

/**
 * Headcount for happiness: enough people so each stays near ~5 maps,
 * not the company-minimum of 2×10. Never shrink just because ratings are high.
 */
export function staffNeededForMaps(mapsCount: number): number {
  if (mapsCount <= 0) return 0;
  return Math.max(2, Math.ceil(mapsCount / PREFERRED_MAPS_PER_SUPERVISOR));
}

/** Absolute floor if everyone takes the hard max (10 maps). */
export function minStaffToCoverMaps(mapsCount: number): number {
  if (mapsCount <= 0) return 0;
  return Math.max(1, Math.ceil(mapsCount / MAX_MAPS_PER_SUPERVISOR));
}

function mapCapacityOf(staff: PlannerStaff, hardFill = false): number {
  if (hardFill) return MAX_MAPS_PER_SUPERVISOR;
  return maxMapsForRating(effectiveRating(staff));
}

function dayLabel(dayOfWeek: number): string {
  const idx = AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number]);
  return DAY_LABELS[idx >= 0 ? idx : 0];
}

function canWorkOnDay(staff: PlannerStaff, dayOfWeek: number): boolean {
  const day = staff.days.find((d) => d.dayOfWeek === dayOfWeek);
  return Boolean(day?.canWork);
}

function staffEligibleForDay(
  staff: PlannerStaff,
  dayOfWeek: number,
  weekStart?: Date
): boolean {
  if (!canWorkOnDay(staff, dayOfWeek)) return false;
  if (!weekStart) return true;
  const d = new Date(weekStart);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOfWeek);
  if (!isIsraelHoliday(d)) return true;
  return canWorkHagim(Boolean(staff.fridayContract));
}

function nightShiftsIfAssigned(staff: PlannerStaff, assignedDays: Set<number>): number {
  let count = staff.priorWeekNights;
  for (const dayOfWeek of assignedDays) {
    const day = staff.days.find((d) => d.dayOfWeek === dayOfWeek);
    if (day && isNightShiftDay(day)) count += 1;
  }
  return count;
}

function mapClockMinutes(maps: PlannerMap[]): number[] {
  const out: number[] = [];
  for (const m of maps) {
    if (!m.fieldDate) continue;
    const d = m.fieldDate instanceof Date ? m.fieldDate : new Date(m.fieldDate);
    if (Number.isNaN(d.getTime())) continue;
    out.push(clockMinutesFromDate(d));
  }
  return out;
}

function hourFitScore(staff: PlannerStaff, dayOfWeek: number, mapClocks: number[]): number {
  if (mapClocks.length === 0) return 0;
  const day = staff.days.find((d) => d.dayOfWeek === dayOfWeek);
  let hits = 0;
  for (const clock of mapClocks) {
    if (availabilityCoversClock(day, clock)) hits += 1;
  }
  return hits / mapClocks.length;
}

function recordAssignment(
  person: PlannerStaff,
  dayOfWeek: number,
  load: Map<string, number>,
  assignedDaysByUser: Map<string, Set<number>>,
  dayAssignments: PlannerAssignment[]
) {
  dayAssignments.push({
    dayOfWeek,
    userId: person.userId,
    userName: person.name,
    isShiftLeader: person.isShiftLeader,
  });
  load.set(person.userId, (load.get(person.userId) ?? 0) + 1);
  const set = assignedDaysByUser.get(person.userId) ?? new Set();
  set.add(dayOfWeek);
  assignedDaysByUser.set(person.userId, set);
}

/**
 * How many other days still needing an open/close SL this person could cover.
 * Used when spreading: save flexible SLs for days that still need cover.
 */
function remainingSlCoverOptions(
  s: PlannerStaff,
  exceptDay: number,
  uncoveredDays: Set<number>,
  assignedDaysByUser: Map<string, Set<number>>,
  weekStart?: Date
): number {
  let n = 0;
  for (const d of uncoveredDays) {
    if (d === exceptDay) continue;
    if (assignedDaysByUser.get(s.userId)?.has(d)) continue;
    if (staffEligibleForDay(s, d, weekStart)) n += 1;
  }
  return n;
}

function canBeOpenCloseSl(
  s: PlannerStaff,
  dayOfWeek: number,
  assignedDaysByUser: Map<string, Set<number>>,
  weekStart?: Date
): boolean {
  if (!s.isShiftLeader) return false;
  if (!staffEligibleForDay(s, dayOfWeek, weekStart)) return false;
  if (assignedDaysByUser.get(s.userId)?.has(dayOfWeek)) return false;
  const days = assignedDaysByUser.get(s.userId) ?? new Set();
  const next = new Set(days);
  next.add(dayOfWeek);
  return nightShiftsIfAssigned(s, next) <= MAX_NIGHT_SHIFTS_PER_TWO_WEEKS;
}

function variantTieBreak(userId: string, variant: number): number {
  if (!variant) return 0;
  let h = variant | 0;
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function avoidPenalty(userId: string, avoidUserIds?: Set<string>): number {
  return avoidUserIds?.has(userId) ? 1 : 0;
}

/**
 * Assign one open/close SL per task-day:
 * hardest days first → spread duty → prefer constrained SLs.
 * When planning a single day, still looks at other map-days in the week
 * so we don't burn an SL who is the only cover for Friday, etc.
 * Also writes TEMP logic notes per day (remove later).
 */
function assignOpenCloseShiftLeaders(input: {
  staff: PlannerStaff[];
  mapsPerDay: Record<number, number>;
  planDays: Set<number>;
  weekStart?: Date;
  load: Map<string, number>;
  assignedDaysByUser: Map<string, Set<number>>;
  alreadyCovered: Map<number, PlannerStaff>;
  variant?: number;
  avoidUserIds?: Set<string>;
}): { designated: Map<number, PlannerStaff>; notesByDay: Map<number, string[]> } {
  const designated = new Map<number, PlannerStaff>(input.alreadyCovered);
  const notesByDay = new Map<number, string[]>();
  const dutyCount = new Map<string, number>();
  for (const [day, sl] of designated) {
    dutyCount.set(sl.userId, (dutyCount.get(sl.userId) ?? 0) + 1);
    notesByDay.set(day, [
      `Open/close SL: ${sl.name} — already locked from a previous day plan (kept).`,
    ]);
  }

  const uncovered = [...input.planDays].filter(
    (d) => (input.mapsPerDay[d] ?? 0) > 0 && !designated.has(d)
  );

  const eligibleCount = (day: number) =>
    input.staff.filter((s) =>
      canBeOpenCloseSl(s, day, input.assignedDaysByUser, input.weekStart)
    ).length;

  uncovered.sort((a, b) => eligibleCount(a) - eligibleCount(b) || a - b);

  /** Days that still need an SL somewhere in the week (this pass + not-yet-planned). */
  const weekNeedSl = new Set<number>(
    AVAILABILITY_DAYS.filter(
      (d) => (input.mapsPerDay[d] ?? 0) > 0 && !designated.has(d)
    )
  );

  const variant = input.variant ?? 0;

  const orderNote =
    uncovered.length > 0
      ? `SL days filled hardest-first: ${uncovered
          .map((d) => `${dayLabel(d)}(${eligibleCount(d)} SLs)`)
          .join(" → ")}` +
        (weekNeedSl.size > uncovered.length
          ? ` · also protecting ${weekNeedSl.size - uncovered.length} other day(s) still needing SL.`
          : ".")
      : null;

  for (const day of uncovered) {
    const candidates = input.staff
      .filter((s) => canBeOpenCloseSl(s, day, input.assignedDaysByUser, input.weekStart))
      .sort((a, b) => {
        const avoidA = avoidPenalty(a.userId, input.avoidUserIds);
        const avoidB = avoidPenalty(b.userId, input.avoidUserIds);
        if (avoidA !== avoidB) return avoidA - avoidB;

        const dutyA = dutyCount.get(a.userId) ?? 0;
        const dutyB = dutyCount.get(b.userId) ?? 0;
        if (dutyA !== dutyB) return dutyA - dutyB;

        const remA = remainingSlCoverOptions(
          a,
          day,
          weekNeedSl,
          input.assignedDaysByUser,
          input.weekStart
        );
        const remB = remainingSlCoverOptions(
          b,
          day,
          weekNeedSl,
          input.assignedDaysByUser,
          input.weekStart
        );
        if (remA !== remB) return remA - remB;

        const offeredA = Math.max(1, availableDaysCount(a.days));
        const offeredB = Math.max(1, availableDaysCount(b.days));
        const utilA = availabilityUtilization(input.load.get(a.userId) ?? 0, offeredA);
        const utilB = availabilityUtilization(input.load.get(b.userId) ?? 0, offeredB);
        if (Math.abs(utilA - utilB) > 0.001) return utilA - utilB;
        const loadA = input.load.get(a.userId) ?? 0;
        const loadB = input.load.get(b.userId) ?? 0;
        if (loadA !== loadB) return loadA - loadB;
        if (variant) {
          return variantTieBreak(a.userId, variant) - variantTieBreak(b.userId, variant);
        }
        return a.name.localeCompare(b.name);
      });

    const notes = notesByDay.get(day) ?? [];
    if (orderNote && notes.length === 0) notes.push(orderNote);

    const pick = candidates[0];
    if (!pick) {
      notes.push(`Open/close SL: none available (${candidates.length} eligible).`);
      notesByDay.set(day, notes);
      continue;
    }

    const rem = remainingSlCoverOptions(
      pick,
      day,
      weekNeedSl,
      input.assignedDaysByUser,
      input.weekStart
    );
    const duty = dutyCount.get(pick.userId) ?? 0;
    const offered = availableDaysCount(pick.days);
    const prevLoad = input.load.get(pick.userId) ?? 0;
    const runnerUp = candidates[1];
    notes.push(
      `Open/close SL: ${pick.name} — among ${candidates.length} eligible SLs. ` +
        `Priority: fewest other week days left they could open (${rem}); ` +
        `even SL duty (${duty} open/close so far); ` +
        `fair ratio ${prevLoad}/${Math.max(1, offered)}.` +
        (runnerUp
          ? ` Runner-up: ${runnerUp.name}.`
          : "")
    );
    notesByDay.set(day, notes);

    designated.set(day, pick);
    dutyCount.set(pick.userId, duty + 1);
    weekNeedSl.delete(day);
    input.load.set(pick.userId, prevLoad + 1);
    const set = input.assignedDaysByUser.get(pick.userId) ?? new Set();
    set.add(day);
    input.assignedDaysByUser.set(pick.userId, set);
  }

  return { designated, notesByDay };
}

function staffFillNote(
  person: PlannerStaff,
  dayOfWeek: number,
  loadBefore: number,
  mapClocks: number[],
  why: "fair-fill" | "hard-capacity" | "hour-cover",
  clock?: number
): string {
  const offered = availableDaysCount(person.days);
  const fit = hourFitScore(person, dayOfWeek, mapClocks);
  const role = person.isShiftLeader ? "SL" : "Sup";
  const rating = effectiveRating(person);
  const whyLabel =
    why === "fair-fill"
      ? "roster fill (prefer Sup over extra SL; fair util)"
      : why === "hard-capacity"
        ? "added so everyone stays ≤9 tasks"
        : "added to cover a task start nobody on roster could";
  let note =
    `${role} ${person.name}: ${whyLabel} — before pick ${loadBefore}/${Math.max(1, offered)} days used, ` +
    `covers ${(fit * 100).toFixed(0)}% of today's task starts, rating ${rating}`;
  if (why === "hour-cover" && clock != null) {
    const hh = String(Math.floor(clock / 60)).padStart(2, "0");
    const mm = String(clock % 60).padStart(2, "0");
    note += `; needed for ${hh}:${mm}`;
  }
  return note + ".";
}

/**
 * Fair pick among staff for task seats.
 * Open/close SL for the day is chosen separately — prefer supervisors for
 * remaining roster seats so we don't burn every SL on fill.
 */
function pickStaff(
  pool: PlannerStaff[],
  dayOfWeek: number,
  load: Map<string, number>,
  assignedDaysByUser: Map<string, Set<number>>,
  weekStart: Date | undefined,
  mapClocks: number[],
  opts?: {
    variant?: number;
    avoidUserIds?: Set<string>;
    /** Only people whose hours cover this clock */
    requireCoverClock?: number;
  }
): PlannerStaff | null {
  const variant = opts?.variant ?? 0;
  const candidates = pool
    .filter((s) => staffEligibleForDay(s, dayOfWeek, weekStart))
    .filter((s) => {
      if (opts?.requireCoverClock == null) return true;
      return availabilityCoversClock(
        s.days.find((d) => d.dayOfWeek === dayOfWeek),
        opts.requireCoverClock
      );
    })
    .filter((s) => {
      const days = assignedDaysByUser.get(s.userId) ?? new Set();
      const next = new Set(days);
      next.add(dayOfWeek);
      return nightShiftsIfAssigned(s, next) <= MAX_NIGHT_SHIFTS_PER_TWO_WEEKS;
    })
    .filter((s) => !(assignedDaysByUser.get(s.userId)?.has(dayOfWeek)))
    .sort((a, b) => {
      const avoidA = avoidPenalty(a.userId, opts?.avoidUserIds);
      const avoidB = avoidPenalty(b.userId, opts?.avoidUserIds);
      if (avoidA !== avoidB) return avoidA - avoidB;

      // Prefer supervisors over extra SLs (1 SL already reserved for open/close)
      if (a.isShiftLeader !== b.isShiftLeader) return a.isShiftLeader ? 1 : -1;

      const offeredA = Math.max(1, availableDaysCount(a.days));
      const offeredB = Math.max(1, availableDaysCount(b.days));
      const loadA = load.get(a.userId) ?? 0;
      const loadB = load.get(b.userId) ?? 0;
      const utilA = availabilityUtilization(loadA, offeredA);
      const utilB = availabilityUtilization(loadB, offeredB);

      if (Math.abs(utilA - utilB) > 0.001) return utilA - utilB;
      if (loadA !== loadB) return loadA - loadB;
      const fitA = hourFitScore(a, dayOfWeek, mapClocks);
      const fitB = hourFitScore(b, dayOfWeek, mapClocks);
      if (Math.abs(fitA - fitB) > 0.05) return fitB - fitA;
      const ratingA = effectiveRating(a);
      const ratingB = effectiveRating(b);
      if (ratingA !== ratingB) return ratingB - ratingA;
      if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
      if (variant) {
        return variantTieBreak(a.userId, variant) - variantTieBreak(b.userId, variant);
      }
      return a.name.localeCompare(b.name);
    });

  return candidates[0] ?? null;
}

function seedLoadFromLocked(
  locked: PlannerAssignment[]
): { load: Map<string, number>; assignedDaysByUser: Map<string, Set<number>> } {
  const load = new Map<string, number>();
  const assignedDaysByUser = new Map<string, Set<number>>();
  for (const a of locked) {
    load.set(a.userId, (load.get(a.userId) ?? 0) + 1);
    const set = assignedDaysByUser.get(a.userId) ?? new Set();
    set.add(a.dayOfWeek);
    assignedDaysByUser.set(a.userId, set);
  }
  return { load, assignedDaysByUser };
}

export function autoPlanShifts(input: {
  staff: PlannerStaff[];
  mapsPerDay: Record<number, number>;
  mapsByDay?: Record<number, PlannerMap[]>;
  weekStart?: Date;
  daysToPlan?: number[];
  lockedAssignments?: PlannerAssignment[];
  /** Bump on re-plan to get a different fair shuffle. */
  variant?: number;
  /** Soft-avoid these people (previous draft) when re-planning. */
  avoidUserIds?: string[];
}): { assignments: PlannerAssignment[]; dayPlans: DayPlan[]; warnings: string[] } {
  const staff = input.staff.map((s) => ({
    ...s,
    supervisorRating: effectiveRating(s),
  }));
  const variant = input.variant ?? 0;
  const avoidUserIds = input.avoidUserIds?.length
    ? new Set(input.avoidUserIds)
    : undefined;

  const planDays = new Set(
    input.daysToPlan?.length ? input.daysToPlan : [...AVAILABILITY_DAYS]
  );
  const locked = (input.lockedAssignments ?? []).filter((a) => !planDays.has(a.dayOfWeek));
  const { load, assignedDaysByUser } = seedLoadFromLocked(locked);

  const assignments: PlannerAssignment[] = [...locked];
  const warnings: string[] = [];
  const dayPlans: DayPlan[] = [];
  const lockedByDay = new Map<number, PlannerAssignment[]>();
  for (const a of locked) {
    const list = lockedByDay.get(a.dayOfWeek) ?? [];
    list.push(a);
    lockedByDay.set(a.dayOfWeek, list);
  }

  // Locked days that already have an SL count as covered for open/close spreading
  const alreadyCovered = new Map<number, PlannerStaff>();
  for (const [day, list] of lockedByDay) {
    if ((input.mapsPerDay[day] ?? 0) <= 0) continue;
    const slA = list.find((a) => a.isShiftLeader);
    if (!slA) continue;
    const person = staff.find((s) => s.userId === slA.userId);
    if (person) alreadyCovered.set(day, person);
  }

  const { designated: openCloseByDay, notesByDay: logicNotesByDay } =
    assignOpenCloseShiftLeaders({
      staff,
      mapsPerDay: input.mapsPerDay,
      planDays,
      weekStart: input.weekStart,
      load,
      assignedDaysByUser,
      alreadyCovered,
      variant,
      avoidUserIds,
    });

  for (const dayOfWeek of AVAILABILITY_DAYS) {
    const mapsCount = input.mapsPerDay[dayOfWeek] ?? 0;
    const preferredNeeded = staffNeededForMaps(mapsCount);
    const hardMin = minStaffToCoverMaps(mapsCount);

    if (!planDays.has(dayOfWeek)) {
      const dayAssignments = lockedByDay.get(dayOfWeek) ?? [];
      const hasSl = dayAssignments.some((a) => a.isShiftLeader);
      const assignedPeople = dayAssignments
        .map((a) => staff.find((s) => s.userId === a.userId))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const hardCap = assignedPeople.reduce((n, s) => n + mapCapacityOf(s, true), 0);
      const issues: string[] = [];
      if (mapsCount > 0) {
        if (!hasSl) issues.push("Missing shift leader to open/close.");
        if (dayAssignments.length < 2) {
          issues.push("Need at least one more supervisor (SL or Sup).");
        }
        if (hardCap < mapsCount) {
          issues.push(
            `Not enough people for ${mapsCount} map(s) (max ${MAX_MAPS_PER_SUPERVISOR}/person).`
          );
        } else if (dayAssignments.length < preferredNeeded) {
          issues.push(
            `Thin roster — prefer ~${preferredNeeded} people (~${PREFERRED_MAPS_PER_SUPERVISOR} maps each).`
          );
        }
      }
      dayPlans.push({
        dayOfWeek,
        label: dayLabel(dayOfWeek),
        mapsCount,
        staffNeeded: preferredNeeded,
        assignments: dayAssignments,
        ok: issues.filter((i) => !i.includes("Thin roster")).length === 0,
        issues,
      });
      if (issues.length > 0) warnings.push(`${dayLabel(dayOfWeek)}: ${issues.join(" ")}`);
      continue;
    }

    const dayAssignments: PlannerAssignment[] = [];
    const issues: string[] = [];

    if (preferredNeeded === 0) {
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

    const dayMaps = input.mapsByDay?.[dayOfWeek] ?? [];
    const mapClocks = mapClockMinutes(dayMaps);
    const target = Math.max(preferredNeeded, hardMin);

    const logicNotes = [...(logicNotesByDay.get(dayOfWeek) ?? [])];
    logicNotes.push(
      `Target roster ~${preferredNeeded} people for ${mapsCount} maps (prefer ~${PREFERRED_MAPS_PER_SUPERVISOR}/person, hard max ${MAX_MAPS_PER_SUPERVISOR}).`
    );

    // Open/close SL already chosen (and reserved) in the week-wide spread pass
    const openClose = openCloseByDay.get(dayOfWeek);
    if (!openClose) {
      issues.push("No shift leader available to open/close.");
    } else {
      dayAssignments.push({
        dayOfWeek,
        userId: openClose.userId,
        userName: openClose.name,
        isShiftLeader: true,
      });
    }

    while (dayAssignments.length < target) {
      const picked = pickStaff(
        staff,
        dayOfWeek,
        load,
        assignedDaysByUser,
        input.weekStart,
        mapClocks,
        { variant, avoidUserIds }
      );
      if (!picked) break;
      const before = load.get(picked.userId) ?? 0;
      logicNotes.push(staffFillNote(picked, dayOfWeek, before, mapClocks, "fair-fill"));
      recordAssignment(picked, dayOfWeek, load, assignedDaysByUser, dayAssignments);
    }

    // Expand until hard map capacity (≥9 each) can cover every map
    while (dayAssignments.length * MAX_MAPS_PER_SUPERVISOR < mapsCount) {
      const picked = pickStaff(
        staff,
        dayOfWeek,
        load,
        assignedDaysByUser,
        input.weekStart,
        mapClocks,
        { variant, avoidUserIds }
      );
      if (!picked) break;
      const before = load.get(picked.userId) ?? 0;
      logicNotes.push(staffFillNote(picked, dayOfWeek, before, mapClocks, "hard-capacity"));
      recordAssignment(picked, dayOfWeek, load, assignedDaysByUser, dayAssignments);
    }

    // Expand for map start times nobody on the roster can cover yet
    const uniqueClocks = [...new Set(mapClocks)];
    for (const clock of uniqueClocks) {
      const rosterCovers = dayAssignments.some((a) => {
        const person = staff.find((s) => s.userId === a.userId);
        return (
          person &&
          availabilityCoversClock(
            person.days.find((d) => d.dayOfWeek === dayOfWeek),
            clock
          )
        );
      });
      if (rosterCovers) continue;
      const picked = pickStaff(
        staff,
        dayOfWeek,
        load,
        assignedDaysByUser,
        input.weekStart,
        mapClocks,
        { variant, avoidUserIds, requireCoverClock: clock }
      );
      if (!picked) continue;
      const before = load.get(picked.userId) ?? 0;
      logicNotes.push(staffFillNote(picked, dayOfWeek, before, mapClocks, "hour-cover", clock));
      recordAssignment(picked, dayOfWeek, load, assignedDaysByUser, dayAssignments);
    }

    const hasSl = dayAssignments.some((a) => a.isShiftLeader);
    const assignedPeople = dayAssignments
      .map((a) => staff.find((s) => s.userId === a.userId))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const preferredCap = assignedPeople.reduce((n, s) => n + mapCapacityOf(s, false), 0);
    const hardCap = assignedPeople.reduce((n, s) => n + mapCapacityOf(s, true), 0);
    const coversHard = hardCap >= mapsCount;

    const uncoveredClocks = uniqueClocks.filter(
      (clock) =>
        !assignedPeople.some((s) =>
          availabilityCoversClock(
            s.days.find((d) => d.dayOfWeek === dayOfWeek),
            clock
          )
        )
    );
    if (uncoveredClocks.length > 0) {
      const hhmm = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const times = [...new Set(uncoveredClocks.map(hhmm))].join(", ");
      const uncoveredMapCount = mapClocks.filter((c) => uncoveredClocks.includes(c)).length;
      issues.push(
        `ALERT: ${uncoveredMapCount} map(s) at ${times} have nobody available in those hours` +
          (coversHard
            ? ` — on-shift people are already at ~${MAX_MAPS_PER_SUPERVISOR} maps. Ask others if they can help.`
            : `. Ask staff if someone can cover these hours.`)
      );
    }

    if (!hasSl) issues.push("Missing shift leader to open/close.");
    if (dayAssignments.length < 2) issues.push("Need at least one more supervisor (SL or Sup).");
    if (!coversHard) {
      issues.push(
        `ALERT: Not enough people for ${mapsCount} map(s) even at ${MAX_MAPS_PER_SUPERVISOR}/person — ask for more help.`
      );
    } else if (dayAssignments.length < preferredNeeded || preferredCap < mapsCount) {
      issues.push(
        `Prefer ~${preferredNeeded} people (~${PREFERRED_MAPS_PER_SUPERVISOR} maps each); currently ${dayAssignments.length}.`
      );
    }

    const hardOk = hasSl && dayAssignments.length >= 2 && coversHard;

    dayPlans.push({
      dayOfWeek,
      label: dayLabel(dayOfWeek),
      mapsCount,
      staffNeeded: preferredNeeded,
      assignments: dayAssignments,
      ok: hardOk,
      issues,
      logicNotes,
    });

    assignments.push(...dayAssignments);
    if (issues.length > 0) warnings.push(`${dayLabel(dayOfWeek)}: ${issues.join(" ")}`);
  }

  assignments.sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.userName.localeCompare(b.userName)
  );

  return { assignments, dayPlans, warnings };
}

export function validatePlanAssignments(input: {
  staff: PlannerStaff[];
  assignments: PlannerAssignment[];
  mapsPerDay: Record<number, number>;
  weekStart?: Date;
}): { dayPlans: DayPlan[]; warnings: string[] } {
  const warnings: string[] = [];
  const dayPlans: DayPlan[] = [];
  const byDay = new Map<number, PlannerAssignment[]>();

  for (const a of input.assignments) {
    const list = byDay.get(a.dayOfWeek) ?? [];
    list.push(a);
    byDay.set(a.dayOfWeek, list);
  }

  const staffById = new Map(
    input.staff.map((s) => [s.userId, { ...s, supervisorRating: effectiveRating(s) }])
  );

  for (const dayOfWeek of AVAILABILITY_DAYS) {
    const mapsCount = input.mapsPerDay[dayOfWeek] ?? 0;
    const preferredNeeded = staffNeededForMaps(mapsCount);
    const dayAssignments = byDay.get(dayOfWeek) ?? [];
    const issues: string[] = [];

    if (preferredNeeded === 0 && dayAssignments.length === 0) {
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
      else if (!staffEligibleForDay(person, dayOfWeek, input.weekStart)) {
        issues.push(`${a.userName} not available (or not allowed on hagim).`);
      }
    }

    const hasSl = dayAssignments.some((a) => a.isShiftLeader);
    const assignedPeople = dayAssignments
      .map((a) => staffById.get(a.userId))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const hardCap = assignedPeople.reduce((n, s) => n + mapCapacityOf(s, true), 0);

    if (mapsCount > 0) {
      if (!hasSl) issues.push("Need a shift leader to open/close.");
      if (dayAssignments.length < 2) {
        issues.push("Need at least one more supervisor (SL or Sup).");
      }
      if (hardCap < mapsCount) {
        issues.push(
          `Cannot cover ${mapsCount} map(s) even at ${MAX_MAPS_PER_SUPERVISOR}/person.`
        );
      } else if (dayAssignments.length < preferredNeeded) {
        issues.push(
          `Prefer ~${preferredNeeded} people (~${PREFERRED_MAPS_PER_SUPERVISOR} maps each) for ${mapsCount} map(s).`
        );
      }
    }

    const blocking = issues.filter(
      (i) => !i.includes("Prefer ~") && !i.includes("preferred") && !i.includes("Thin roster")
    );
    const ok = blocking.length === 0;
    if (issues.length > 0) warnings.push(`${dayLabel(dayOfWeek)}: ${issues.join(" ")}`);

    dayPlans.push({
      dayOfWeek,
      label: dayLabel(dayOfWeek),
      mapsCount,
      staffNeeded: preferredNeeded,
      assignments: dayAssignments,
      ok,
      issues,
    });
  }

  return { dayPlans, warnings };
}
