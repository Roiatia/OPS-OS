/** Availability — Sun(0) through Fri(5); Saturday is not scheduled */

import { canWorkHagim, holidaysInAvailabilityWeek } from "./israelHolidays.js";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export const DAY_LABELS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

export const AVAILABILITY_DAYS = [0, 1, 2, 3, 4, 5] as const;

export const MIN_SHIFT_MINUTES = 6 * 60;
export const MAX_SHIFT_MINUTES = 12 * 60;
export const NIGHT_START_MINUTES = 23 * 60;
export const MAX_NIGHT_SHIFTS_PER_TWO_WEEKS = 7;
/** @deprecated use MAX_NIGHT_SHIFTS_PER_TWO_WEEKS */
export const MAX_NIGHT_SHIFTS_PER_WEEK = 3;

/** Without Friday form: may work Friday only until Shabbat enter (16:00). */
export const FRIDAY_UNSIGNED_END_MINUTES = 16 * 60;
/** Minimum rest between consecutive shifts. */
export const MIN_REST_GAP_MINUTES = 8 * 60;
/** Soft ideal rest gap (warning only where surfaced). */
export const IDEAL_REST_GAP_MINUTES = 10 * 60;
/** Hard cap — nobody should take more maps than this in one day. */
export const MAX_MAPS_PER_SUPERVISOR = 9;
/** Soft floor — even the weakest supervisor can handle this many maps. */
export const MIN_MAPS_BY_RATING = 5;
/** Soft target — schedule enough people so loads stay around this (fairness over cost). */
export const PREFERRED_MAPS_PER_SUPERVISOR = 5;

export const FRIDAY = 5;
export const SATURDAY = 6;
export const SUNDAY = 0;

/**
 * Soft max maps/day from rating (1–9 scale).
 * Rating ≈ preferred map load; floor 5 (even rating 1–4 → 5); hard max 9.
 * Soft only — if someone is alone on a day with 9 maps, they still take them.
 * SLs should be treated as 9 by callers.
 */
export function maxMapsForRating(rating: number | null | undefined): number {
  if (rating == null || !Number.isFinite(rating)) {
    return MIN_MAPS_BY_RATING;
  }
  const r = Math.min(9, Math.max(1, Math.round(rating)));
  return Math.min(MAX_MAPS_PER_SUPERVISOR, Math.max(MIN_MAPS_BY_RATING, r));
}

/** Display / effective rating: SLs are always 9. */
export function effectiveSupervisorRating(
  rating: number | null | undefined,
  isShiftLeader?: boolean
): number {
  if (isShiftLeader) return 9;
  if (rating == null || !Number.isFinite(rating)) return MIN_MAPS_BY_RATING;
  return Math.min(9, Math.max(1, Math.round(rating)));
}

export type AvailabilityDayInput = {
  dayOfWeek: number;
  canWork: boolean;
  allDay?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  startMinutes2?: number | null;
  endMinutes2?: number | null;
  note?: string | null;
};

export type HourRange = { startMinutes: number; endMinutes: number };

export const MIN_SEGMENT_MINUTES = 60;

export function dayHourRanges(d: AvailabilityDayInput): HourRange[] {
  if (!d.canWork || d.allDay) return [];
  const ranges: HourRange[] = [];
  if (d.startMinutes != null && d.endMinutes != null) {
    ranges.push({ startMinutes: d.startMinutes, endMinutes: d.endMinutes });
  }
  if (d.startMinutes2 != null && d.endMinutes2 != null) {
    ranges.push({ startMinutes: d.startMinutes2, endMinutes: d.endMinutes2 });
  }
  return ranges.sort((a, b) => a.startMinutes - b.startMinutes);
}

/** @deprecated use AvailabilityDayInput */
export type AvailabilityShiftInput = {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
};

export function hasWorkOnDay(days: AvailabilityDayInput[], day: number): boolean {
  return days.some((d) => d.dayOfWeek === day && d.canWork);
}

