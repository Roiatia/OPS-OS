/** Availability — Sun(0) through Fri(5); Saturday is not scheduled */

import { canWorkHagim, holidaysInAvailabilityWeek } from "./israelHolidays";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export const DAY_LABELS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

/** Day indices shown in the availability UI (excludes Saturday) */
export const AVAILABILITY_DAYS = [0, 1, 2, 3, 4, 5] as const;

export const MIN_SHIFT_MINUTES = 6 * 60;
export const MAX_SHIFT_MINUTES = 12 * 60;
export const NIGHT_START_MINUTES = 22 * 60;
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
/** Soft target — schedule enough people so loads stay around this (fairness over cost). */
export const PREFERRED_MAPS_PER_SUPERVISOR = 5;

export const FRIDAY = 5;
export const SATURDAY = 6;
export const SUNDAY = 0;

/** Preferred day load by rating (experience). Never above MAX; used as soft capacity only. */
export function maxMapsForRating(rating: number | null | undefined): number {
  const r = rating == null ? 3 : Math.min(5, Math.max(1, Math.round(rating)));
  const table: Record<number, number> = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
  return Math.min(MAX_MAPS_PER_SUPERVISOR, table[r] ?? PREFERRED_MAPS_PER_SUPERVISOR);
}

export type AvailabilityDayInput = {
  dayOfWeek: number;
  canWork: boolean;
  allDay?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  /** Optional second block same day (e.g. 9–15 then 16–20) */
  startMinutes2?: number | null;
  endMinutes2?: number | null;
  note?: string | null;
};

export type HourRange = { startMinutes: number; endMinutes: number };

export const MIN_SEGMENT_MINUTES = 60;

/** Timed ranges for a work day (1 or 2 blocks), sorted by start. */
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

/** Wall-clock minutes in Israel (ops timezone) — not the browser's local zone. */
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

export function availableDaysCount(
  days: { dayOfWeek: number; canWork: boolean }[]
): number {
  return days.filter((d) => d.canWork && d.dayOfWeek >= 0 && d.dayOfWeek <= 5).length;
}

export function availabilityUtilization(
  assignedDays: number,
  daysOffered: number
): number {
  return assignedDays / Math.max(1, daysOffered);
}

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

export function shiftDurationMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes > startMinutes) return endMinutes - startMinutes;
  if (endMinutes === startMinutes) return 0;
  // Overnight within a single stored day (legacy wrap)
  return 24 * 60 - startMinutes + endMinutes;
}

/** Same-calendar-day span; endMinutes may be 1440 (midnight). */
export function sameDayDurationMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes <= startMinutes) return 0;
  return endMinutes - startMinutes;
}

/**
 * Merge overnight chains: day ends at 24:00 and next day starts at 00:00.
 * Returns total work minutes for contiguous blocks.
 */
export function contiguousWorkBlocks(
  days: AvailabilityDayInput[]
): { dayOfWeek: number; startMinutes: number; endMinutes: number; duration: number }[] {
  // Expand each day into range segments; overnight only stitches day-end (1440) → next day start 0
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
      if (nextDay < 0 || nextDay > 5) break;
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

export function countNightShiftsFromDays(
  days: {
    dayOfWeek?: number;
    canWork: boolean;
    allDay?: boolean;
    startMinutes?: number | null;
    endMinutes?: number | null;
    isNight?: boolean;
  }[]
): number {
  const inputs = days as AvailabilityDayInput[];
  const blocks = contiguousWorkBlocks(
    inputs.map((d) => ({
      dayOfWeek: d.dayOfWeek ?? 0,
      canWork: d.canWork,
      allDay: d.allDay,
      startMinutes: d.startMinutes,
      endMinutes: d.endMinutes,
    }))
  );
  // Night = block starts at/after 22:00 and lasts ≥ 6h (may span midnight via two days)
  return blocks.filter(
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
    if (!d.canWork) continue;
    if (d.allDay) continue;
    if (d.startMinutes == null || d.endMinutes == null) {
      errors.push(`${DAY_LABELS[d.dayOfWeek]}: enter hours or choose all day.`);
    }
  }

  if (errors.length > 0) return errors;

  for (const d of days) {
    if (!d.canWork || d.allDay) continue;
    const ranges = dayHourRanges(d);
    if (ranges.length === 0) continue;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      const dur = sameDayDurationMinutes(r.startMinutes, r.endMinutes);
      if (dur <= 0) {
        errors.push(`${DAY_LABELS[d.dayOfWeek]}: invalid hour range.`);
      }
      if (i > 0) {
        const prev = ranges[i - 1]!;
        if (r.startMinutes < prev.endMinutes) {
          errors.push(`${DAY_LABELS[d.dayOfWeek]}: hour blocks overlap.`);
        }
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

  const blocks = contiguousWorkBlocks(days);
  for (const b of blocks) {
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

  const ruleErrors = validateAvailability(daysToShiftInputs(days), fridayContract, days, {
    sundayOk,
  });
  errors.push(
    ...ruleErrors.filter(
      (e) => !e.includes("minimum 6 hours") && !e.includes("maximum 12 hours") && !e.includes("cannot exceed")
    )
  );

  if (opts?.weekStart) {
    errors.push(...validateHagimDays(days, fridayContract, opts.weekStart));
  }

  const thisWeekNights = countNightShiftsFromDays(days);
  if (priorWeekNightCount + thisWeekNights > MAX_NIGHT_SHIFTS_PER_TWO_WEEKS) {
    errors.push(
      `Max ${MAX_NIGHT_SHIFTS_PER_TWO_WEEKS} night shifts per 2 weeks (this week: ${thisWeekNights}, prior: ${priorWeekNightCount}).`
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
      "Sunday is not enabled — turn on “I can work Sunday” (you can tap both Friday and Sunday)."
    );
  }

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

  if (workOn(SATURDAY)) {
    errors.push("Saturday is Shabbat — company day off.");
  }

  return errors;
}

export function weekStartSunday(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function defaultSubmissionWeekStart(): Date {
  const nextSunday = weekStartSunday(new Date());
  nextSunday.setDate(nextSunday.getDate() + 7);
  return nextSunday;
}

export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 5);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

export function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoWeekStart(d: Date): string {
  return toIsoDateLocal(d);
}

/** After Sunday fills are due: nudge Mon–Sat (and Sunday evening if still empty) until submitted */
export function isAvailabilityReminderDue(_now = new Date()): boolean {
  return true;
}
