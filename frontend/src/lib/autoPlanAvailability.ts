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
  isRequiredMapTask,
  staffingForMaps,
  staffingRatioHint,
} from "./staffingRatio";
import { coversMapHour } from "./mapSupervisorSlots";

function dayLabel(dayOfWeek: number): string {
  const idx = AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number]);
  return DAY_LABELS[idx >= 0 ? idx : 0];
}

function canWorkDay(s: ShiftPlanStaff, dayOfWeek: number): boolean {
  return s.days.some((d) => d.dayOfWeek === dayOfWeek && d.canWork);
}

function offeredDays(s: ShiftPlanStaff): number {
  return s.daysOffered ?? s.days.filter((d) => d.canWork).length;
}

/**
 * Auto-plan rules (frontend):
 * - ~2 maps/person (6 maps → ~3–4 people)
 * - Every day with maps: ≥1 SL (prefer open + close when seats allow)
 * - Fill remaining seats with supervisors who offered — lowest util first
 *   so nobody who offered many days stays at 0 while others are full
 * - Never overload the same SL every day (soft weekly fairness)
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

  for (const dayOfWeek of AVAILABILITY_DAYS) {
    const mapsEntry = input.mapsPerDay.find((m) => m.dayOfWeek === dayOfWeek);
    const maps: ShiftPlanMap[] = mapsEntry?.maps ?? [];
    const mapsCount = countRequiredMaps(maps);
    const taskCount = maps.length;

    if (!daysToPlan.includes(dayOfWeek)) {
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
      continue;
    }

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

    const eligible = input.staff.filter((s) => canWorkDay(s, dayOfWeek));
    const staffing = staffingForMaps(mapsCount, eligible.length);
    const issues: string[] = [];
    const logicNotes: string[] = [
      `${mapsCount} map(s) · ${staffingRatioHint(mapsCount)} · target ${staffing.target} · ${eligible.length} offered today`,
    ];

    const score = (s: ShiftPlanStaff) => {
      const assigned = assignedCount.get(s.userId) ?? 0;
      const offered = Math.max(1, offeredDays(s));
      const util = availabilityUtilization(assigned, offered);
      // Soft-cap: people already heavily used this week go to the back
      const overload = assigned >= Math.max(2, Math.ceil(offered * 0.75)) ? 500 : 0;
      const avoidPenalty = avoid.has(s.userId) ? 1000 : 0;
      const salt = (s.userId.charCodeAt(0) + variant * 17 + dayOfWeek * 3) % 7;
      return { util, assigned, offered, overload, avoidPenalty, salt };
    };

    const rankFair = (a: ShiftPlanStaff, b: ShiftPlanStaff) => {
      const sa = score(a);
      const sb = score(b);
      if (sa.avoidPenalty !== sb.avoidPenalty) return sa.avoidPenalty - sb.avoidPenalty;
      if (sa.overload !== sb.overload) return sa.overload - sb.overload;
      // Critical: nobody who offered stays at 0 while others get days
      if (sa.assigned === 0 && sb.assigned > 0) return -1;
      if (sb.assigned === 0 && sa.assigned > 0) return 1;
      // Lowest utilization first — Lior 0/6 beats someone at 3/6
      if (Math.abs(sa.util - sb.util) > 0.001) return sa.util - sb.util;
      if (sa.assigned !== sb.assigned) return sa.assigned - sb.assigned;
      // More days offered → slightly prefer (they committed more)
      if (sa.offered !== sb.offered) return sb.offered - sa.offered;
      if (sa.salt !== sb.salt) return sa.salt - sb.salt;
      return a.name.localeCompare(b.name);
    };

    const picked: ShiftPlanStaff[] = [];
    const pickedIds = new Set<string>();

    const mapClocks = maps
      .filter((m) => isRequiredMapTask(m.taskKind))
      .map((m) => m.startMinutes)
      .filter((c): c is number => c != null);
    const earliest = mapClocks.length ? Math.min(...mapClocks) : null;
    const latest = mapClocks.length ? Math.max(...mapClocks) : null;
    const nightClocks = mapClocks.filter((c) => c >= NIGHT_START_MINUTES);
    const hasNightMaps = nightClocks.length > 0;

    const slPool = eligible.filter((s) => s.isShiftLeader);
    const supPool = eligible.filter((s) => !s.isShiftLeader);

    const coversClock = (s: ShiftPlanStaff, clock: number | null) =>
      clock == null || coversMapHour(s, dayOfWeek, clock);

    /**
     * Fairness first; clock cover only breaks ties when util is similar.
     * (Night/early preference must not starve people at 0/6.)
     */
    const rankForBand = (
      a: ShiftPlanStaff,
      b: ShiftPlanStaff,
      preferClock: number | null
    ) => {
      const fair = rankFair(a, b);
      const sa = score(a);
      const sb = score(b);
      const utilClose = Math.abs(sa.util - sb.util) < 0.2 && sa.assigned === sb.assigned;
      if (preferClock != null && utilClose) {
        const aOk = coversClock(a, preferClock) ? 0 : 1;
        const bOk = coversClock(b, preferClock) ? 0 : 1;
        if (aOk !== bOk) return aOk - bOk;
      }
      return fair;
    };

    // 1) Always one open SL — fair among SLs (not the same person every day)
    const openSl =
      [...slPool].sort((a, b) => rankForBand(a, b, earliest))[0] ?? null;

    if (openSl) {
      picked.push(openSl);
      pickedIds.add(openSl.userId);
      logicNotes.push(`Open SL: ${openSl.name} (${score(openSl).assigned}/${score(openSl).offered})`);
    } else {
      issues.push("No shift leader available — OPS must cover or ask an SL.");
      missingSlDays.push(dayOfWeek);
      warnings.push(
        `${dayLabel(dayOfWeek)}: no shift leader available for ${mapsCount} map(s).`
      );
    }

    // 2) Fill remaining seats with supervisors by fairness (zeros first)
    const wantCloseSl = staffing.target >= 3 && slPool.some((s) => s.userId !== openSl?.userId);
    const seatsForSupervisors = Math.max(
      0,
      staffing.target - picked.length - (wantCloseSl ? 1 : 0)
    );

    const sortedSups = [...supPool]
      .filter((s) => !pickedIds.has(s.userId))
      .sort((a, b) => {
        if (hasNightMaps) {
          const nightClock = Math.min(...nightClocks);
          return rankForBand(a, b, nightClock);
        }
        return rankFair(a, b);
      });
    for (const person of sortedSups) {
      if (picked.filter((p) => !p.isShiftLeader).length >= seatsForSupervisors) break;
      if (picked.length >= staffing.target - (wantCloseSl ? 1 : 0)) break;
      picked.push(person);
      pickedIds.add(person.userId);
    }

    // 3) Close SL if we reserved a seat (different SL, fair util)
    if (wantCloseSl && picked.length < staffing.target) {
      const closeSl =
        [...slPool]
          .filter((s) => !pickedIds.has(s.userId))
          .sort((a, b) => rankForBand(a, b, latest))[0] ?? null;
      if (closeSl) {
        picked.push(closeSl);
        pickedIds.add(closeSl.userId);
        logicNotes.push(
          `Close SL: ${closeSl.name} (${score(closeSl).assigned}/${score(closeSl).offered})`
        );
      }
    }

    // 3b) Night maps: add night cover only if roster still can't cover 22:00+
    if (hasNightMaps) {
      const nightClock = Math.min(...nightClocks);
      const rosterCoversNight = picked.some((p) => coversClock(p, nightClock));
      if (!rosterCoversNight) {
        const nightPerson =
          eligible
            .filter((s) => !pickedIds.has(s.userId) && coversClock(s, nightClock))
            .sort(rankFair)[0] ?? null;
        if (nightPerson) {
          picked.push(nightPerson);
          pickedIds.add(nightPerson.userId);
          logicNotes.push(
            `Night cover: ${nightPerson.name} (maps from ${Math.floor(nightClock / 60)}:00)`
          );
        } else {
          warnings.push(
            `${dayLabel(dayOfWeek)}: night map(s) at ${Math.floor(nightClock / 60)}:00 — nobody offered that hour.`
          );
        }
      }
    }

    // 4) If still short of target, add anyone left by fairness (prefer Sup, then SL)
    const leftovers = eligible
      .filter((s) => !pickedIds.has(s.userId))
      .sort((a, b) => {
        if (a.isShiftLeader !== b.isShiftLeader) return a.isShiftLeader ? 1 : -1;
        return rankFair(a, b);
      });
    for (const person of leftovers) {
      if (picked.length >= staffing.target) break;
      picked.push(person);
      pickedIds.add(person.userId);
    }

    // 5) Fairness rescue: swap high-util roster people for anyone still at 0 this week
    const stillZero = eligible
      .filter((s) => !pickedIds.has(s.userId) && (assignedCount.get(s.userId) ?? 0) === 0)
      .sort(rankFair);
    for (const needy of stillZero) {
      const slCountNow = picked.filter((p) => p.isShiftLeader).length;
      const victims = [...picked]
        .filter((p) => {
          if ((assignedCount.get(p.userId) ?? 0) === 0) return false;
          // Keep at least one SL on the day
          if (p.isShiftLeader && slCountNow <= 1) return false;
          return true;
        })
        .sort(
          (a, b) =>
            (assignedCount.get(b.userId) ?? 0) - (assignedCount.get(a.userId) ?? 0) ||
            rankFair(b, a)
        );
      const victim = victims[0];
      if (!victim) break;
      const idx = picked.findIndex((p) => p.userId === victim.userId);
      if (idx < 0) break;
      picked[idx] = needy;
      pickedIds.delete(victim.userId);
      pickedIds.add(needy.userId);
      logicNotes.push(
        `Fairness: ${needy.name} (0/${score(needy).offered}) in, ${victim.name} out`
      );
    }

    // 6) If still under min headcount, pull anyone left
    if (picked.length < staffing.min) {
      for (const person of leftovers) {
        if (picked.length >= staffing.min) break;
        if (pickedIds.has(person.userId)) continue;
        picked.push(person);
        pickedIds.add(person.userId);
      }
    }

    const supCount = picked.filter((p) => !p.isShiftLeader).length;
    const slCount = picked.filter((p) => p.isShiftLeader).length;
    logicNotes.push(
      `Roster ${picked.length}: ${slCount} SL + ${supCount} Sup — ${picked
        .map((p) => `${p.isShiftLeader ? "SL" : "Sup"} ${p.name}`)
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

  newAssignments.sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.userName.localeCompare(b.userName)
  );

  return {
    assignments: newAssignments,
    dayPlans,
    warnings,
    missingSlDays: [...new Set(missingSlDays)],
  };
}
