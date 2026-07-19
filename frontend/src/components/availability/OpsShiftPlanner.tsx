import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type {
  ScheduleTaskKind,
  ShiftPlanAssignment,
  ShiftPlanMap,
  ShiftPlanStaff,
  ShiftPlanView,
} from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  availabilityUtilization,
  defaultSubmissionWeekStart,
  formatWeekRange,
  isoWeekStart,
  minutesToTime,
  weekStartSunday,
} from "../../lib/availabilityRules";
import {
  type MapSupervisorSlot,
  type UnfilledMapAlert,
  allowedStartOptions,
  canSuperviseClient,
  formatSlotEnd,
  proposeWorkWindow,
  seedMapAssignees,
} from "../../lib/mapSupervisorSlots";
import { formatMapTime } from "../../lib/hubDisplay";
import { Modal } from "../common/Modal";

function staffSortKey(s: ShiftPlanStaff, assignedDays: number) {
  const offered = s.daysOffered ?? s.days.filter((d) => d.canWork).length;
  const util = availabilityUtilization(assignedDays, offered);
  return { offered, util };
}

function taskKindLabel(kind?: ScheduleTaskKind): string {
  switch (kind) {
    case "HAPPY_HOUR":
      return "Happy hour";
    case "COMPANY_MEETING":
      return "Meeting";
    case "MAPPING_REFRESH":
      return "Mapping refresh";
    default:
      return "Map";
  }
}

