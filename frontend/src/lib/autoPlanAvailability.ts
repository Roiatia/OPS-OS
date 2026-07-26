import type {
  ShiftPlanAssignment,
  ShiftPlanDay,
  ShiftPlanMap,
  ShiftPlanStaff,
  ShiftPlanView,
} from "../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  NIGHT_START_MINUTES,
  availabilityUtilization,
} from "./availabilityRules";
import {
  countRequiredMaps,
  isNightMapStart,
  isRequiredMapTask,
  staffingForMaps,
  staffingRatioHint,
} from "./staffingRatio";
import { coversMapHour, hasNextMorningFromMidnight } from "./mapSupervisorSlots";

function dayLabel(dayOfWeek: number): string {
  const idx = AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number]);
  return DAY_LABELS[idx >= 0 ? idx : 0];
}

function canWorkDay(s: ShiftPlanStaff, dayOfWeek: number): boolean {
  return s.days.some((d) => d.dayOfWeek === dayOfWeek && d.canWork);
}

/** Days they can actually be given, so fairness compares against real capacity. */
function offeredDays(s: ShiftPlanStaff): number {
  const offered = s.daysOffered ?? s.days.filter((d) => d.canWork).length;
  const max = s.maxShiftsPerWeek;
  return max != null && max >= 0 ? Math.min(offered, max) : offered;
}

/** Contract cap (e.g. Millie ≤ 3 days) — never exceeded, even to fill a short day. */
function atWeeklyShiftCap(s: ShiftPlanStaff, assignedDays: number): boolean {
  const max = s.maxShiftsPerWeek;
  return max != null && max >= 0 && assignedDays >= max;
}

/**
 * Auto-plan rules (frontend):
 * - Plan scarcest days first (fewest people offered), then richer days
 * - Never assign more days than someone offered (hard cap)
 * - Fair by util (assigned/offered), then rating; keep loads almost even
 * - ~2 maps/person; ≥1 SL per map day
 * - Night maps need next-morning relief from the next day's roster
 */
