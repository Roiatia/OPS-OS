import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type {
  ShiftPlanAssignment,
  ShiftPlanMap,
  ShiftPlanStaff,
  ShiftPlanView,
} from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  MAX_MAPS_PER_SUPERVISOR,
  availabilityCoversClock,
  availabilityUtilization,
  defaultSubmissionWeekStart,
  formatWeekRange,
  isoWeekStart,
  minutesToTime,
  weekStartSunday,
} from "../../lib/availabilityRules";
import { formatMapTime } from "../../lib/hubDisplay";
import { Modal } from "../common/Modal";

function staffSortKey(s: ShiftPlanStaff, assignedDays: number) {
  const offered = s.daysOffered ?? s.days.filter((d) => d.canWork).length;
  const util = availabilityUtilization(assignedDays, offered);
  return { offered, util };
}

function coversMapHour(s: ShiftPlanStaff, dayOfWeek: number, clock: number | null): boolean {
  const day = s.days.find((d) => d.dayOfWeek === dayOfWeek);
  if (!day?.canWork) return false;
  if (clock == null) return true;
  return availabilityCoversClock(day, clock);
}

/**
 * Fill every map that has an on-day person free under the hard max and covering that hour.
 * Leave blank when nobody can take it — OPS gets an alert to ask for help.
 */
function seedMapAssignees(
  mapsPerDay: ShiftPlanView["mapsPerDay"],
  dayAssignments: ShiftPlanAssignment[],
  staff: ShiftPlanStaff[]
): { assignees: Record<string, string>; unfilled: UnfilledMapAlert[] } {
  const assignees: Record<string, string> = {};
  const unfilled: UnfilledMapAlert[] = [];
  const staffById = new Map(staff.map((s) => [s.userId, s]));

  for (const dayEntry of mapsPerDay) {
    const dayPeople = dayAssignments
      .filter((a) => a.dayOfWeek === dayEntry.dayOfWeek)
      .map((a) => staffById.get(a.userId))
      .filter(Boolean) as ShiftPlanStaff[];
    if (dayPeople.length === 0) {
      for (const m of dayEntry.maps) {
        unfilled.push({
          dayOfWeek: dayEntry.dayOfWeek,
          mapId: m.id,
          mapNumber: m.mapNumber,
          startLabel:
            m.startMinutes != null ? minutesToTime(m.startMinutes) : "?",
          reason: "No staff on this day yet",
        });
      }
      continue;
    }

    const mapCounts = new Map<string, number>(dayPeople.map((s) => [s.userId, 0]));

    for (const m of dayEntry.maps) {
      const clock = m.startMinutes ?? null;
      const underCap = dayPeople.filter(
        (s) => (mapCounts.get(s.userId) ?? 0) < MAX_MAPS_PER_SUPERVISOR
      );
      const hourFit = underCap.filter((s) =>
        coversMapHour(s, dayEntry.dayOfWeek, clock)
      );

      hourFit.sort((a, b) => {
        const ca = mapCounts.get(a.userId) ?? 0;
        const cb = mapCounts.get(b.userId) ?? 0;
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      });

      const pick = hourFit[0];
      if (pick) {
        assignees[m.id] = pick.userId;
        mapCounts.set(pick.userId, (mapCounts.get(pick.userId) ?? 0) + 1);
        continue;
      }

      const anyoneHour = dayPeople.some((s) =>
        coversMapHour(s, dayEntry.dayOfWeek, clock)
      );
      const startLabel =
        m.startMinutes != null ? minutesToTime(m.startMinutes) : "?";
      unfilled.push({
        dayOfWeek: dayEntry.dayOfWeek,
        mapId: m.id,
        mapNumber: m.mapNumber,
        startLabel,
        reason: anyoneHour
          ? `Everyone covering ${startLabel} is already at ${MAX_MAPS_PER_SUPERVISOR} maps — ask if someone can help`
          : `Nobody on shift is available at ${startLabel} — ask if someone can cover`,
      });
    }
  }
  return { assignees, unfilled };
}