export function daysToShiftInputs(days: AvailabilityDayInput[]): AvailabilityShiftInput[] {
  const out: AvailabilityShiftInput[] = [];
  for (const d of days) {
    for (const r of dayHourRanges(d)) {
      out.push({ dayOfWeek: d.dayOfWeek, startMinutes: r.startMinutes, endMinutes: r.endMinutes });
    }
  }
  return out;
}

export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Wall-clock minutes in Israel (ops timezone) — not the server's local zone. */
export function clockMinutesFromDate(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** How many Sun–Fri days the person marked available. */
export function availableDaysCount(
  days: { dayOfWeek: number; canWork: boolean }[]
): number {
  return days.filter((d) => d.canWork && d.dayOfWeek >= 0 && d.dayOfWeek <= 5).length;
}

/**
 * Fairness ratio: days already assigned / days offered.
 * Lower = underused relative to what they offered — so someone who gave 6 days
 * can take more shifts than someone who gave 1 before looking equally “used”.
 */
export function availabilityUtilization(
  assignedDays: number,
  daysOffered: number
): number {
  return assignedDays / Math.max(1, daysOffered);
}

/** Whether availability covers a map start clock time (all-day = yes). */
export function availabilityCoversClock(
  day:
    | {
        canWork: boolean;
        allDay?: boolean;
        startMinutes?: number | null;
        endMinutes?: number | null;
        startMinutes2?: number | null;
        endMinutes2?: number | null;
      }
    | undefined,
  clockMinutes: number
): boolean {
  if (!day?.canWork) return false;
  if (day.allDay) return true;
  const ranges = dayHourRanges({
    dayOfWeek: 0,
    canWork: true,
    allDay: false,
    startMinutes: day.startMinutes,
    endMinutes: day.endMinutes,
    startMinutes2: day.startMinutes2,
    endMinutes2: day.endMinutes2,
  });
  if (ranges.length === 0) return true;
  return ranges.some((r) => {
    if (r.endMinutes > r.startMinutes) {
      return clockMinutes >= r.startMinutes && clockMinutes < r.endMinutes;
    }
    return clockMinutes >= r.startMinutes || clockMinutes < r.endMinutes;
  });
}

export function formatAvailabilityWindow(day: {
  canWork: boolean;
  allDay?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  startMinutes2?: number | null;
  endMinutes2?: number | null;
}): string {
  if (!day.canWork) return "—";
  if (day.allDay) return "all day";
  const ranges = dayHourRanges({
    dayOfWeek: 0,
    canWork: true,
    allDay: false,
    startMinutes: day.startMinutes,
    endMinutes: day.endMinutes,
    startMinutes2: day.startMinutes2,
    endMinutes2: day.endMinutes2,
  });
  if (ranges.length === 0) return "hours TBD";
  return ranges
    .map((r) => `${minutesToTime(r.startMinutes)}–${minutesToTime(r.endMinutes)}`)
    .join(", ");
}

/** Duration in minutes; supports overnight (end next day) */
export function shiftDurationMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes > startMinutes) return endMinutes - startMinutes;
  if (endMinutes === startMinutes) return 0;
  return 24 * 60 - startMinutes + endMinutes;
}

export function sameDayDurationMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes <= startMinutes) return 0;
  return endMinutes - startMinutes;
}

export function contiguousWorkBlocks(
  days: AvailabilityDayInput[]
): { dayOfWeek: number; startMinutes: number; endMinutes: number; duration: number }[] {
  type Seg = { dayOfWeek: number; startMinutes: number; endMinutes: number };
  const segs: Seg[] = [];
  for (const d of days) {
    for (const r of dayHourRanges(d)) {
      segs.push({ dayOfWeek: d.dayOfWeek, startMinutes: r.startMinutes, endMinutes: r.endMinutes });
    }
  }
  segs.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinutes - b.startMinutes);

  const used = new Set<string>();
  const blocks: { dayOfWeek: number; startMinutes: number; endMinutes: number; duration: number }[] =
    [];
  const key = (s: Seg) => `${s.dayOfWeek}:${s.startMinutes}:${s.endMinutes}`;

  for (const seg of segs) {
    if (used.has(key(seg))) continue;
    let end = seg.endMinutes;
    let duration = sameDayDurationMinutes(seg.startMinutes, end);
    used.add(key(seg));

    let cursorDay = seg.dayOfWeek;
    while (end === 24 * 60) {
      const nextDay = cursorDay === 5 ? -1 : cursorDay + 1;
      if (nextDay < 0) break;
      const next = segs.find(
        (s) => s.dayOfWeek === nextDay && s.startMinutes === 0 && !used.has(key(s))
      );
      if (!next) break;
      duration += sameDayDurationMinutes(next.startMinutes, next.endMinutes);
      end = next.endMinutes;
      used.add(key(next));
      cursorDay = nextDay;
      if (end < 24 * 60) break;
    }

    blocks.push({
      dayOfWeek: seg.dayOfWeek,
      startMinutes: seg.startMinutes,
      endMinutes: end,
      duration,
    });
  }

  return blocks;
}

