import type { ShiftPlanAssignment, ShiftPlanStaff, ShiftPlanView } from "../types/availability";
import {
  MAX_MAPS_PER_SUPERVISOR,
  MAX_SHIFT_MINUTES,
  MIN_REST_GAP_MINUTES,
  MIN_SHIFT_MINUTES,
  availabilityCoversClock,
  dayHourRanges,
  minutesToTime,
  type HourRange,
} from "../lib/availabilityRules";

/** One supervisor on a task — only entrance is chosen; end is until avail (max 12h). */
export type MapSupervisorSlot = {
  userId: string;
  /** Entrance hour (same calendar day as the task) */
  startMinutes: number;
  /**
   * End as minutes from that day's midnight.
   * May be > 1440 when the shift continues past midnight into the next morning
   * (e.g. 20:00→02:00 next day ⇒ endMinutes = 1560).
   */
  endMinutes: number;
  /** True when this person takes over after someone else’s availability ends */
  handoff?: boolean;
};

export type UnfilledMapAlert = {
  dayOfWeek: number;
  mapId: string;
  mapNumber: string;
  startLabel: string;
  reason: string;
};

const DAY_MINUTES = 24 * 60;

/** Display end time; values ≥ 24:00 mean next calendar morning. */
export function formatSlotEnd(endMinutes: number): string {
  if (endMinutes < DAY_MINUTES) return minutesToTime(endMinutes);
  return `${minutesToTime(endMinutes - DAY_MINUTES)} (+1)`;
}

export function canSuperviseClient(
  s: ShiftPlanStaff,
  client: string,
  taskKind?: string
): boolean {
  if (
    taskKind === "HAPPY_HOUR" ||
    taskKind === "COMPANY_MEETING" ||
    taskKind === "MAPPING_REFRESH"
  ) {
    return true;
  }
  const allowed = s.allowedClients;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(client);
}

export function coversMapHour(
  s: ShiftPlanStaff,
  dayOfWeek: number,
  clock: number | null
): boolean {
  const day = s.days.find((d) => d.dayOfWeek === dayOfWeek);
  if (!day?.canWork) return false;
  if (clock == null) return true;
  return availabilityCoversClock(day, clock);
}

export function staffDayRanges(s: ShiftPlanStaff, dayOfWeek: number): HourRange[] {
  const day = s.days.find((d) => d.dayOfWeek === dayOfWeek);
  if (!day?.canWork) return [];
  if (day.allDay) return [{ startMinutes: 0, endMinutes: DAY_MINUTES }];
  return dayHourRanges({
    dayOfWeek,
    canWork: true,
    allDay: false,
    startMinutes: day.startMinutes,
    endMinutes: day.endMinutes,
    startMinutes2: day.startMinutes2,
    endMinutes2: day.endMinutes2,
  });
}

function rangeCoversClock(r: HourRange, clock: number): boolean {
  if (r.endMinutes > r.startMinutes) {
    return clock >= r.startMinutes && clock < r.endMinutes;
  }
  return clock >= r.startMinutes || clock < r.endMinutes;
}

/** Same-day end bound for a range when starting at `start`. */
function availableEndFrom(r: HourRange, start: number): number {
  if (r.endMinutes > r.startMinutes) return r.endMinutes;
  if (start >= r.startMinutes) return DAY_MINUTES;
  return r.endMinutes;
}

/**
 * Earliest entrance on `dayOfWeek` after a prior shift, honoring min 8h rest.
 * `prevEndAbs` = end minutes from the previous shift's start-day midnight (may be > 1440).
 */
export function earliestEntranceAfterRest(
  dayOfWeek: number,
  prevDayOfWeek: number,
  prevEndAbs: number
): number {
  const prevEndOnWeek = prevDayOfWeek * DAY_MINUTES + prevEndAbs;
  const dayStartAbs = dayOfWeek * DAY_MINUTES;
  const earliestAbs = prevEndOnWeek + MIN_REST_GAP_MINUTES;
  if (earliestAbs <= dayStartAbs) return 0;
  return earliestAbs - dayStartAbs;
}

/**
 * From entrance: stay until avail ends (max 12h).
 * If the day ends at midnight before 6h is done and next morning starts at 00:00,
 * continue into the next day (e.g. 20:00→02:00) until ≥6h / up to 12h.
 */
