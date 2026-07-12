/** Availability — Sun(0) through Fri(5); Saturday is not scheduled */

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
export const MAX_NIGHT_SHIFTS_PER_WEEK = 3;

export const FRIDAY = 5;
export const SATURDAY = 6;
export const SUNDAY = 0;

export type AvailabilityDayInput = {
  dayOfWeek: number;
  canWork: boolean;
  allDay?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  note?: string | null;
};

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
  return days
    .filter(
      (d) =>
        d.canWork &&
        !d.allDay &&
        d.startMinutes != null &&
        d.endMinutes != null
    )
    .map((d) => ({
      dayOfWeek: d.dayOfWeek,
      startMinutes: d.startMinutes!,
      endMinutes: d.endMinutes!,
    }));
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

/** Duration in minutes; supports overnight (end next day) */
export function shiftDurationMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes > startMinutes) return endMinutes - startMinutes;
  if (endMinutes === startMinutes) return 0;
  return 24 * 60 - startMinutes + endMinutes;
}

export function isNightShift(startMinutes: number, endMinutes: number): boolean {
  if (startMinutes < NIGHT_START_MINUTES) return false;
  return shiftDurationMinutes(startMinutes, endMinutes) >= MIN_SHIFT_MINUTES;
}

export function hasShiftOnDay(shifts: AvailabilityShiftInput[], day: number): boolean {
  return shifts.some((s) => s.dayOfWeek === day);
}

export function validateAvailabilityDays(
  days: AvailabilityDayInput[],
  fridayContract: boolean
): string[] {
  const errors: string[] = [];

  if (days.length < AVAILABILITY_DAYS.length) {
    errors.push("Mark every day as available or not available.");
  }

  for (const d of days) {
    if (d.dayOfWeek === SATURDAY) {
      errors.push("Saturday is not a scheduling day.");
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
      continue;
    }
    const dur = shiftDurationMinutes(d.startMinutes, d.endMinutes);
    if (dur < MIN_SHIFT_MINUTES) {
      errors.push(
        `${DAY_LABELS[d.dayOfWeek]}: shift must be at least 6 hours (got ${(dur / 60).toFixed(1)}h).`
      );
    }
    if (dur > MAX_SHIFT_MINUTES) {
      errors.push(
        `${DAY_LABELS[d.dayOfWeek]}: shift cannot exceed 12 hours (got ${(dur / 60).toFixed(1)}h).`
      );
    }
  }

  const shifts = daysToShiftInputs(days);
  const ruleErrors = validateAvailability(shifts, fridayContract, days);
  return errors.concat(ruleErrors);
}

export function validateAvailability(
  shifts: AvailabilityShiftInput[],
  fridayContract: boolean,
  days?: AvailabilityDayInput[]
): string[] {
  const errors: string[] = [];

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

  if (fridayContract && workOn(SUNDAY)) {
    errors.push("Friday contract: you can work Friday but not Sunday.");
  }
  if (!fridayContract && workOn(FRIDAY)) {
    errors.push("No Friday contract: you can work Sunday but not Friday.");
  }

  const friFree = !workOn(FRIDAY);
  const satFree = !workOn(SATURDAY);
  const sunFree = !workOn(SUNDAY);
  if (!(friFree && satFree) && !(satFree && sunFree)) {
    errors.push("You need 2 free days in a row: Friday+Saturday OR Saturday+Sunday.");
  }

  const nightCount = shifts.filter((s) => isNightShift(s.startMinutes, s.endMinutes)).length;
  if (nightCount > MAX_NIGHT_SHIFTS_PER_WEEK) {
    errors.push(`Maximum ${MAX_NIGHT_SHIFTS_PER_WEEK} night shifts per week (starts 23:00, min 6h).`);
  }

  return errors;
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