export function OpsShiftPlanner() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<ShiftPlanView | null>(null);
  const [assignments, setAssignments] = useState<ShiftPlanAssignment[]>([]);
  /** Per-map supervisor slots (1+; hours must sit inside their availability, 6–12h) */
  const [mapAssignees, setMapAssignees] = useState<Record<string, MapSupervisorSlot[]>>({});
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
      const seeded = seedMapAssignees(plan.mapsPerDay, nextAssignments, plan.staff);
      const planned = opts?.plannedDays?.length ? new Set(opts.plannedDays) : null;

      // Pull anyone seeded onto a task into that day's roster (cover maps → company first)
      const mergedAssignments = [...nextAssignments];
      const staffById = new Map(plan.staff.map((s) => [s.userId, s]));
      for (const dayEntry of plan.mapsPerDay) {
        if (planned && !planned.has(dayEntry.dayOfWeek)) continue;
        const have = new Set(
          mergedAssignments
            .filter((a) => a.dayOfWeek === dayEntry.dayOfWeek)
            .map((a) => a.userId)
        );
        for (const m of dayEntry.maps) {
          for (const slot of seeded.assignees[m.id] ?? []) {
            if (have.has(slot.userId)) continue;
            const person = staffById.get(slot.userId);
            if (!person) continue;
            mergedAssignments.push({
              dayOfWeek: dayEntry.dayOfWeek,
              userId: person.userId,
              userName: person.name,
              isShiftLeader: person.isShiftLeader,
            });
            have.add(slot.userId);
          }
        }
      }
      setAssignments(mergedAssignments);

      if (!planned) {
        setMapAssignees(seeded.assignees);
        setUnfilledMaps(seeded.unfilled);
      } else {
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

  /** People who offered hours that fit this task (normal add — no ask mix). */
  function supervisorOptionsForMap(
    dayOfWeek: number,
    clock: number | null,
    client: string,
    taskKind: ScheduleTaskKind | undefined,
    alreadySelected: string[] = []
  ): ShiftPlanStaff[] {
    return (data?.staff ?? [])
      .filter((s) => !alreadySelected.includes(s.userId))
      .filter((s) => canSuperviseClient(s, client, taskKind))
      .filter((s) => proposeWorkWindow(s, dayOfWeek, clock) != null)
      .sort((a, b) => {
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
        if (a.isShiftLeader !== b.isShiftLeader) return a.isShiftLeader ? 1 : -1;
        const ka = staffSortKey(a, assignedCountByUser.get(a.userId) ?? 0);
        const kb = staffSortKey(b, assignedCountByUser.get(b.userId) ?? 0);
        if (Math.abs(ka.util - kb.util) > 0.01) return ka.util - kb.util;
        if (ka.offered !== kb.offered) return kb.offered - ka.offered;
        return a.name.localeCompare(b.name);
      });
  }

  /** Separate: people who did not offer a fitting window — ask them for help. */
  function askHelpOptionsForMap(
    dayOfWeek: number,
    clock: number | null,
    client: string,
    taskKind: ScheduleTaskKind | undefined,
    alreadySelected: string[] = []
  ): ShiftPlanStaff[] {
    const fitIds = new Set(
      supervisorOptionsForMap(dayOfWeek, clock, client, taskKind, alreadySelected).map(
        (s) => s.userId
      )
    );
    return (data?.staff ?? [])
      .filter((s) => !alreadySelected.includes(s.userId))
      .filter((s) => !fitIds.has(s.userId))
      .filter((s) => canSuperviseClient(s, client, taskKind))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function syncDayAssignments(
    dayOfWeek: number,
    nextMapAssignees: Record<string, MapSupervisorSlot[]>,
    maps: ShiftPlanMap[]
  ) {
    const mapIds = new Set(maps.map((m) => m.id));
    const neededUserIds = new Set<string>();
    for (const [mapId, slots] of Object.entries(nextMapAssignees)) {
      if (!mapIds.has(mapId)) continue;
      for (const slot of slots) {
        if (slot.userId) neededUserIds.add(slot.userId);
      }
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

  function setMapSupervisorSlots(
    dayOfWeek: number,
    map: ShiftPlanMap,
    slots: MapSupervisorSlot[]
  ) {
    const maps = data?.mapsPerDay.find((d) => d.dayOfWeek === dayOfWeek)?.maps ?? [];
    const next = { ...mapAssignees };
    const unique: MapSupervisorSlot[] = [];
    const seen = new Set<string>();
    for (const slot of slots) {
      if (!slot.userId || seen.has(slot.userId)) continue;
      seen.add(slot.userId);
      unique.push(slot);
    }
    if (unique.length === 0) delete next[map.id];
    else next[map.id] = unique;
    setMapAssignees(next);
    syncDayAssignments(dayOfWeek, next, maps);
    setUnfilledMaps((prev) => {
      const rest = prev.filter((u) => u.mapId !== map.id);
      if (unique.length > 0) {
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

  function addMapSupervisor(
    dayOfWeek: number,
    map: ShiftPlanMap,
    userId: string,
    opts?: { askOverride?: boolean }
  ) {
    if (!userId) return;
    const current = mapAssignees[map.id] ?? [];
    if (current.some((s) => s.userId === userId)) return;
    const person = data?.staff.find((s) => s.userId === userId);
    if (!person) return;
    const lastEnd = current.length
      ? Math.max(...current.map((s) => s.endMinutes))
      : map.startMinutes ?? null;
    // Overnight end (>24:00) already covers past midnight — don't start a same-day handoff after it
    const entrance =
      current.length > 0
        ? lastEnd != null && lastEnd < 24 * 60
          ? lastEnd
          : null
        : (map.startMinutes ?? null);
    if (current.length > 0 && entrance == null) return;
    let win = proposeWorkWindow(person, dayOfWeek, entrance);
    if (!win && opts?.askOverride) {
      win = proposeWorkWindow(person, dayOfWeek, entrance, { allowShort: true });
    }
    if (!win && opts?.askOverride && entrance != null) {
      // Asked to help outside offered hours — assume 6h from entrance
      win = {
        startMinutes: entrance,
        endMinutes: entrance + 6 * 60,
        duration: 6 * 60,
      };
    }
    if (!win) return;
    setMapSupervisorSlots(dayOfWeek, map, [
      ...current,
      {
        userId,
        startMinutes: win.startMinutes,
        endMinutes: win.endMinutes,
        handoff: current.length > 0,
      },
    ]);
  }

  function removeMapSupervisor(dayOfWeek: number, map: ShiftPlanMap, userId: string) {
    const current = mapAssignees[map.id] ?? [];
    setMapSupervisorSlots(
      dayOfWeek,
      map,
      current.filter((s) => s.userId !== userId)
    );
  }

  /** Only entrance is editable — end always follows availability (max 12h). */
  function updateMapSupervisorEntrance(
    dayOfWeek: number,
    map: ShiftPlanMap,
    userId: string,
    startMinutes: number
  ) {
    const person = data?.staff.find((s) => s.userId === userId);
    if (!person) return;
    const current = mapAssignees[map.id] ?? [];
    const next = current.map((slot) => {
      if (slot.userId !== userId) return slot;
      const starts = allowedStartOptions(person, dayOfWeek, map.startMinutes ?? null);
      let start = startMinutes;
      if (!starts.includes(start) && starts.length > 0) start = starts[0]!;
      const win = proposeWorkWindow(person, dayOfWeek, start);
      if (!win) return slot;
      return {
        ...slot,
        startMinutes: win.startMinutes,
        endMinutes: win.endMinutes,
      };
    });
    setMapSupervisorSlots(dayOfWeek, map, next);
  }

  /** Clear auto-plan picks so OPS can assign supervisors by hand. */
  function startManualPlan(dayOfWeek?: number) {
    if (!data) return;
    setError("");
    setShowAskCoverageAlert(false);
    if (dayOfWeek == null) {
      setAssignments([]);
      setMapAssignees({});
      setUnfilledMaps(
        data.mapsPerDay.flatMap((dayEntry) =>
          dayEntry.maps.map((m) => ({
            dayOfWeek: dayEntry.dayOfWeek,
            mapId: m.id,
            mapNumber: m.mapNumber,
            startLabel: m.startMinutes != null ? minutesToTime(m.startMinutes) : "?",
            reason: "Assign manually",
          }))
        )
      );
      setSuccess("Manual week — add supervisors per task (no auto-plan).");
      return;
    }
    const dayMaps =
      data.mapsPerDay.find((d) => d.dayOfWeek === dayOfWeek)?.maps ?? [];
    setAssignments((prev) => prev.filter((a) => a.dayOfWeek !== dayOfWeek));
    setMapAssignees((prev) => {
      const next = { ...prev };
      for (const m of dayMaps) delete next[m.id];
      return next;
    });
    setUnfilledMaps((prev) => {
      const kept = prev.filter((u) => u.dayOfWeek !== dayOfWeek);
      return [
        ...kept,
        ...dayMaps.map((m) => ({
          dayOfWeek,
          mapId: m.id,
          mapNumber: m.mapNumber,
          startLabel: m.startMinutes != null ? minutesToTime(m.startMinutes) : "?",
          reason: "Assign manually",
        })),
      ];
    });
    const label =
      DAY_LABELS[
        AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number])
      ];
    setSuccess(`${label} — manual: add supervisors per task (no auto-plan).`);
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
            : "Week auto-plan ready — edit per task, then save."
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
            {missingAvailability.length} supervisors have not submitted availability for this week
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
                Note: {missingAvailability.length} supervisors still have no availability submission.
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
            onClick={() => startManualPlan()}
            disabled={autoRunning || loading || !data}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 text-slate-800 bg-white hover:bg-slate-50 disabled:opacity-50"
            title="Clear auto picks and assign supervisors yourself"
          >
            Plan manually
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
            Auto-plan could not fill every task
          </p>
          <p className="text-xs text-amber-950/90">
            {unfilledMaps.length} task{unfilledMaps.length === 1 ? "" : "s"} still empty (yellow).
            Use “add supervisor” for people who offered hours, or the separate “ask for help”
            dropdown for people who did not.
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
                        {mapsCount} task{mapsCount === 1 ? "" : "s"}
                        {dayPlan && mapsCount > 0
                          ? ` · need ~${dayPlan.staffNeeded} supervisors`
                          : ""}
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
                        <button
                          type="button"
                          onClick={() => startManualPlan(day)}
                          disabled={autoRunning || loading}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-800 bg-white hover:bg-slate-50 disabled:opacity-50"
                          title="Clear this day and assign supervisors yourself"
                        >
                          Manual day
                        </button>
                      </div>
                    )}
                  </div>

                  {mapsList.length === 0 ? (
                    <p className="text-xs text-muted">No tasks scheduled.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/80 max-h-[28rem] overflow-y-auto">
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-slate-100 text-slate-600 z-10">
                          <tr>
                            <th className="text-left font-semibold px-2 py-1.5">Task</th>
                            <th className="text-left font-semibold px-2 py-1.5">Type</th>
                            <th className="text-left font-semibold px-2 py-1.5">Client</th>
                            <th className="text-left font-semibold px-2 py-1.5">Start</th>
                            <th className="text-left font-semibold px-2 py-1.5">Mapper</th>
                            <th className="text-left font-semibold px-2 py-1.5 min-w-[200px]">
                              Supervisors
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {mapsList.map((m) => {
                            const clock = m.startMinutes ?? null;
                            const selectedSlots = mapAssignees[m.id] ?? [];
                            const selectedIds = selectedSlots.map((s) => s.userId);
                            const isUnfilled = selectedSlots.length === 0;
                            const options = supervisorOptionsForMap(
                              day,
                              clock,
                              m.client,
                              m.taskKind,
                              selectedIds
                            );
                            const askOptions = isUnfilled
                              ? askHelpOptionsForMap(
                                  day,
                                  clock,
                                  m.client,
                                  m.taskKind,
                                  selectedIds
                                )
                              : [];
                            return (
                              <tr
                                key={m.id}
                                className={
                                  isUnfilled
                                    ? "border-t border-amber-200 bg-amber-50/80"
                                    : "border-t border-slate-100 bg-white/60"
                                }
                              >
                                <td className="px-2 py-1.5 font-mono text-slate-800 align-top">
                                  {m.mapNumber}
                                </td>
                                <td className="px-2 py-1.5 text-slate-700 align-top whitespace-nowrap">
                                  {taskKindLabel(m.taskKind)}
                                </td>
                                <td className="px-2 py-1.5 text-slate-700 align-top max-w-[100px] truncate" title={m.client}>
                                  {m.client || "—"}
                                </td>
                                <td className="px-2 py-1.5 tabular-nums text-slate-700 align-top">
                                  {m.fieldDate
                                    ? formatMapTime(m.fieldDate)
                                    : clock != null
                                      ? minutesToTime(clock)
                                      : "—"}
                                </td>
                                <td className="px-2 py-1.5 text-muted truncate max-w-[90px] align-top">
                                  {(m.taskKind ?? "MAP") === "MAP" ? m.mapperName || "—" : "—"}
                                </td>
                                <td className="px-2 py-1.5 align-top">
                                  <div className="space-y-1.5">
                                    {selectedSlots.map((slot) => {
                                      const s = data?.staff.find((x) => x.userId === slot.userId);
                                      if (!s) return null;
                                      const startOpts = allowedStartOptions(
                                        s,
                                        day,
                                        slot.handoff ? slot.startMinutes : clock
                                      );
                                      const untilH = formatSlotEnd(slot.endMinutes);
                                      return (
                                        <div
                                          key={slot.userId}
                                          className="rounded-md bg-brand-50 text-brand-900 border border-brand-100 px-1.5 py-1 space-y-1"
                                        >
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="text-[10px] font-medium truncate">
                                              {slot.handoff ? "Handoff · " : ""}
                                              {s.isShiftLeader ? "SL" : "Sup"} · {s.name}
                                            </span>
                                            <button
                                              type="button"
                                              className="text-brand-700/70 hover:text-rose-700 text-[11px] shrink-0"
                                              aria-label={`Remove ${s.name}`}
                                              onClick={() =>
                                                removeMapSupervisor(day, m, s.userId)
                                              }
                                            >
                                              ×
                                            </button>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-1 text-[10px]">
                                            <span className="text-muted">In</span>
                                            <select
                                              className="border border-brand-200 rounded px-1 py-0.5 bg-white"
                                              value={slot.startMinutes}
                                              onChange={(e) =>
                                                updateMapSupervisorEntrance(
                                                  day,
                                                  m,
                                                  s.userId,
                                                  Number(e.target.value)
                                                )
                                              }
                                            >
                                              {(startOpts.includes(slot.startMinutes)
                                                ? startOpts
                                                : [slot.startMinutes, ...startOpts]
                                              ).map((t) => (
                                                <option key={t} value={t}>
                                                  {minutesToTime(t)}
                                                </option>
                                              ))}
                                            </select>
                                            <span className="text-muted tabular-nums">
                                              → until {untilH} (avail)
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    <select
                                      className={`w-full text-[11px] border rounded-md px-1.5 py-1 bg-white ${
                                        isUnfilled
                                          ? "border-amber-400 text-amber-900"
                                          : "border-border"
                                      }`}
                                      value=""
                                      onChange={(e) => {
                                        addMapSupervisor(day, m, e.target.value);
                                        e.target.value = "";
                                      }}
                                    >
                                      <option value="">
                                        {selectedSlots.length === 0
                                          ? "— add supervisor —"
                                          : "+ handoff / another —"}
                                      </option>
                                      {options.map((s) => {
                                        const entrance =
                                          selectedSlots.length > 0
                                            ? Math.max(
                                                ...selectedSlots.map((x) => x.endMinutes)
                                              )
                                            : clock;
                                        const win = proposeWorkWindow(s, day, entrance);
                                        const role = s.isShiftLeader ? "SL" : "Sup";
                                        const rating =
                                          s.supervisorRating != null
                                            ? ` · r${s.supervisorRating}`
                                            : "";
                                        const proposed = win
                                          ? `in ${minutesToTime(win.startMinutes)} → ${formatSlotEnd(win.endMinutes)}`
                                          : "";
                                        return (
                                          <option key={s.userId} value={s.userId}>
                                            {`${role}${rating} · ${s.name}${proposed ? ` · ${proposed}` : ""}`}
                                          </option>
                                        );
                                      })}
                                    </select>
                                    {isUnfilled && askOptions.length > 0 && (
                                      <select
                                        className="w-full text-[11px] border border-amber-300 rounded-md px-1.5 py-1 bg-amber-50 text-amber-950"
                                        value=""
                                        onChange={(e) => {
                                          addMapSupervisor(day, m, e.target.value, {
                                            askOverride: true,
                                          });
                                          e.target.value = "";
                                        }}
                                      >
                                        <option value="">— ask for help (not offered) —</option>
                                        {askOptions.map((s) => {
                                          const role = s.isShiftLeader ? "SL" : "Sup";
                                          const rating =
                                            s.supervisorRating != null
                                              ? ` · r${s.supervisorRating}`
                                              : "";
                                          const hours =
                                            s.days.find((d) => d.dayOfWeek === day)?.hoursLabel ??
                                            "no hours";
                                          return (
                                            <option key={s.userId} value={s.userId}>
                                              {`${role}${rating} · ${s.name} · ${hours}`}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    )}
                                  </div>
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
