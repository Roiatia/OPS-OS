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
import { isRequiredMapTask } from "./staffingRatio";

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
  taskKind?: string,
  opts?: { relaxClient?: boolean }
): boolean {
  if (
    taskKind === "HAPPY_HOUR" ||
    taskKind === "COMPANY_MEETING" ||
    taskKind === "MAPPING_REFRESH"
  ) {
    return true;
  }
  // Local/demo maps and blank clients — don't block on CRM client lists
  if (opts?.relaxClient || !client || client === "—" || client === "Internal") {
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
 * When to auto-add a relief supervisor (handoff).
 * Maps often run ~12h+ — when the first person leaves, someone else must take the map.
 * Meetings / happy hour do not require relief.
 */
function needsHandoff(
  primaryEnd: number,
  taskStart: number | null,
  taskEnd: number | null | undefined,
  taskKind?: string,
  _primaryStart?: number
): boolean {
  if (taskKind === "COMPANY_MEETING" || taskKind === "HAPPY_HOUR") return false;

  // Explicit scheduled end — handoff if primary leaves before the task ends
  const needed = coverageNeededUntil(taskStart, taskEnd);
  if (needed != null) return primaryEnd < needed;

  // Open map / mapping refresh: always plan a relief supervisor so the map
  // is not left alone after the first person's window (often ~12h).
  return true;
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
 * Fill required maps using people who offered availability that day.
 * Prefer the lean day roster; if a map still can't be covered, use other
 * available supervisors (maps must get ≥1 person). Meetings stay empty.
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
    const allOffered = staff.filter((s) =>
      s.days.some((d) => d.dayOfWeek === dayEntry.dayOfWeek && d.canWork)
    );
    const rosterPool =
      onDayIds.size > 0 ? allOffered.filter((s) => onDayIds.has(s.userId)) : allOffered;

    if (allOffered.length === 0) {
      for (const m of dayEntry.maps) {
        if (!isRequiredMapTask(m.taskKind)) continue;
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

    const mapCounts = new Map<string, number>(allOffered.map((s) => [s.userId, 0]));
    const mapsOrdered = [...dayEntry.maps].sort(
      (a, b) =>
        (kindOrder[a.taskKind ?? "MAP"] ?? 99) - (kindOrder[b.taskKind ?? "MAP"] ?? 99) ||
        (a.startMinutes ?? 0) - (b.startMinutes ?? 0) ||
        a.mapNumber.localeCompare(b.mapNumber)
    );

    // Open / close SL: prefer one SL on early maps and one on late maps (~12h coverage)
    const requiredMaps = mapsOrdered.filter((m) => isRequiredMapTask(m.taskKind));
    const clocks = requiredMaps
      .map((m) => m.startMinutes)
      .filter((c): c is number => c != null);
    const earliestClock = clocks.length ? Math.min(...clocks) : null;
    const latestClock = clocks.length ? Math.max(...clocks) : null;
    const slCandidates = (rosterPool.length > 0 ? rosterPool : allOffered).filter(
      (s) => s.isShiftLeader
    );

    function slCovers(s: ShiftPlanStaff, clock: number | null): boolean {
      if (clock == null) return true;
      return coversMapHour(s, dayEntry.dayOfWeek, clock);
    }

    let openSlId: string | null = null;
    let closeSlId: string | null = null;
    if (slCandidates.length > 0) {
      const byOpen = [...slCandidates].sort((a, b) => {
        const aOk = earliestClock != null && slCovers(a, earliestClock) ? 0 : 1;
        const bOk = earliestClock != null && slCovers(b, earliestClock) ? 0 : 1;
        if (aOk !== bOk) return aOk - bOk;
        return a.name.localeCompare(b.name);
      });
      openSlId = byOpen[0]?.userId ?? null;

      const byClose = [...slCandidates]
        .filter((s) => s.userId !== openSlId || slCandidates.length === 1)
        .sort((a, b) => {
          const aOk = latestClock != null && slCovers(a, latestClock) ? 0 : 1;
          const bOk = latestClock != null && slCovers(b, latestClock) ? 0 : 1;
          if (aOk !== bOk) return aOk - bOk;
          // Prefer who stays later
          const aEnd = staffDayRanges(a, dayEntry.dayOfWeek).reduce(
            (m, r) => Math.max(m, r.endMinutes > r.startMinutes ? r.endMinutes : DAY_MINUTES),
            0
          );
          const bEnd = staffDayRanges(b, dayEntry.dayOfWeek).reduce(
            (m, r) => Math.max(m, r.endMinutes > r.startMinutes ? r.endMinutes : DAY_MINUTES),
            0
          );
          if (aEnd !== bEnd) return bEnd - aEnd;
          return a.name.localeCompare(b.name);
        });
      closeSlId = byClose[0]?.userId ?? openSlId;
      if (openSlId) onDayIds.add(openSlId);
      if (closeSlId) onDayIds.add(closeSlId);
    }

    function rankCandidates(
      list: Array<{
        s: ShiftPlanStaff;
        win: { startMinutes: number; endMinutes: number; duration: number };
        short: boolean;
      }>,
      mapClock: number | null,
      preferOppositeBandOf?: number,
      preferCoverUntil?: number | null
    ) {
      const earlyBand =
        earliestClock != null && mapClock != null && mapClock <= earliestClock + 2 * 60;
      const lateBand =
        latestClock != null && mapClock != null && mapClock >= latestClock - 2 * 60;

      list.sort((a, b) => {
        if (a.short !== b.short) return a.short ? 1 : -1;
        if (preferCoverUntil != null) {
          const aCovers = a.win.endMinutes >= preferCoverUntil ? 0 : 1;
          const bCovers = b.win.endMinutes >= preferCoverUntil ? 0 : 1;
          if (aCovers !== bCovers) return aCovers - bCovers;
        }
        // Spread maps evenly first — don't dump everything on SLs
        const ca = mapCounts.get(a.s.userId) ?? 0;
        const cb = mapCounts.get(b.s.userId) ?? 0;
        if (ca !== cb) return ca - cb;
        // Light preference: open SL on early maps, close SL on late (after balance)
        if (earlyBand && openSlId) {
          const aOpen = a.s.userId === openSlId ? 0 : 1;
          const bOpen = b.s.userId === openSlId ? 0 : 1;
          if (aOpen !== bOpen) return aOpen - bOpen;
        }
        if (lateBand && closeSlId) {
          const aClose = a.s.userId === closeSlId ? 0 : 1;
          const bClose = b.s.userId === closeSlId ? 0 : 1;
          if (aClose !== bClose) return aClose - bClose;
        }
        const onA = onDayIds.has(a.s.userId) ? 0 : 1;
        const onB = onDayIds.has(b.s.userId) ? 0 : 1;
        if (onA !== onB) return onA - onB;
        // Prefer supervisors over extra SL load for middle maps
        if (!earlyBand && !lateBand && a.s.isShiftLeader !== b.s.isShiftLeader) {
          return a.s.isShiftLeader ? 1 : -1;
        }
        if (preferOppositeBandOf != null) {
          const bandA =
            shiftBand(a.win.startMinutes) === shiftBand(preferOppositeBandOf) ? 1 : 0;
          const bandB =
            shiftBand(b.win.startMinutes) === shiftBand(preferOppositeBandOf) ? 1 : 0;
          if (bandA !== bandB) return bandA - bandB;
        }
        return a.s.name.localeCompare(b.s.name);
      });
    }

    function recordShift(userId: string, startDay: number, endAbs: number) {
      const prev = lastShift.get(userId);
      if (!prev || prev.day < startDay || (prev.day === startDay && endAbs > prev.endAbs)) {
        lastShift.set(userId, { day: startDay, endAbs });
      }
    }

    function buildWindows(
      source: ShiftPlanStaff[],
      m: (typeof mapsOrdered)[number],
      clock: number | null,
      allowShort: boolean,
      relaxClient: boolean
    ) {
      return source
        .filter((s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR)
        .filter((s) =>
          canSuperviseClient(s, m.client, m.taskKind, { relaxClient })
        )
        .map((s) => {
          const floor = restFloorForUser(s.userId, dayEntry.dayOfWeek, lastShift);
          if (floor >= DAY_MINUTES) return null;

          // Must be available at map start — never assign someone who begins later
          // (e.g. map 08:00 must not get a supervisor who only starts at 10:00)
          if (clock != null && floor > clock) return null;

          const entrance = clock != null ? clock : floor > 0 ? floor : null;
          const win = proposeWorkWindow(s, dayEntry.dayOfWeek, entrance, {
            allowShort,
            notBeforeMinutes: floor > 0 ? floor : undefined,
          });
          if (!win) return null;
          // Entrance must not be after the map start
          if (clock != null && win.startMinutes > clock) return null;
          // Must actually cover the map clock when known
          if (clock != null && !coversMapHour(s, dayEntry.dayOfWeek, clock)) return null;

          const short = win.duration < MIN_SHIFT_MINUTES;
          if (!allowShort && short) return null;
          return { s, win, short };
        })
        .filter(Boolean) as Array<{
        s: ShiftPlanStaff;
        win: { startMinutes: number; endMinutes: number; duration: number };
        short: boolean;
      }>;
    }

    for (const m of mapsOrdered) {
      if (!isRequiredMapTask(m.taskKind)) continue;

      const clock = m.startMinutes ?? null;
      const relaxClient = m.id.startsWith("local-") || !m.client || m.client === "—";
      const coverUntil = coverageNeededUntil(clock, m.endMinutes);

      const primaryPool = rosterPool.length > 0 ? rosterPool : allOffered;
      let candidates = buildWindows(primaryPool, m, clock, false, relaxClient);
      if (candidates.length === 0) {
        candidates = buildWindows(primaryPool, m, clock, true, relaxClient);
      }
      // Map must be filled — use other people who offered this day
      if (candidates.length === 0 && primaryPool !== allOffered) {
        candidates = buildWindows(allOffered, m, clock, false, relaxClient);
      }
      if (candidates.length === 0 && primaryPool !== allOffered) {
        candidates = buildWindows(allOffered, m, clock, true, relaxClient);
      }
      // Demo / unknown clients: last pass ignores client lists entirely
      if (candidates.length === 0) {
        candidates = buildWindows(allOffered, m, clock, true, true);
      }
      rankCandidates(candidates, clock, undefined, coverUntil);

      const pick = candidates[0];
      if (!pick) {
        const startLabel = m.startMinutes != null ? minutesToTime(m.startMinutes) : "?";
        unfilled.push({
          dayOfWeek: dayEntry.dayOfWeek,
          mapId: m.id,
          mapNumber: m.mapNumber,
          startLabel,
          reason: `No available supervisor covers this map at ${startLabel}`,
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

      const wantHandoff = needsHandoff(
        pick.win.endMinutes,
        clock,
        m.endMinutes,
        m.taskKind,
        pick.win.startMinutes
      );
      if (wantHandoff) {
        const handoffAt = pick.win.endMinutes;
        // Prefer anyone who can start when the first person leaves
        let handoffCandidates = buildWindows(allOffered, m, handoffAt, false, relaxClient).filter(
          (c) => c.s.userId !== pick.s.userId
        );
        if (handoffCandidates.length === 0) {
          handoffCandidates = buildWindows(allOffered, m, handoffAt, true, true).filter(
            (c) => c.s.userId !== pick.s.userId
          );
        }
        // Handoff may start after midnight (endAbs > 1440) — try next-day morning window
        if (handoffCandidates.length === 0 && handoffAt >= DAY_MINUTES) {
          const nextDayStart = handoffAt - DAY_MINUTES;
          handoffCandidates = allOffered
            .filter((s) => s.userId !== pick.s.userId)
            .filter((s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR)
            .map((s) => {
              const win = proposeWorkWindow(s, dayEntry.dayOfWeek, Math.min(nextDayStart, DAY_MINUTES - 1), {
                allowShort: true,
              });
              // Prefer people available from early morning continuing the overnight map
              if (!win) {
                const morning = proposeWorkWindow(s, dayEntry.dayOfWeek, 0, { allowShort: true });
                if (!morning) return null;
                return { s, win: morning, short: morning.duration < MIN_SHIFT_MINUTES };
              }
              return { s, win, short: win.duration < MIN_SHIFT_MINUTES };
            })
            .filter(Boolean) as Array<{
            s: ShiftPlanStaff;
            win: { startMinutes: number; endMinutes: number; duration: number };
            short: boolean;
          }>;
        }
        rankCandidates(handoffCandidates, clock, pick.win.startMinutes, coverUntil);
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
        } else {
          // Map would be left alone after primary leaves — surface to OPS
          unfilled.push({
            dayOfWeek: dayEntry.dayOfWeek,
            mapId: m.id,
            mapNumber: m.mapNumber,
            startLabel:
              pick.win.endMinutes >= DAY_MINUTES
                ? formatSlotEnd(pick.win.endMinutes)
                : minutesToTime(pick.win.endMinutes),
            reason: `Needs relief after ${
              pick.win.endMinutes >= DAY_MINUTES
                ? formatSlotEnd(pick.win.endMinutes)
                : minutesToTime(pick.win.endMinutes)
            } — no supervisor available to take over`,
          });
        }
      }

      assignees[m.id] = slots;
    }
  }

  return { assignees, unfilled };
}