export function proposeWorkWindow(
  s: ShiftPlanStaff,
  dayOfWeek: number,
  entranceMinutes: number | null,
  opts?: { allowShort?: boolean; notBeforeMinutes?: number }
): { startMinutes: number; endMinutes: number; duration: number } | null {
  const ranges = staffDayRanges(s, dayOfWeek);
  if (ranges.length === 0) return null;

  let start =
    entranceMinutes != null ? entranceMinutes : ranges[0]!.startMinutes;
  if (opts?.notBeforeMinutes != null && start < opts.notBeforeMinutes) {
    start = opts.notBeforeMinutes;
  }
  if (start >= DAY_MINUTES) return null;

  const range = ranges.find((r) => rangeCoversClock(r, start));
  if (!range) return null;

  const sameDayEnd = availableEndFrom(range, start);
  if (start >= sameDayEnd) return null;

  const maxEndAbs = start + MAX_SHIFT_MINUTES;
  let endAbs = Math.min(sameDayEnd, maxEndAbs);

  // Overnight past midnight: continue into next morning when available from 00:00
  // (incl. Friday→Saturday). If no next-day block but they stay until 24:00 and still
  // need hours for the 6h minimum, extend just enough to finish 6h (e.g. 19:30→01:30).
  if (endAbs === DAY_MINUTES && endAbs < maxEndAbs) {
    const roomPastMidnight = maxEndAbs - DAY_MINUTES;
    let extendTo = 0;
    const nextDow = dayOfWeek + 1;
    if (nextDow <= 6) {
      const nextRanges = staffDayRanges(s, nextDow);
      const cont = nextRanges.find((r) => r.startMinutes === 0);
      if (cont) {
        extendTo = Math.min(availableEndFrom(cont, 0), roomPastMidnight);
      }
    }
    const sameDayDur = DAY_MINUTES - start;
    if (extendTo <= 0 && sameDayDur < MIN_SHIFT_MINUTES) {
      extendTo = Math.min(MIN_SHIFT_MINUTES - sameDayDur, roomPastMidnight);
    }
    if (extendTo > 0) endAbs = DAY_MINUTES + extendTo;
  }

  const duration = endAbs - start;
  if (duration < MIN_SHIFT_MINUTES) {
    if (!opts?.allowShort || duration < 30) return null;
  }
  return { startMinutes: start, endMinutes: endAbs, duration };
}