type UnfilledMapAlert = {
  dayOfWeek: number;
  mapId: string;
  mapNumber: string;
  startLabel: string;
  reason: string;
};

export function OpsShiftPlanner() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<ShiftPlanView | null>(null);
  const [assignments, setAssignments] = useState<ShiftPlanAssignment[]>([]);
  /** Per-map supervisor/SL choice for OPS review */
  const [mapAssignees, setMapAssignees] = useState<Record<string, string>>({});
  const [unfilledMaps, setUnfilledMaps] = useState<UnfilledMapAlert[]>([]);
  /** Only after auto-plan leaves gaps OPS must ask people who said no */
  const [showAskCoverageAlert, setShowAskCoverageAlert] = useState(false);
  const [publishStep, setPublishStep] = useState<null | "missing" | "confirm">(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [weekVariant, setWeekVariant] = useState(0);
  const [dayVariants, setDayVariants] = useState<Record<number, number>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const applyPlan = useCallback(
    (
      plan: ShiftPlanView,
      nextAssignments: ShiftPlanAssignment[],
      _warnings?: string[],
      opts?: { fromAutoPlan?: boolean; plannedDays?: number[] }
    ) => {
      setData(plan);
      setAssignments(nextAssignments);
      const seeded = seedMapAssignees(plan.mapsPerDay, nextAssignments, plan.staff);
      const planned = opts?.plannedDays?.length ? new Set(opts.plannedDays) : null;

      if (!planned) {
        setMapAssignees(seeded.assignees);
        setUnfilledMaps(seeded.unfilled);
      } else {
        // Keep map picks on days we did not re-plan
        setMapAssignees((prev) => {
          const next = { ...prev };
          for (const dayEntry of plan.mapsPerDay) {
            if (!planned.has(dayEntry.dayOfWeek)) continue;
            for (const m of dayEntry.maps) {
              delete next[m.id];
              if (seeded.assignees[m.id]) next[m.id] = seeded.assignees[m.id]!;
            }
          }
          return next;
        });
        setUnfilledMaps((prev) => {
          const kept = prev.filter((u) => !planned.has(u.dayOfWeek));
          return [...kept, ...seeded.unfilled.filter((u) => planned.has(u.dayOfWeek))];
        });
      }

      if (opts?.fromAutoPlan) {
        const unfilledForAlert = planned
          ? seeded.unfilled.filter((u) => planned.has(u.dayOfWeek))
          : seeded.unfilled;
        setShowAskCoverageAlert(unfilledForAlert.length > 0);
      } else {
        setShowAskCoverageAlert(false);
      }
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const plan = await api.getShiftPlan(isoWeekStart(weekStart));
      applyPlan(plan, plan.assignments, plan.warnings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [weekStart, applyPlan]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeWeek(delta: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(weekStartSunday(d));
  }

  const mapsByDay = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of data?.mapsPerDay ?? []) {
      map.set(entry.dayOfWeek, entry.count);
    }
    return map;
  }, [data]);

  const assignedCountByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) {
      m.set(a.userId, (m.get(a.userId) ?? 0) + 1);
    }
    return m;
  }, [assignments]);

  const staffRatioRows = useMemo(() => {
    return (data?.staff ?? [])
      .filter((s) => s.submitted || (s.daysOffered ?? 0) > 0)
      .map((s) => {
        const offered = s.daysOffered ?? s.days.filter((d) => d.canWork).length;
        const assigned = assignedCountByUser.get(s.userId) ?? 0;
        return {
          ...s,
          offered,
          assigned,
          util: availabilityUtilization(assigned, offered),
        };
      })
      .sort((a, b) => b.offered - a.offered || a.util - b.util || a.name.localeCompare(b.name));
  }, [data?.staff, assignedCountByUser]);

  /** Hour-fit first; if map is empty after auto, also list people who said they can't (so OPS can ask). */
  function staffOptionsForMap(
    dayOfWeek: number,
    clock: number | null,
    includeAskOverrides = false
  ): ShiftPlanStaff[] {
    const all = data?.staff ?? [];
    const sortStaff = (list: ShiftPlanStaff[]) =>
      [...list].sort((a, b) => {
        const onDayA = assignments.some(
          (x) => x.dayOfWeek === dayOfWeek && x.userId === a.userId
        )
          ? 0
          : 1;
        const onDayB = assignments.some(
          (x) => x.dayOfWeek === dayOfWeek && x.userId === b.userId
        )
          ? 0
          : 1;
        if (onDayA !== onDayB) return onDayA - onDayB;
        if (a.isShiftLeader !== b.isShiftLeader) return a.isShiftLeader ? -1 : 1;
        const ka = staffSortKey(a, assignedCountByUser.get(a.userId) ?? 0);
        const kb = staffSortKey(b, assignedCountByUser.get(b.userId) ?? 0);
        if (Math.abs(ka.util - kb.util) > 0.01) return ka.util - kb.util;
        if (ka.offered !== kb.offered) return kb.offered - ka.offered;
        return a.name.localeCompare(b.name);
      });

    const fit = all.filter((s) => coversMapHour(s, dayOfWeek, clock));
    if (!includeAskOverrides) return sortStaff(fit);
    const fitIds = new Set(fit.map((s) => s.userId));
    const overrides = all.filter((s) => !fitIds.has(s.userId));
    return [...sortStaff(fit), ...sortStaff(overrides)];
  }

  function syncDayAssignments(
    dayOfWeek: number,
    nextMapAssignees: Record<string, string>,
    maps: ShiftPlanMap[]
  ) {
    const mapIds = new Set(maps.map((m) => m.id));
    const neededUserIds = new Set<string>();
    for (const [mapId, userId] of Object.entries(nextMapAssignees)) {
      if (mapIds.has(mapId) && userId) neededUserIds.add(userId);
    }

    setAssignments((prev) => {
      const kept = prev.filter((a) => a.dayOfWeek !== dayOfWeek);
      const added: ShiftPlanAssignment[] = [];
      for (const userId of neededUserIds) {
        const person = data?.staff.find((s) => s.userId === userId);
        if (!person) continue;
        added.push({
          dayOfWeek,
          userId: person.userId,
          userName: person.name,
          isShiftLeader: person.isShiftLeader,
        });
      }
      return [...kept, ...added];
    });
  }

  function setMapStaff(dayOfWeek: number, map: ShiftPlanMap, userId: string) {
    const maps = data?.mapsPerDay.find((d) => d.dayOfWeek === dayOfWeek)?.maps ?? [];
    const next = { ...mapAssignees };
    if (!userId) delete next[map.id];
    else next[map.id] = userId;
    setMapAssignees(next);
    syncDayAssignments(dayOfWeek, next, maps);
    setUnfilledMaps((prev) => {
      const rest = prev.filter((u) => u.mapId !== map.id);
      if (userId) {
        if (rest.length === 0) setShowAskCoverageAlert(false);
        return rest;
      }
      const clock = map.startMinutes ?? null;
      const startLabel = clock != null ? minutesToTime(clock) : "?";
      return [
        ...rest,
        {
          dayOfWeek,
          mapId: map.id,
          mapNumber: map.mapNumber,
          startLabel,
          reason: `Unassigned at ${startLabel}`,
        },
      ];
    });
    setSuccess("");
  }

  async function handleAuto(dayOfWeek?: number, replan = false) {
    setAutoRunning(true);
    setError("");
    setSuccess("");
    try {
      let variant = 0;
      let avoidUserIds: string[] | undefined;

      if (dayOfWeek != null) {
        const prevDayPeople = assignments
          .filter((a) => a.dayOfWeek === dayOfWeek)
          .map((a) => a.userId);
        if (replan) {
          variant = (dayVariants[dayOfWeek] ?? 0) + 1;
          setDayVariants((prev) => ({ ...prev, [dayOfWeek]: variant }));
          // Soft-avoid only this day's previous lineup — other days stay locked & count for fairness
          avoidUserIds = prevDayPeople;
        } else {
          setDayVariants((prev) => ({ ...prev, [dayOfWeek]: 0 }));
        }
      } else if (replan) {
        variant = weekVariant + 1;
        setWeekVariant(variant);
        // Soft-avoid previous week lineup for variety (other days not kept — full week reshuffle)
        avoidUserIds = [...new Set(assignments.map((a) => a.userId))];
      } else {
        setWeekVariant(0);
      }

      // Always lock every other day already planned when running day auto / re-plan
      const lockedAssignments =
        dayOfWeek != null
          ? assignments.filter((a) => a.dayOfWeek !== dayOfWeek)
          : undefined;

      const result = await api.autoGenerateShiftPlan({
        weekStart: isoWeekStart(weekStart),
        dayOfWeek,
        lockedAssignments,
        variant,
        avoidUserIds,
      });
      if (data) {
        applyPlan(
          { ...data, dayPlans: result.dayPlans, warnings: result.warnings ?? [] },
          result.assignments,
          result.warnings,
          {
            fromAutoPlan: true,
            plannedDays: dayOfWeek != null ? [dayOfWeek] : undefined,
          }
        );
      } else {
        setAssignments(result.assignments);
      }
      if (dayOfWeek != null) {
        const label =
          DAY_LABELS[
            AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number])
          ];
        const lockedDays = lockedAssignments
          ? new Set(lockedAssignments.map((a) => a.dayOfWeek)).size
          : 0;
        setSuccess(
          replan
            ? `${label} re-planned — kept ${lockedDays} other day(s) already done (used for fairness).`
            : `${label} planned — kept ${lockedDays} other day(s) already done.`
        );
      } else {
        setSuccess(
          replan
            ? "Week re-planned — full reshuffle."
            : "Week auto-plan ready — edit per map, then save."
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAutoRunning(false);
    }
  }

  const dayPlans = data?.dayPlans ?? [];
  const missingAvailability = useMemo(
    () => (data?.staff ?? []).filter((s) => !s.submitted),
    [data?.staff]
  );

  async function publishPlan() {
    setPublishStep(null);
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.saveShiftPlan({
        weekStart: isoWeekStart(weekStart),
        assignments,
      });
      if (result.dayPlans && data) {
        setData({
          ...data,
          dayPlans: result.dayPlans,
          saved: true,
          published: true,
          publishedAt: result.publishedAt ?? new Date().toISOString(),
        });
      }
      setSuccess("Plan published.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function requestPublish() {
    setError("");
    setSuccess("");
    if (missingAvailability.length > 0) {
      setPublishStep("missing");
      return;
    }
    setPublishStep("confirm");
  }

  return (
    <div className="space-y-6">
      {publishStep === "missing" && (
        <Modal title="Availability not complete" onClose={() => setPublishStep(null)}>
          <p className="text-sm text-slate-700 mb-3">
            {missingAvailability.length} people have not submitted availability for this week
            yet. You can wait for them, or continue and publish anyway.
          </p>
          <ul className="text-sm text-slate-800 mb-4 max-h-40 overflow-y-auto space-y-1 border border-amber-100 bg-amber-50/80 rounded-xl px-3 py-2">
            {missingAvailability.map((s) => (
              <li key={s.userId}>
                {s.name}
                <span className="text-muted"> · {s.isShiftLeader ? "SL" : "Sup"}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPublishStep(null)}
              className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-slate-50"
            >
              Wait for them
            </button>
            <button
              type="button"
              onClick={() => setPublishStep("confirm")}
              className="px-4 py-2 text-sm rounded-xl bg-amber-600 text-white hover:bg-amber-700"
            >
              Continue to publish
            </button>
          </div>
        </Modal>
      )}

      {publishStep === "confirm" && (
        <Modal title="Publish schedule?" onClose={() => setPublishStep(null)}>
          <p className="text-sm text-slate-700 mb-4">
            This will publish the week plan so supervisors and shift leaders can see their
            schedule.
            {missingAvailability.length > 0 && (
              <span className="block mt-2 text-amber-800">
                Note: {missingAvailability.length} people still have no availability submission.
              </span>
            )}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPublishStep(null)}
              className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void publishPlan()}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Publishing…" : "Publish"}
            </button>
          </div>
        </Modal>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeWeek(-1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            ←
          </button>
          <div>
            <p className="text-sm font-semibold">Week of {formatWeekRange(weekStart)}</p>
            <p className="text-xs text-muted">
              {data?.published ? "Published" : "Draft until you save & publish"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            →
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {data?.published && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
              Published
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleAuto(undefined, false)}
            disabled={autoRunning || loading}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-brand-300 text-brand-700 bg-brand-50 hover:bg-brand-100 disabled:opacity-50"
          >
            {autoRunning ? "Planning…" : "Auto-plan week"}
          </button>
          <button
            type="button"
            onClick={() => void handleAuto(undefined, true)}
            disabled={autoRunning || loading || assignments.length === 0}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-border text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Shuffle a different fair plan for the whole week"
          >
            Re-plan week
          </button>
          <button
            type="button"
            onClick={() => requestPublish()}
            disabled={saving || loading || assignments.length === 0}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Publishing…" : "Save & publish"}
          </button>
        </div>
      </div>

      {/* TEMP week logic cheat-sheet — delete later */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-[11px] text-slate-600 space-y-1">
        <p className="font-semibold text-slate-800">TEMP · How auto-plan chooses people</p>
        <p>
          1) Pick open/close SL per day (hardest days first, spread SL duty, prefer SLs with fewer
          other days left). 2) Fill roster fairly by assigned÷offered (~5 maps each, max{" "}
          {MAX_MAPS_PER_SUPERVISOR}). 3) Add people if needed for capacity or uncovered start hours.
          4) Fill each map only with hour-fit staff under the max — yellow = still empty.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          {success}
        </p>
      )}
      {(showAskCoverageAlert && unfilledMaps.length > 0) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-950">
            Auto-plan could not fill every map
          </p>
          <p className="text-xs text-amber-950/90">
            {unfilledMaps.length} map{unfilledMaps.length === 1 ? "" : "s"} still empty (yellow).
            Ask people even if they marked unavailable — you can pick them on those rows (listed as
            “ask / not offered”).
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading shift plan…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-4">
            {AVAILABILITY_DAYS.map((day, idx) => {
              const label = DAY_LABELS[idx];
              const mapsCount = mapsByDay.get(day) ?? 0;
              const dayPlan = dayPlans.find((d) => d.dayOfWeek === day);
              const mapsList = data?.mapsPerDay.find((m) => m.dayOfWeek === day)?.maps ?? [];

              return (
                <div key={day} className="rounded-xl border border-border bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{label}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {mapsCount} map{mapsCount === 1 ? "" : "s"}
                        {dayPlan && mapsCount > 0 ? ` · need ~${dayPlan.staffNeeded} people` : ""}
                      </p>
                    </div>
                    {mapsCount > 0 && (
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleAuto(day, false)}
                          disabled={autoRunning || loading}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 disabled:opacity-50"
                          title="Keeps other days; uses their assignments for fairness"
                        >
                          Auto-plan day
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAuto(day, true)}
                          disabled={
                            autoRunning ||
                            loading ||
                            !assignments.some((a) => a.dayOfWeek === day)
                          }
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          title="Try a different fair lineup for this day only"
                        >
                          Re-plan day
                        </button>
                      </div>
                    )}
                  </div>

                  {/* TEMP: auto-plan logic notes — delete when planner is trusted */}
                  {dayPlan?.logicNotes && dayPlan.logicNotes.length > 0 && (
                    <div className="mb-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-700 mb-1">
                        TEMP · Why this day&apos;s people were chosen
                      </p>
                      <ul className="text-[11px] text-slate-600 space-y-1 list-disc pl-4">
                        {dayPlan.logicNotes.map((note, i) => (
                          <li key={i}>{note}</li>
                        ))}
                        <li>
                          Maps: assign only to people free at that start hour, even spread, max{" "}
                          {MAX_MAPS_PER_SUPERVISOR}/person. Yellow row = still empty (no hour-fit
                          capacity left).
                        </li>
                      </ul>
                    </div>
                  )}

                  {mapsList.length === 0 ? (
                    <p className="text-xs text-muted">No maps scheduled.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/80 max-h-[28rem] overflow-y-auto">
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-slate-100 text-slate-600 z-10">
                          <tr>
                            <th className="text-left font-semibold px-2 py-1.5">Map</th>
                            <th className="text-left font-semibold px-2 py-1.5">Start</th>
                            <th className="text-left font-semibold px-2 py-1.5">Mapper</th>
                            <th className="text-left font-semibold px-2 py-1.5 min-w-[160px]">
                              Staff
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {mapsList.map((m) => {
                            const clock = m.startMinutes ?? null;
                            const selected = mapAssignees[m.id] ?? "";
                            const isUnfilled = !selected;
                            const options = staffOptionsForMap(day, clock, isUnfilled);
                            const selectedPerson =
                              selected && !options.some((s) => s.userId === selected)
                                ? data?.staff.find((s) => s.userId === selected)
                                : null;
                            return (
                              <tr
                                key={m.id}
                                className={
                                  isUnfilled
                                    ? "border-t border-amber-200 bg-amber-50/80"
                                    : "border-t border-slate-100 bg-white/60"
                                }
                              >
                                <td className="px-2 py-1.5 font-mono text-slate-800">
                                  {m.mapNumber}
                                </td>
                                <td className="px-2 py-1.5 tabular-nums text-slate-700">
                                  {m.fieldDate
                                    ? formatMapTime(m.fieldDate)
                                    : clock != null
                                      ? minutesToTime(clock)
                                      : "—"}
                                </td>
                                <td className="px-2 py-1.5 text-muted truncate max-w-[90px]">
                                  {m.mapperName || "—"}
                                </td>
                                <td className="px-2 py-1.5">
                                  <select
                                    className={`w-full text-[11px] border rounded-md px-1.5 py-1 bg-white ${
                                      isUnfilled
                                        ? "border-amber-400 text-amber-900"
                                        : "border-border"
                                    }`}
                                    value={selected}
                                    onChange={(e) => setMapStaff(day, m, e.target.value)}
                                  >
                                    <option value="">— choose —</option>
                                    {selectedPerson && (
                                      <option value={selectedPerson.userId}>
                                        {selectedPerson.isShiftLeader ? "SL" : "Sup"} ·{" "}
                                        {selectedPerson.name} · (current)
                                      </option>
                                    )}
                                    {options.map((s) => {
                                      const hours =
                                        s.days.find((d) => d.dayOfWeek === day)?.hoursLabel ??
                                        "hours?";
                                      const role = s.isShiftLeader ? "SL" : "Sup";
                                      const fits = coversMapHour(s, day, clock);
                                      return (
                                        <option key={s.userId} value={s.userId}>
                                          {fits
                                            ? `${role} · ${s.name} · ${hours}`
                                            : `${role} · ${s.name} · ask / not offered`}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <aside className="rounded-xl border border-border bg-white p-3 h-fit lg:sticky lg:top-4">
            <p className="text-xs font-semibold text-slate-900 mb-1">Availability ratio</p>
            <p className="text-[11px] text-muted mb-3">Assigned days / days offered</p>
            <div className="space-y-1.5 max-h-[32rem] overflow-y-auto">
              {staffRatioRows.length === 0 ? (
                <p className="text-[11px] text-muted">No submissions yet.</p>
              ) : (
                staffRatioRows.map((s) => (
                  <div
                    key={s.userId}
                    className="flex items-baseline justify-between gap-2 text-[11px] border-b border-slate-50 pb-1"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-slate-800">{s.name}</span>
                      <span className="block text-muted">
                        {s.isShiftLeader ? "SL · r5" : "Sup"}
                        {!s.isShiftLeader && s.supervisorRating != null
                          ? ` · r${s.supervisorRating}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-right">
                      <span className="font-semibold text-slate-900">
                        {s.assigned}/{s.offered}
                      </span>
                      <span className="block text-muted">{s.offered}d offer</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
