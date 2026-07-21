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
};

export type UnfilledMapAlert = {
  dayOfWeek: number;
  mapId: string;
  mapNumber: string;
  startLabel: string;
  reason: string;
};

const DAY_MINUTES = 24 * 60;
/** Prefer 2 supervisors per map when the day has enough people. */
const TARGET_SUPS_PER_MAP = 2;

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
  const ranges = dayHourRanges({
    dayOfWeek,
    canWork: true,
    allDay: false,
    startMinutes: day.startMinutes,
    endMinutes: day.endMinutes,
    startMinutes2: day.startMinutes2,
    endMinutes2: day.endMinutes2,
  });
  // canWork with hours TBD — treat as full day so auto-plan can assign maps
  if (ranges.length === 0) return [{ startMinutes: 0, endMinutes: DAY_MINUTES }];
  return ranges;
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

function restFloorForUser(
  userId: string,
  dayOfWeek: number,
  lastShift: Map<string, { day: number; endAbs: number }>
): number {
  const prev = lastShift.get(userId);
  if (!prev) return 0;
  if (prev.day === dayOfWeek) return 0;
  if (prev.day === dayOfWeek - 1) {
    const floor = earliestEntranceAfterRest(dayOfWeek, prev.day, prev.endAbs);
    return floor >= DAY_MINUTES ? DAY_MINUTES : floor;
  }
  return 0;
}

type Cand = {
  s: ShiftPlanStaff;
  win: { startMinutes: number; endMinutes: number; duration: number };
  short: boolean;
};