/** Entrance times (every 30m) that can form a valid window (≥6h, incl. overnight). */
export function allowedStartOptions(
  s: ShiftPlanStaff,
  dayOfWeek: number,
  mapStart: number | null,
  notBeforeMinutes?: number
): number[] {
  const ranges = staffDayRanges(s, dayOfWeek);
  const out: number[] = [];
  const floor = notBeforeMinutes ?? 0;
  for (const r of ranges) {
    const candidates: number[] = [];
    if (r.endMinutes > r.startMinutes) {
      let lo =
        mapStart != null && rangeCoversClock(r, mapStart)
          ? Math.max(mapStart, r.startMinutes)
          : r.startMinutes;
      lo = Math.max(lo, floor);
      for (let m = lo; m < r.endMinutes; m += 30) candidates.push(m);
    } else {
      for (let m = Math.max(r.startMinutes, floor); m < DAY_MINUTES; m += 30) {
        if (mapStart == null || m >= mapStart) candidates.push(m);
      }
      for (let m = Math.max(0, floor); m < r.endMinutes; m += 30) {
        if (mapStart == null || m >= mapStart) candidates.push(m);
      }
    }
    for (const m of candidates) {
      if (proposeWorkWindow(s, dayOfWeek, m, { notBeforeMinutes: floor })) out.push(m);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Rough day vs night band from entrance (for complementary handoff). */
function shiftBand(startMinutes: number): "day" | "night" {
  return startMinutes < 14 * 60 ? "day" : "night";
}

function coverageNeededUntil(
  taskStart: number | null,
  taskEnd: number | null | undefined
): number | null {
  if (taskStart == null) return null;
  if (taskEnd != null && taskEnd > taskStart) {
    return Math.max(taskEnd, taskStart + MIN_SHIFT_MINUTES);
  }
  return null;
}

/**
 * When to auto-add a second supervisor (handoff).
 * Maps range ~5h (small) to multi-day (big) — do NOT default to 2 people on every task.
 * Handoff only when timed coverage outlasts the primary, or the primary can't stay ≥6h.
 */
function needsHandoff(
  primaryEnd: number,
  taskStart: number | null,
  taskEnd: number | null | undefined,
  taskKind?: string
): boolean {
  // Overnight continuation already covers past midnight on this assignment
  if (primaryEnd > DAY_MINUTES) return false;

  // Timed tasks (meeting, refresh, map with scheduled end): handoff only if primary leaves early
  const needed = coverageNeededUntil(taskStart, taskEnd);
  if (needed != null) return primaryEnd < needed;

  // Short internal events without a hard end — one person is enough
  if (taskKind === "COMPANY_MEETING" || taskKind === "HAPPY_HOUR") return false;

  // Open maps with no scheduled end: one supervisor for their full window (6–12h).
  // Big/multi-day maps should set task end (or OPS adds handoff manually).
  // Only auto-handoff if primary somehow still has a short window (<6h).
  if (taskStart == null) return false;
  return primaryEnd - taskStart < MIN_SHIFT_MINUTES;
}

function restFloorForUser(
  userId: string,
  dayOfWeek: number,
  lastShift: Map<string, { day: number; endAbs: number }>
): number {
  const prev = lastShift.get(userId);
  if (!prev) return 0;
  // Same calendar day: maps can overlap (up to 9/person) — rest gap is between days/shifts only
  if (prev.day === dayOfWeek) return 0;
  if (prev.day === dayOfWeek - 1) {
    const floor = earliestEntranceAfterRest(dayOfWeek, prev.day, prev.endAbs);
    return floor >= DAY_MINUTES ? DAY_MINUTES : floor;
  }
  return 0;
}

/**
 * Fill every task from people who offered that day (not only the day roster).
 * Overnight 20→02 when needed for 6h; next-day entrances respect 8h rest.
 */
export function seedMapAssignees(
  mapsPerDay: ShiftPlanView["mapsPerDay"],
  dayAssignments: ShiftPlanAssignment[],
  staff: ShiftPlanStaff[]
): { assignees: Record<string, MapSupervisorSlot[]>; unfilled: UnfilledMapAlert[] } {
  const assignees: Record<string, MapSupervisorSlot[]> = {};
  const unfilled: UnfilledMapAlert[] = [];
  const kindOrder: Record<string, number> = {
    MAP: 0,
    MAPPING_REFRESH: 1,
    HAPPY_HOUR: 2,
    COMPANY_MEETING: 3,
  };
  const lastShift = new Map<string, { day: number; endAbs: number }>();
  const daysOrdered = [...mapsPerDay].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  for (const dayEntry of daysOrdered) {
    const onDayIds = new Set(
      dayAssignments.filter((a) => a.dayOfWeek === dayEntry.dayOfWeek).map((a) => a.userId)
    );
    const pool = staff.filter((s) =>
      s.days.some((d) => d.dayOfWeek === dayEntry.dayOfWeek && d.canWork)
    );

    if (pool.length === 0) {
      for (const m of dayEntry.maps) {
        unfilled.push({
          dayOfWeek: dayEntry.dayOfWeek,
          mapId: m.id,
          mapNumber: m.mapNumber,
          startLabel: m.startMinutes != null ? minutesToTime(m.startMinutes) : "?",
          reason: "Nobody offered availability this day — ask for help",
        });
      }
      continue;
    }

    const mapCounts = new Map<string, number>(pool.map((s) => [s.userId, 0]));
    const mapsOrdered = [...dayEntry.maps].sort(
      (a, b) =>
        (kindOrder[a.taskKind ?? "MAP"] ?? 99) - (kindOrder[b.taskKind ?? "MAP"] ?? 99) ||
        (a.startMinutes ?? 0) - (b.startMinutes ?? 0) ||
        a.mapNumber.localeCompare(b.mapNumber)
    );

    function rankCandidates(
      list: Array<{
        s: ShiftPlanStaff;
        win: { startMinutes: number; endMinutes: number; duration: number };
        short: boolean;
      }>,
      preferOppositeBandOf?: number,
      /** Prefer people who alone cover until this minute (timed tasks). */
      preferCoverUntil?: number | null
    ) {
      list.sort((a, b) => {
        if (a.short !== b.short) return a.short ? 1 : -1;
        if (preferCoverUntil != null) {
          const aCovers = a.win.endMinutes >= preferCoverUntil ? 0 : 1;
          const bCovers = b.win.endMinutes >= preferCoverUntil ? 0 : 1;
          if (aCovers !== bCovers) return aCovers - bCovers;
          if (aCovers === 1 && a.win.endMinutes !== b.win.endMinutes) {
            return b.win.endMinutes - a.win.endMinutes;
          }
        }
        const ca = mapCounts.get(a.s.userId) ?? 0;
        const cb = mapCounts.get(b.s.userId) ?? 0;
        if (ca !== cb) return ca - cb;
        if (preferOppositeBandOf != null) {
          const bandA =
            shiftBand(a.win.startMinutes) === shiftBand(preferOppositeBandOf) ? 1 : 0;
          const bandB =
            shiftBand(b.win.startMinutes) === shiftBand(preferOppositeBandOf) ? 1 : 0;
          if (bandA !== bandB) return bandA - bandB;
        }
        const onA = onDayIds.has(a.s.userId) ? 0 : 1;
        const onB = onDayIds.has(b.s.userId) ? 0 : 1;
        if (onA !== onB) return onA - onB;
        if (a.s.isShiftLeader !== b.s.isShiftLeader) return a.s.isShiftLeader ? 1 : -1;
        const ra = a.s.supervisorRating ?? (a.s.isShiftLeader ? 5 : 3);
        const rb = b.s.supervisorRating ?? (b.s.isShiftLeader ? 5 : 3);
        if (ra !== rb) return rb - ra;
        return a.s.name.localeCompare(b.s.name);
      });
    }

    function recordShift(userId: string, startDay: number, endAbs: number) {
      const prev = lastShift.get(userId);
      if (!prev || prev.day < startDay || (prev.day === startDay && endAbs > prev.endAbs)) {
        lastShift.set(userId, { day: startDay, endAbs });
      }
    }

    for (const m of mapsOrdered) {
      const clock = m.startMinutes ?? null;

      const build = (allowShort: boolean) =>
        pool
          .filter((s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR)
          .filter((s) => canSuperviseClient(s, m.client, m.taskKind))
          .map((s) => {
            const floor = restFloorForUser(s.userId, dayEntry.dayOfWeek, lastShift);
            if (floor >= DAY_MINUTES) return null;
            const entrance =
              clock != null ? Math.max(clock, floor) : floor > 0 ? floor : null;
            const win = proposeWorkWindow(s, dayEntry.dayOfWeek, entrance ?? clock, {
              allowShort,
              notBeforeMinutes: floor > 0 ? floor : undefined,
            });
            if (!win) return null;
            const short = win.duration < MIN_SHIFT_MINUTES;
            if (!allowShort && short) return null;
            return { s, win, short };
          })
          .filter(Boolean) as Array<{
          s: ShiftPlanStaff;
          win: { startMinutes: number; endMinutes: number; duration: number };
          short: boolean;
        }>;

      const coverUntil = coverageNeededUntil(clock, m.endMinutes);

      let candidates = build(false);
      if (candidates.length === 0) candidates = build(true);
      rankCandidates(candidates, undefined, coverUntil);

      const pick = candidates[0];
      if (!pick) {
        const startLabel = m.startMinutes != null ? minutesToTime(m.startMinutes) : "?";
        unfilled.push({
          dayOfWeek: dayEntry.dayOfWeek,
          mapId: m.id,
          mapNumber: m.mapNumber,
          startLabel,
          reason: `Nobody available for ${m.client} at ${startLabel} (under ${MAX_MAPS_PER_SUPERVISOR}/person) — ask for help`,
        });
        continue;
      }

      const slots: MapSupervisorSlot[] = [
        {
          userId: pick.s.userId,
          startMinutes: pick.win.startMinutes,
          endMinutes: pick.win.endMinutes,
        },
      ];
      mapCounts.set(pick.s.userId, (mapCounts.get(pick.s.userId) ?? 0) + 1);
      onDayIds.add(pick.s.userId);
      recordShift(pick.s.userId, dayEntry.dayOfWeek, pick.win.endMinutes);

      if (needsHandoff(pick.win.endMinutes, clock, m.endMinutes, m.taskKind)) {
        const handoffAt = pick.win.endMinutes;
        const buildHandoff = (allowShort: boolean) =>
          pool
            .filter((s) => s.userId !== pick.s.userId)
            .filter((s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR)
            .filter((s) => canSuperviseClient(s, m.client, m.taskKind))
            .map((s) => {
              const floor = Math.max(
                handoffAt,
                restFloorForUser(s.userId, dayEntry.dayOfWeek, lastShift)
              );
              if (floor >= DAY_MINUTES) return null;
              const win = proposeWorkWindow(s, dayEntry.dayOfWeek, floor, {
                allowShort,
                notBeforeMinutes: floor,
              });
              return win
                ? { s, win, short: win.duration < MIN_SHIFT_MINUTES }
                : null;
            })
            .filter(Boolean) as Array<{
            s: ShiftPlanStaff;
            win: { startMinutes: number; endMinutes: number; duration: number };
            short: boolean;
          }>;

        let handoffCandidates = buildHandoff(false);
        if (handoffCandidates.length === 0) handoffCandidates = buildHandoff(true);
        rankCandidates(handoffCandidates, pick.win.startMinutes, coverUntil);
        const next = handoffCandidates[0];
        if (next) {
          slots.push({
            userId: next.s.userId,
            startMinutes: next.win.startMinutes,
            endMinutes: next.win.endMinutes,
            handoff: true,
          });
          mapCounts.set(next.s.userId, (mapCounts.get(next.s.userId) ?? 0) + 1);
          onDayIds.add(next.s.userId);
          recordShift(next.s.userId, dayEntry.dayOfWeek, next.win.endMinutes);
        }
      }

      assignees[m.id] = slots;
    }
  }

  return { assignees, unfilled };
}