export function isNightShift(startMinutes: number, endMinutes: number): boolean {
  if (startMinutes < NIGHT_START_MINUTES) return false;
  return shiftDurationMinutes(startMinutes, endMinutes) >= MIN_SHIFT_MINUTES;
}

export function hasShiftOnDay(shifts: AvailabilityShiftInput[], day: number): boolean {
  return shifts.some((s) => s.dayOfWeek === day);
}

export function isNightShiftDay(day: {
  canWork: boolean;
  allDay?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  isNight?: boolean;
}): boolean {
  if (!day.canWork) return false;
  if (day.isNight !== undefined) return day.isNight;
  if (day.allDay) return false;
  if (day.startMinutes == null || day.endMinutes == null) return false;
  return day.startMinutes >= NIGHT_START_MINUTES;
}

export function countNightShiftsFromDays(days: AvailabilityDayInput[]): number {
  return contiguousWorkBlocks(days).filter(
    (b) => b.startMinutes >= NIGHT_START_MINUTES && b.duration >= MIN_SHIFT_MINUTES
  ).length;
}

export function validateAvailabilityDays(
  days: AvailabilityDayInput[],
  fridayContract: boolean,
  priorWeekNightCount = 0,
  opts?: {
    sundayOk?: boolean;
    /** @deprecated hagim follows Friday form */
    hagimOk?: boolean;
    weekStart?: Date;
    maxRequestedHours?: number | null;
  }
): string[] {
  const errors: string[] = [];
  const sundayOk = opts?.sundayOk ?? !fridayContract;
  const maxRequestedMinutes =
    opts?.maxRequestedHours != null && opts.maxRequestedHours > 0
      ? Math.min(MAX_SHIFT_MINUTES, Math.round(opts.maxRequestedHours * 60))
      : MAX_SHIFT_MINUTES;

  if (days.length < AVAILABILITY_DAYS.length) {
    errors.push("Mark every day as available or not available.");
  }

  for (const d of days) {
    if (d.dayOfWeek === SATURDAY) {
      errors.push("Saturday is not a scheduling day (Shabbat — company day off).");
      continue;
    }
    if (d.dayOfWeek < 0 || d.dayOfWeek > 5) {
      errors.push("Invalid day.");
      continue;
    }
    if (!d.canWork) continue;
    if (d.allDay) continue;
    if (d.startMinutes == null || d.endMinutes == null) {
      errors.push(`${DAY_LABELS[d.dayOfWeek]}: enter start and end hours, or choose all day.`);
    }
  }

  for (const d of days) {
    if (!d.canWork || d.allDay) continue;
    const ranges = dayHourRanges(d);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      if (sameDayDurationMinutes(r.startMinutes, r.endMinutes) <= 0) {
        errors.push(`${DAY_LABELS[d.dayOfWeek]}: invalid hour range.`);
      }
      if (i > 0 && r.startMinutes < ranges[i - 1]!.endMinutes) {
        errors.push(`${DAY_LABELS[d.dayOfWeek]}: hour blocks overlap.`);
      }
    }
    if (ranges.length >= 2) {
      const total = ranges.reduce(
        (n, r) => n + sameDayDurationMinutes(r.startMinutes, r.endMinutes),
        0
      );
      for (const r of ranges) {
        const dur = sameDayDurationMinutes(r.startMinutes, r.endMinutes);
        if (dur < MIN_SEGMENT_MINUTES) {
          errors.push(`${DAY_LABELS[d.dayOfWeek]}: each block must be at least 1 hour.`);
        }
        if (dur > maxRequestedMinutes) {
          errors.push(
            `${DAY_LABELS[d.dayOfWeek]}: a block cannot exceed ${maxRequestedMinutes / 60} hours (got ${(dur / 60).toFixed(1)}h).`
          );
        }
      }
      if (total < MIN_SHIFT_MINUTES) {
        errors.push(
          `${DAY_LABELS[d.dayOfWeek]}: combined blocks must be at least 6 hours (got ${(total / 60).toFixed(1)}h).`
        );
      }
    }
  }

  for (const b of contiguousWorkBlocks(days)) {
    const day = days.find((d) => d.dayOfWeek === b.dayOfWeek);
    const multi = day ? dayHourRanges(day).length >= 2 : false;
    if (multi) continue;
    if (b.duration < MIN_SHIFT_MINUTES) {
      errors.push(
        `${DAY_LABELS[b.dayOfWeek]}: shift must be at least 6 hours (got ${(b.duration / 60).toFixed(1)}h — include next morning if overnight).`
      );
    }
    if (b.duration > maxRequestedMinutes) {
      errors.push(
        `${DAY_LABELS[b.dayOfWeek]}: shift cannot exceed ${maxRequestedMinutes / 60} hours (got ${(b.duration / 60).toFixed(1)}h).`
      );
    }
  }

  errors.push(...validateRestGaps(days));

  const shifts = daysToShiftInputs(days);
  const ruleErrors = validateAvailability(shifts, fridayContract, days, { sundayOk }).filter(
    (e) => !e.includes("at least 6 hours") && !e.includes("cannot exceed")
  );
  errors.push(...ruleErrors);

  if (opts?.weekStart) {
    errors.push(...validateHagimDays(days, fridayContract, opts.weekStart));
  }

  const thisWeekNights = countNightShiftsFromDays(days);
  if (priorWeekNightCount + thisWeekNights > MAX_NIGHT_SHIFTS_PER_TWO_WEEKS) {
    errors.push(
      `Maximum ${MAX_NIGHT_SHIFTS_PER_TWO_WEEKS} night shifts per 2 weeks (this week: ${thisWeekNights}, prior week: ${priorWeekNightCount}).`
    );
  }

  return errors;
}