export function autoPlanAvailability(input: {
  staff: ShiftPlanStaff[];
  mapsPerDay: ShiftPlanView["mapsPerDay"];
  lockedAssignments?: ShiftPlanAssignment[];
  avoidUserIds?: string[];
  dayOfWeek?: number;
  variant?: number;
}): {
  assignments: ShiftPlanAssignment[];
  dayPlans: ShiftPlanDay[];
  warnings: string[];
  missingSlDays: number[];
} {
  const avoid = new Set(input.avoidUserIds ?? []);
  const locked = input.lockedAssignments ?? [];
  const lockedDays = new Set(locked.map((a) => a.dayOfWeek));
  const assignedCount = new Map<string, number>();
  for (const a of locked) {
    assignedCount.set(a.userId, (assignedCount.get(a.userId) ?? 0) + 1);
  }

  const variant = input.variant ?? 0;
  const warnings: string[] = [];
  const missingSlDays: number[] = [];
  const dayPlans: ShiftPlanDay[] = [];
  const newAssignments: ShiftPlanAssignment[] = [...locked];

  const daysToPlan =
    input.dayOfWeek != null
      ? [input.dayOfWeek]
      : AVAILABILITY_DAYS.filter((d) => !lockedDays.has(d));

  /** How many people offered each day — scarce days get planned first. */
  const offeredCountByDay = new Map<number, number>();
  for (const d of AVAILABILITY_DAYS) {
    offeredCountByDay.set(
      d,
      input.staff.filter((s) => canWorkDay(s, d)).length
    );
  }

  const planOrder = [...daysToPlan].sort(
    (a, b) =>
      (offeredCountByDay.get(a) ?? 0) - (offeredCountByDay.get(b) ?? 0) || a - b
  );

  /**
   * How valuable this person is for *remaining* scarce days (not yet planned).
   * Higher → save them for those days instead of burning them on abundant ones.
   */
  function futureScarceValue(s: ShiftPlanStaff, remainingDays: number[]): number {
    let v = 0;
    for (const d of remainingDays) {
      if (!canWorkDay(s, d)) continue;
      const n = offeredCountByDay.get(d) ?? 1;
      if (n <= 0) continue;
      if (n <= 3) v += 1 / n;
      else if (n <= 5) v += 0.15 / n;
    }
    return v;
  }

  // Locked / skipped days first (calendar notes), then plan scarcest → richest
  for (const dayOfWeek of AVAILABILITY_DAYS) {
    if (daysToPlan.includes(dayOfWeek)) continue;
    const mapsEntry = input.mapsPerDay.find((m) => m.dayOfWeek === dayOfWeek);
    const maps: ShiftPlanMap[] = mapsEntry?.maps ?? [];
    const mapsCount = countRequiredMaps(maps);
    const taskCount = maps.length;
    const dayLocked = locked.filter((a) => a.dayOfWeek === dayOfWeek);
    const hasSl = dayLocked.some((a) => a.isShiftLeader);
    const issues: string[] = [];
    if (mapsCount > 0 && !hasSl) {
      issues.push("No shift leader on this day.");
      missingSlDays.push(dayOfWeek);
    }
    const staffing = staffingForMaps(mapsCount, dayLocked.length || mapsCount);
    dayPlans.push({
      dayOfWeek,
      label: dayLabel(dayOfWeek),
      mapsCount: taskCount,
      staffNeeded: staffing.target,
      assignments: dayLocked,
      ok: issues.length === 0,
      issues,
      logicNotes: mapsCount
        ? [
            `Locked · ${mapsCount} map(s) · ${staffingRatioHint(mapsCount)} · ~${staffing.target}`,
          ]
        : undefined,
    });
  }

  for (let planIdx = 0; planIdx < planOrder.length; planIdx++) {
    const dayOfWeek = planOrder[planIdx]!;
    const remainingDays = planOrder.slice(planIdx + 1);
    const mapsEntry = input.mapsPerDay.find((m) => m.dayOfWeek === dayOfWeek);
    const maps: ShiftPlanMap[] = mapsEntry?.maps ?? [];
    const mapsCount = countRequiredMaps(maps);
    const taskCount = maps.length;

    if (mapsCount === 0) {
      dayPlans.push({
        dayOfWeek,
        label: dayLabel(dayOfWeek),
        mapsCount: taskCount,
        staffNeeded: 0,
        assignments: [],
        ok: true,
        issues: [],
        logicNotes:
          taskCount > 0
            ? [`${taskCount} meeting/event(s) only — no map roster`]
            : undefined,
      });
      continue;
    }

    const offeredToday = input.staff.filter((s) => canWorkDay(s, dayOfWeek));
    const eligible = offeredToday.filter(
      (s) => !atWeeklyShiftCap(s, assignedCount.get(s.userId) ?? 0)
    );
    const cappedOut = offeredToday.filter((s) => !eligible.includes(s));
    const staffing = staffingForMaps(mapsCount, eligible.length);
    const todayOffered = eligible.length;
    const todayAbundant = todayOffered >= 5;
    const todayScarce = todayOffered > 0 && todayOffered <= 3;
    const issues: string[] = [];
    const logicNotes: string[] = [
      `${mapsCount} map(s) · ${staffingRatioHint(mapsCount)} · target ${staffing.target} · ${todayOffered} offered today${
        todayScarce ? " · scarce day (planned early)" : todayAbundant ? " · abundant day" : ""
      }`,
    ];
    if (cappedOut.length > 0) {
      logicNotes.push(
        `At weekly limit: ${cappedOut
          .map((s) => `${s.name} (${s.maxShiftsPerWeek}/week)`)
          .join(", ")}`
      );
    }

    const score = (s: ShiftPlanStaff) => {
      const assigned = assignedCount.get(s.userId) ?? 0;
      const offered = Math.max(1, offeredDays(s));
      const util = availabilityUtilization(assigned, offered);
      const atCap = assigned >= offered;
      const avoidPenalty = avoid.has(s.userId) ? 1000 : 0;
      const salt = (s.userId.charCodeAt(0) + variant * 17 + dayOfWeek * 3) % 7;
      const futureScarce = futureScarceValue(s, remainingDays);
      const rating = s.isShiftLeader
        ? 9
        : Math.min(9, Math.max(1, Math.round(s.supervisorRating ?? 5)));
      return { util, assigned, offered, atCap, avoidPenalty, salt, futureScarce, rating };
    };

    const underCap = (s: ShiftPlanStaff) => !score(s).atCap;

    const minUtilEligible = () => {
      const pool = eligible.filter(underCap);
      if (pool.length === 0) return 0;
      return Math.min(...pool.map((e) => score(e).util));
    };

    const rankEven = (a: ShiftPlanStaff, b: ShiftPlanStaff) => {
      const sa = score(a);
      const sb = score(b);
      if (sa.avoidPenalty !== sb.avoidPenalty) return sa.avoidPenalty - sb.avoidPenalty;
      if (sa.atCap !== sb.atCap) return sa.atCap ? 1 : -1;
      if (Math.abs(sa.util - sb.util) > 0.02) return sa.util - sb.util;
      if (sa.assigned !== sb.assigned) return sa.assigned - sb.assigned;
      return 0;
    };

    const rankFair = (a: ShiftPlanStaff, b: ShiftPlanStaff) => {
      const even = rankEven(a, b);
      if (even !== 0) return even;
      const sa = score(a);
      const sb = score(b);
      if (sa.rating !== sb.rating) return sb.rating - sa.rating;
      if (sa.offered !== sb.offered) return sb.offered - sa.offered;
      if (sa.salt !== sb.salt) return sa.salt - sb.salt;
      return a.name.localeCompare(b.name);
    };

    const rankForDay = (a: ShiftPlanStaff, b: ShiftPlanStaff) => {
      const even = rankEven(a, b);
      if (even !== 0) return even;
      const sa = score(a);
      const sb = score(b);
      if (todayAbundant && Math.abs(sa.util - sb.util) <= 0.02) {
        if (Math.abs(sa.futureScarce - sb.futureScarce) > 0.05) {
          return sa.futureScarce - sb.futureScarce;
        }
      }
      return rankFair(a, b);
    };

    const picked: ShiftPlanStaff[] = [];
    const pickedIds = new Set<string>();

    const mapClocks = maps
      .filter((m) => isRequiredMapTask(m.taskKind))
      .map((m) => m.startMinutes)
      .filter((c): c is number => c != null);
    const earliest = mapClocks.length ? Math.min(...mapClocks) : null;
    const nightClocks = mapClocks.filter((c) => c >= NIGHT_START_MINUTES);
    const hasNightMaps = nightClocks.length > 0;
    const prevMaps =
      input.mapsPerDay.find((m) => m.dayOfWeek === dayOfWeek - 1)?.maps ?? [];
    const prevHadNightMaps = prevMaps.some(
      (m) => isRequiredMapTask(m.taskKind) && isNightMapStart(m.startMinutes)
    );

    const slPool = eligible.filter((s) => s.isShiftLeader);

    const coversClock = (s: ShiftPlanStaff, clock: number | null) =>
      clock == null || coversMapHour(s, dayOfWeek, clock);

    const rankForBand = (
      a: ShiftPlanStaff,
      b: ShiftPlanStaff,
      preferClock: number | null
    ) => {
      const dayRank = rankForDay(a, b);
      const sa = score(a);
      const sb = score(b);
      const utilClose = Math.abs(sa.util - sb.util) < 0.15 && !sa.atCap && !sb.atCap;
      if (preferClock != null && utilClose) {
        const aOk = coversClock(a, preferClock) ? 0 : 1;
        const bOk = coversClock(b, preferClock) ? 0 : 1;
        if (aOk !== bOk) return aOk - bOk;
      }
      return dayRank;
    };

    const tooFarAhead = (s: ShiftPlanStaff, remaining: ShiftPlanStaff[]) => {
      if (score(s).atCap) {
        return remaining.some((o) => underCap(o));
      }
      const floorUtil = minUtilEligible();
      const u = score(s).util;
      if (u <= floorUtil + 0.35) return false;
      return remaining.some((o) => underCap(o) && score(o).util <= floorUtil + 0.15);
    };

    const openSl =
      [...slPool].filter(underCap).sort((a, b) => rankForBand(a, b, earliest))[0] ?? null;

    if (openSl) {
      picked.push(openSl);
      pickedIds.add(openSl.userId);
      logicNotes.push(
        `Open SL: ${openSl.name} (${score(openSl).assigned}/${score(openSl).offered})`
      );
    } else {
      issues.push("No shift leader available — OPS must cover or ask an SL.");
      missingSlDays.push(dayOfWeek);
      warnings.push(
        `${dayLabel(dayOfWeek)}: no shift leader available for ${mapsCount} map(s).`
      );
    }

    const fillPool = eligible.filter((s) => !pickedIds.has(s.userId));
    const sortedFill = [...fillPool].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa.assigned === sb.assigned && a.isShiftLeader !== b.isShiftLeader) {
        return a.isShiftLeader ? 1 : -1;
      }
      if (prevHadNightMaps && Math.abs(sa.util - sb.util) <= 0.02) {
        const aEarly = coversClock(a, 0) ? 0 : 1;
        const bEarly = coversClock(b, 0) ? 0 : 1;
        if (aEarly !== bEarly) return aEarly - bEarly;
      }
      if (hasNightMaps) {
        const nightClock = Math.min(...nightClocks);
        // Prefer people who can continue past midnight into next morning
        if (coversClock(a, nightClock) || coversClock(b, nightClock)) {
          const aNext =
            coversClock(a, nightClock) && hasNextMorningFromMidnight(a, dayOfWeek) ? 0 : 1;
          const bNext =
            coversClock(b, nightClock) && hasNextMorningFromMidnight(b, dayOfWeek) ? 0 : 1;
          if (aNext !== bNext) return aNext - bNext;
        }
        return rankForBand(a, b, nightClock);
      }
      return rankForDay(a, b);
    });

    for (const person of sortedFill) {
      if (picked.length >= staffing.target) break;
      if (!underCap(person) && sortedFill.some((s) => !pickedIds.has(s.userId) && underCap(s))) {
        continue;
      }
      if (tooFarAhead(person, sortedFill.filter((s) => !pickedIds.has(s.userId)))) continue;
      picked.push(person);
      pickedIds.add(person.userId);
    }

    if (hasNightMaps) {
      const nightClock = Math.min(...nightClocks);
      const rosterCoversNight = picked.some((p) => coversClock(p, nightClock));
      if (!rosterCoversNight) {
        // Prefer someone who also offered next morning from 00:00 (real overnight).
        const nightPerson =
          eligible
            .filter((s) => !pickedIds.has(s.userId) && coversClock(s, nightClock) && underCap(s))
            .sort((a, b) => {
              const aNext = hasNextMorningFromMidnight(a, dayOfWeek) ? 0 : 1;
              const bNext = hasNextMorningFromMidnight(b, dayOfWeek) ? 0 : 1;
              if (aNext !== bNext) return aNext - bNext;
              return rankForDay(a, b);
            })[0] ?? null;
        if (nightPerson) {
          picked.push(nightPerson);
          pickedIds.add(nightPerson.userId);
          const overnight = hasNextMorningFromMidnight(nightPerson, dayOfWeek);
          logicNotes.push(
            overnight
              ? `Night cover: ${nightPerson.name} (overnight into next morning)`
              : `Night cover: ${nightPerson.name} (until midnight — morning relief from next day's roster)`
          );
        } else {
          warnings.push(
            `${dayLabel(dayOfWeek)}: night map(s) at ${Math.floor(nightClock / 60)}:00 — nobody under day-cap offered that hour.`
          );
        }
      }
    }

    if (prevHadNightMaps) {
      const rosterCoversMorning = picked.some((p) => coversClock(p, 0));
      if (!rosterCoversMorning) {
        const morningPerson =
          eligible
            .filter((s) => !pickedIds.has(s.userId) && coversClock(s, 0) && underCap(s))
            .sort(rankForDay)[0] ?? null;
        if (morningPerson) {
          picked.push(morningPerson);
          pickedIds.add(morningPerson.userId);
          logicNotes.push(
            `Morning relief for prior night maps: ${morningPerson.name} (from 00:00)`
          );
        } else {
          warnings.push(
            `${dayLabel(dayOfWeek)}: prior night maps need morning relief — nobody under day-cap offered from 00:00.`
          );
        }
      } else {
        logicNotes.push("Roster includes early morning cover for prior night maps");
      }
    }

    const leftovers = eligible
      .filter((s) => !pickedIds.has(s.userId) && underCap(s))
      .sort(rankForDay);
    for (const person of leftovers) {
      if (picked.length >= staffing.target) break;
      if (tooFarAhead(person, leftovers.filter((s) => !pickedIds.has(s.userId)))) continue;
      picked.push(person);
      pickedIds.add(person.userId);
    }
    for (const person of leftovers) {
      if (picked.length >= staffing.min) break;
      if (pickedIds.has(person.userId)) continue;
      picked.push(person);
      pickedIds.add(person.userId);
    }

    const projected = (userId: string) =>
      (assignedCount.get(userId) ?? 0) + (pickedIds.has(userId) ? 1 : 0);

    const needyPool = eligible
      .filter((s) => !pickedIds.has(s.userId) && underCap(s))
      .sort(
        (a, b) =>
          score(a).util - score(b).util ||
          projected(a.userId) - projected(b.userId) ||
          rankForDay(a, b)
      );
    for (const needy of needyPool) {
      const needyProj = projected(needy.userId);
      const needyOffered = Math.max(1, offeredDays(needy));
      if (needyProj >= needyOffered) continue;
      const slCountNow = picked.filter((p) => p.isShiftLeader).length;
      const victims = [...picked]
        .filter((p) => {
          const pa = projected(p.userId);
          const po = Math.max(1, offeredDays(p));
          const overOffer = pa > po;
          const ahead = pa >= needyProj + 2;
          const utilGap =
            availabilityUtilization(pa, po) >=
            availabilityUtilization(needyProj, needyOffered) + 0.35;
          if (!overOffer && !ahead && !utilGap) return false;
          if (p.isShiftLeader && slCountNow <= 1) return false;
          return true;
        })
        .sort(
          (a, b) =>
            projected(b.userId) - projected(a.userId) ||
            score(b).util - score(a).util ||
            rankFair(b, a)
        );
      const victim = victims[0];
      if (!victim) continue;
      const idx = picked.findIndex((p) => p.userId === victim.userId);
      if (idx < 0) continue;
      picked[idx] = needy;
      pickedIds.delete(victim.userId);
      pickedIds.add(needy.userId);
      logicNotes.push(
        `Fairness: ${needy.name} (${needyProj}/${needyOffered}) in, ${victim.name} out`
      );
    }

    const supCount = picked.filter((p) => !p.isShiftLeader).length;
    const slCount = picked.filter((p) => p.isShiftLeader).length;
    logicNotes.push(
      `Roster ${picked.length}: ${slCount} SL + ${supCount} Sup — ${picked
        .map((p) => `${p.isShiftLeader ? "SL" : "Sup"} ${p.name} ${score(p).assigned}/${score(p).offered}`)
        .join(", ")}`
    );

    if (picked.length < staffing.min) {
      issues.push(
        `Only ${picked.length} available; need at least ${staffing.min} for ${mapsCount} map(s).`
      );
      warnings.push(
        `${dayLabel(dayOfWeek)}: only ${picked.length}/${staffing.min} people available.`
      );
    }

    const dayAssignments: ShiftPlanAssignment[] = picked.map((p) => {
      assignedCount.set(p.userId, (assignedCount.get(p.userId) ?? 0) + 1);
      return {
        dayOfWeek,
        userId: p.userId,
        userName: p.name,
        isShiftLeader: p.isShiftLeader,
      };
    });

    newAssignments.push(...dayAssignments);
    dayPlans.push({
      dayOfWeek,
      label: dayLabel(dayOfWeek),
      mapsCount: taskCount,
      staffNeeded: staffing.target,
      assignments: dayAssignments,
      ok: issues.length === 0,
      issues,
      logicNotes,
    });
  }

  dayPlans.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  newAssignments.sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.userId.localeCompare(b.userId)
  );

  return {
    assignments: newAssignments,
    dayPlans,
    warnings,
    missingSlDays: [...new Set(missingSlDays)],
  };
}