/**
 * Fill required maps using people who offered that day.
 * Every required map gets ≥1 supervisor; when the day has enough people, prefer 2.
 * Meetings / happy hour stay empty. No "handoff" concept — just multiple supervisors.
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
    /** Days this person is on the week plan — prefer giving maps to people with fewer days. */
    const daysOnPlan = new Map<string, number>();
    for (const a of dayAssignments) {
      daysOnPlan.set(a.userId, (daysOnPlan.get(a.userId) ?? 0) + 1);
    }
    /** Last map-start this person took as primary — keep consecutive maps on the same person. */
    const lastPrimaryMapStart = new Map<string, number>();
    /** Latest end of any window they hold today — prefer if still covering this map clock. */
    const coverUntilByUser = new Map<string, number>();
    const CONTINUITY_GAP_MINUTES = 2 * 60; // cluster maps within ~2h on the same supervisor

    // Dedupe by id — duplicates blow the 9-map cap and leave later maps empty
    const seenMapIds = new Set<string>();
    const mapsOrdered = [...dayEntry.maps]
      .filter((m) => {
        if (seenMapIds.has(m.id)) return false;
        seenMapIds.add(m.id);
        return true;
      })
      .sort(
        (a, b) =>
          (kindOrder[a.taskKind ?? "MAP"] ?? 99) - (kindOrder[b.taskKind ?? "MAP"] ?? 99) ||
          (a.startMinutes ?? 0) - (b.startMinutes ?? 0) ||
          a.mapNumber.localeCompare(b.mapNumber)
      );

    const requiredMaps = mapsOrdered.filter((m) => isRequiredMapTask(m.taskKind));
    const clocks = requiredMaps
      .map((m) => m.startMinutes)
      .filter((c): c is number => c != null);
    const earliestClock = clocks.length ? Math.min(...clocks) : null;
    const latestClock = clocks.length ? Math.max(...clocks) : null;

    const slCandidates = (rosterPool.length > 0 ? rosterPool : allOffered).filter(
      (s) => s.isShiftLeader
    );

    let openSlId: string | null = null;
    let closeSlId: string | null = null;
    if (slCandidates.length > 0) {
      const byOpen = [...slCandidates].sort((a, b) => {
        const aOk = earliestClock != null && coversMapHour(a, dayEntry.dayOfWeek, earliestClock) ? 0 : 1;
        const bOk = earliestClock != null && coversMapHour(b, dayEntry.dayOfWeek, earliestClock) ? 0 : 1;
        if (aOk !== bOk) return aOk - bOk;
        return a.name.localeCompare(b.name);
      });
      openSlId = byOpen[0]?.userId ?? null;

      const byClose = [...slCandidates]
        .filter((s) => s.userId !== openSlId || slCandidates.length === 1)
        .sort((a, b) => {
          const aOk = latestClock != null && coversMapHour(a, dayEntry.dayOfWeek, latestClock) ? 0 : 1;
          const bOk = latestClock != null && coversMapHour(b, dayEntry.dayOfWeek, latestClock) ? 0 : 1;
          if (aOk !== bOk) return aOk - bOk;
          return a.name.localeCompare(b.name);
        });
      closeSlId = byClose[0]?.userId ?? openSlId;
      if (openSlId) onDayIds.add(openSlId);
      if (closeSlId) onDayIds.add(closeSlId);
    }

    function availStart(s: ShiftPlanStaff): number {
      const ranges = staffDayRanges(s, dayEntry.dayOfWeek);
      if (ranges.length === 0) return 0;
      return Math.min(...ranges.map((r) => r.startMinutes));
    }

    /**
     * Lower = better. Prefer people who just took a nearby earlier map
     * (Dana 08:00 → Dana 09:00) instead of ping-pong (Dana → Alex → Dana).
     */
    function continuityRank(userId: string, mapClock: number | null): number {
      if (mapClock == null) return 1;
      const until = coverUntilByUser.get(userId);
      if (until != null && mapClock < until) return 0; // still on shift covering this start
      const lastStart = lastPrimaryMapStart.get(userId);
      if (lastStart == null) return 2; // not yet used as primary today
      const gap = mapClock - lastStart;
      if (gap >= 0 && gap <= CONTINUITY_GAP_MINUTES) return 0; // consecutive / nearby
      if (gap > CONTINUITY_GAP_MINUTES && gap <= 4 * 60) return 1; // same morning/afternoon band
      return 2;
    }

    function rankForMap(
      list: Cand[],
      mapClock: number | null,
      preferLater = false,
      preferContinuity = false
    ) {
      const earlyBand =
        earliestClock != null && mapClock != null && mapClock <= earliestClock + 2 * 60;
      const lateBand =
        latestClock != null && mapClock != null && mapClock >= latestClock - 2 * 60;

      list.sort((a, b) => {
        if (a.short !== b.short) return a.short ? 1 : -1;

        const ca = mapCounts.get(a.s.userId) ?? 0;
        const cb = mapCounts.get(b.s.userId) ?? 0;

        // Keep consecutive maps on the same person (08→09→Dana), but don't pile on
        // if they're already ~2 maps ahead of someone else (then hand the next to Alex).
        if (preferContinuity) {
          const aCont = continuityRank(a.s.userId, mapClock);
          const bCont = continuityRank(b.s.userId, mapClock);
          if (aCont !== bCont) {
            const aOverloaded = ca >= cb + 2;
            const bOverloaded = cb >= ca + 2;
            if (aCont < bCont && !aOverloaded) return -1;
            if (bCont < aCont && !bOverloaded) return 1;
          }
        }

        if (ca !== cb) return ca - cb;

        // Among equal map load today: prefer people with fewer days on the week plan
        const da = daysOnPlan.get(a.s.userId) ?? 0;
        const db = daysOnPlan.get(b.s.userId) ?? 0;
        if (da !== db) return da - db;

        if (preferLater) {
          const aL = availStart(a.s);
          const bL = availStart(b.s);
          if (aL !== bL) return bL - aL;
        }
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
        if (!earlyBand && !lateBand && a.s.isShiftLeader !== b.s.isShiftLeader) {
          return a.s.isShiftLeader ? 1 : -1;
        }
        return a.s.name.localeCompare(b.s.name);
      });
    }

    function recordShift(userId: string, startDay: number, endAbs: number) {
      const prev = lastShift.get(userId);
      if (!prev || prev.day < startDay || (prev.day === startDay && endAbs > prev.endAbs)) {
        lastShift.set(userId, { day: startDay, endAbs });
      }
      const prevUntil = coverUntilByUser.get(userId) ?? 0;
      if (endAbs > prevUntil) coverUntilByUser.set(userId, endAbs);
    }

    function notePrimary(userId: string, mapClock: number | null) {
      if (mapClock != null) lastPrimaryMapStart.set(userId, mapClock);
    }

    /** First seat: must cover map start. */
    function buildAtMapStart(
      source: ShiftPlanStaff[],
      m: (typeof mapsOrdered)[number],
      clock: number | null,
      exclude: Set<string>,
      allowShort: boolean,
      relaxClient: boolean
    ): Cand[] {
      return source
        .filter((s) => !exclude.has(s.userId))
        .filter((s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR)
        .filter((s) => canSuperviseClient(s, m.client, m.taskKind, { relaxClient }))
        .map((s) => {
          const floor = restFloorForUser(s.userId, dayEntry.dayOfWeek, lastShift);
          if (floor >= DAY_MINUTES) return null;
          if (clock != null && floor > clock) return null;

          const entrance = clock != null ? clock : floor > 0 ? floor : null;
          const win = proposeWorkWindow(s, dayEntry.dayOfWeek, entrance, {
            allowShort,
            notBeforeMinutes: floor > 0 ? floor : undefined,
          });
          if (!win) return null;
          if (clock != null && win.startMinutes > clock) return null;
          if (clock != null && !coversMapHour(s, dayEntry.dayOfWeek, clock)) return null;

          const short = win.duration < MIN_SHIFT_MINUTES;
          if (!allowShort && short) return null;
          return { s, win, short };
        })
        .filter(Boolean) as Cand[];
    }

    /**
     * Extra seats: may start later than map start (same day).
     * Prefer people already on the day roster.
     */
    function buildExtraSeat(
      source: ShiftPlanStaff[],
      m: (typeof mapsOrdered)[number],
      mapClock: number | null,
      exclude: Set<string>,
      allowShort: boolean,
      relaxClient: boolean
    ): Cand[] {
      const floorMap = mapClock ?? 0;
      return source
        .filter((s) => !exclude.has(s.userId))
        .filter((s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR)
        .filter((s) => canSuperviseClient(s, m.client, m.taskKind, { relaxClient }))
        .map((s) => {
          const floor = Math.max(
            floorMap,
            restFloorForUser(s.userId, dayEntry.dayOfWeek, lastShift)
          );
          if (floor >= DAY_MINUTES) return null;

          const ranges = staffDayRanges(s, dayEntry.dayOfWeek);
          if (ranges.length === 0) return null;

          // Try map start if they cover it; else their first available time that day (≥ map start)
          const entrances: number[] = [];
          if (mapClock != null && coversMapHour(s, dayEntry.dayOfWeek, mapClock) && mapClock >= floor) {
            entrances.push(mapClock);
          }
          for (const r of ranges) {
            const start = Math.max(r.startMinutes, floor);
            if (r.endMinutes > r.startMinutes && start < r.endMinutes) entrances.push(start);
            else if (r.endMinutes <= r.startMinutes && start < DAY_MINUTES) entrances.push(start);
          }
          const unique = [...new Set(entrances)].sort((a, b) => a - b);

          for (const entrance of unique) {
            const win = proposeWorkWindow(s, dayEntry.dayOfWeek, entrance, {
              allowShort,
              notBeforeMinutes: floor,
            });
            if (!win) continue;
            if (win.startMinutes < floorMap && mapClock != null) continue;
            const short = win.duration < MIN_SHIFT_MINUTES;
            if (!allowShort && short) continue;
            return { s, win, short };
          }
          return null;
        })
        .filter(Boolean) as Cand[];
    }

    function pickFirst(
      pools: ShiftPlanStaff[][],
      m: (typeof mapsOrdered)[number],
      clock: number | null,
      exclude: Set<string>,
      relaxClient: boolean,
      preferLater: boolean,
      preferContinuity = false
    ): Cand | null {
      for (const pool of pools) {
        for (const allowShort of [false, true]) {
          const list = preferLater
            ? buildExtraSeat(pool, m, clock, exclude, allowShort, relaxClient)
            : buildAtMapStart(pool, m, clock, exclude, allowShort, relaxClient);
          if (list.length === 0) continue;
          rankForMap(list, clock, preferLater, preferContinuity);
          return list[0] ?? null;
        }
      }
      return null;
    }

    for (const m of mapsOrdered) {
      if (!isRequiredMapTask(m.taskKind)) continue;

      const clock = m.startMinutes ?? null;
      const relaxClient = m.id.startsWith("local-") || !m.client || m.client === "—";
      const onMap = new Set<string>();
      const slots: MapSupervisorSlot[] = [];

      const poolsUnique =
        rosterPool.length > 0 && rosterPool !== allOffered
          ? [rosterPool, allOffered]
          : [allOffered];

      const primary = pickFirst(poolsUnique, m, clock, onMap, relaxClient, false, true);
      if (primary) {
        slots.push({
          userId: primary.s.userId,
          startMinutes: primary.win.startMinutes,
          endMinutes: primary.win.endMinutes,
        });
        onMap.add(primary.s.userId);
        mapCounts.set(primary.s.userId, (mapCounts.get(primary.s.userId) ?? 0) + 1);
        onDayIds.add(primary.s.userId);
        recordShift(primary.s.userId, dayEntry.dayOfWeek, primary.win.endMinutes);
        notePrimary(primary.s.userId, clock);
      }

      if (slots.length === 0) {
        const startLabel = m.startMinutes != null ? minutesToTime(m.startMinutes) : "?";
        unfilled.push({
          dayOfWeek: dayEntry.dayOfWeek,
          mapId: m.id,
          mapNumber: m.mapNumber,
          startLabel,
          reason: `No supervisor available for this map at ${startLabel}`,
        });
      } else {
        assignees[m.id] = slots;
      }
    }

    // Pass 2: second supervisor only if they extend coverage past the first.
    // If Erez already stays until 00:00 (+1), don't add Alex who leaves earlier — useless.
    for (const m of mapsOrdered) {
      if (!isRequiredMapTask(m.taskKind)) continue;
      const existing = assignees[m.id] ?? [];
      if (existing.length === 0 || existing.length >= TARGET_SUPS_PER_MAP) continue;
      if (rosterPool.length < 2 && allOffered.length < 2) continue;

      const primarySlot = existing[0]!;
      const primaryEnd = primarySlot.endMinutes;
      const clock = m.startMinutes ?? null;

      // First person already covers a full long window (to midnight or ~12h) — no second needed
      const coversLongEnough =
        primaryEnd >= DAY_MINUTES ||
        (clock != null && primaryEnd >= clock + MAX_SHIFT_MINUTES - 30) ||
        (clock != null && primaryEnd - clock >= 10 * 60);
      if (coversLongEnough) continue;

      const onMap = new Set(existing.map((s) => s.userId));
      const poolsUnique =
        rosterPool.length > 0 && rosterPool !== allOffered
          ? [rosterPool, allOffered]
          : [allOffered];

      // Prefer someone who stays later than the primary (real coverage gain)
      let best: Cand | null = null;
      for (const pool of poolsUnique) {
        for (const allowShort of [false, true]) {
          const list = buildExtraSeat(pool, m, clock, onMap, allowShort, true).filter(
            (c) => c.win.endMinutes > primaryEnd + 60 // at least +1h past primary
          );
          if (list.length === 0) continue;
          list.sort((a, b) => {
            if (b.win.endMinutes !== a.win.endMinutes) return b.win.endMinutes - a.win.endMinutes;
            return (mapCounts.get(a.s.userId) ?? 0) - (mapCounts.get(b.s.userId) ?? 0);
          });
          best = list[0] ?? null;
          break;
        }
        if (best) break;
      }
      if (!best) continue;

      existing.push({
        userId: best.s.userId,
        startMinutes: best.win.startMinutes,
        endMinutes: best.win.endMinutes,
      });
      mapCounts.set(best.s.userId, (mapCounts.get(best.s.userId) ?? 0) + 1);
      onDayIds.add(best.s.userId);
      recordShift(best.s.userId, dayEntry.dayOfWeek, best.win.endMinutes);
      assignees[m.id] = existing;
    }
  }

  return { assignees, unfilled };
}