function validateRestGaps(days: AvailabilityDayInput[]): string[] {
  const errors: string[] = [];
  const blocks = contiguousWorkBlocks(days)
    .map((b) => ({
      ...b,
      startAbs: b.dayOfWeek * 24 * 60 + b.startMinutes,
      endAbs: b.dayOfWeek * 24 * 60 + b.startMinutes + b.duration,
    }))
    .sort((a, b) => a.startAbs - b.startAbs);

  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1]!;
    const next = blocks[i]!;
    const gap = next.startAbs - prev.endAbs;
    if (gap < MIN_REST_GAP_MINUTES) {
      errors.push(
        `Need at least 8 hours rest between shifts (${DAY_LABELS[prev.dayOfWeek]} → ${DAY_LABELS[next.dayOfWeek]}: ${(gap / 60).toFixed(1)}h gap). Ideal is 10–12 hours.`
      );
    }
  }
  return errors;
}

function validateHagimDays(
  days: AvailabilityDayInput[],
  fridayContract: boolean,
  weekStart: Date
): string[] {
  if (canWorkHagim(fridayContract)) return [];
  const errors: string[] = [];
  for (const h of holidaysInAvailabilityWeek(weekStart)) {
    if (hasWorkOnDay(days, h.dayOfWeek)) {
      errors.push(
        `${DAY_LABELS[h.dayOfWeek]} is ${h.name} (חג) — only people who signed the Friday form can work hagim.`
      );
    }
  }
  return errors;
}

export function validateAvailability(
  shifts: AvailabilityShiftInput[],
  fridayContract: boolean,
  days?: AvailabilityDayInput[],
  opts?: { sundayOk?: boolean }
): string[] {
  const errors: string[] = [];
  const sundayOk = opts?.sundayOk ?? !fridayContract;

  for (const s of shifts) {
    if (s.dayOfWeek < 0 || s.dayOfWeek > 6) {
      errors.push("Invalid day in shift.");
      continue;
    }
    const dur = shiftDurationMinutes(s.startMinutes, s.endMinutes);
    if (dur < MIN_SHIFT_MINUTES) {
      errors.push(
        `${DAY_LABELS[s.dayOfWeek]}: shift must be at least 6 hours (got ${(dur / 60).toFixed(1)}h).`
      );
    }
    if (dur > MAX_SHIFT_MINUTES) {
      errors.push(
        `${DAY_LABELS[s.dayOfWeek]}: shift cannot exceed 12 hours (got ${(dur / 60).toFixed(1)}h).`
      );
    }
  }

  const workOn = (day: number) =>
    days ? hasWorkOnDay(days, day) : hasShiftOnDay(shifts, day);

  if (workOn(SUNDAY) && !sundayOk) {
    errors.push(
      "Sunday is not enabled — turn on “I can work Sunday”, or turn off Friday-only if you only work Sundays."
    );
  }

  // Unsigned: Friday OK only until 16:00 (Shabbat enter). Signed: full Friday OK.
  if (!fridayContract && days) {
    const fri = days.find((d) => d.dayOfWeek === FRIDAY && d.canWork);
    if (fri) {
      if (fri.allDay) {
        errors.push(
          "Without the Friday form: Friday only until 16:00 (Shabbat enter) — all-day is not allowed."
        );
      } else {
        for (const r of dayHourRanges(fri)) {
          if (r.endMinutes > FRIDAY_UNSIGNED_END_MINUTES) {
            errors.push(
              `Without the Friday form: Friday work must end by 16:00 (Shabbat enter). Got end ${minutesToTime(r.endMinutes)}.`
            );
          }
        }
      }
    }
  } else if (!fridayContract && workOn(FRIDAY) && !days) {
    errors.push(
      "Without the Friday form: Friday work must end by 16:00 (Shabbat enter)."
    );
  }

  // Saturday always off (company Shabbat)
  if (workOn(SATURDAY)) {
    errors.push("Saturday is Shabbat — company day off.");
  }

  return errors;
}

export type ShiftCoverageDay = {
  dayOfWeek: number;
  label: string;
  supervisors: number;
  shiftLeaders: number;
  staffTotal: number;
  active: boolean;
  ok: boolean;
};

export function computeShiftCoverageByDay(
  roster: {
    user: { isShiftLeader: boolean };
    submission: { days: { dayOfWeek: number; canWork: boolean }[] } | null;
  }[]
): ShiftCoverageDay[] {
  return AVAILABILITY_DAYS.map((dayOfWeek, idx) => {
    let supervisors = 0;
    let shiftLeaders = 0;
    for (const row of roster) {
      const day = row.submission?.days.find((d) => d.dayOfWeek === dayOfWeek);
      if (!day?.canWork) continue;
      if (row.user.isShiftLeader) shiftLeaders += 1;
      else supervisors += 1;
    }
    const staffTotal = supervisors + shiftLeaders;
    const active = staffTotal > 0;
    const ok = !active || (supervisors >= 1 && shiftLeaders >= 1);
    return {
      dayOfWeek,
      label: DAY_LABELS[idx],
      supervisors,
      shiftLeaders,
      staffTotal,
      active,
      ok,
    };
  });
}

/** Sunday that starts the week containing `date` */
export function weekStartSunday(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/** Default week supervisors should fill — next week starting Sunday */
export function defaultSubmissionWeekStart(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisSunday = weekStartSunday(today);
  const nextSunday = new Date(thisSunday);
  nextSunday.setDate(nextSunday.getDate() + 7);
  return nextSunday;
}

export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 5);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

export function dateForDay(weekStart: Date, dayOfWeek: number): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOfWeek);
  return d;
}
