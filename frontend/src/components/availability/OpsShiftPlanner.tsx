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
  effectiveSupervisorRating,
  formatAvailabilityWindow,
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
  coversMapHour,
  formatSlotEnd,
  formatSlotStart,
  proposeWorkWindow,
  seedMapAssignees,
} from "../../lib/mapSupervisorSlots";
import { autoPlanAvailability } from "../../lib/autoPlanAvailability";
import {
  buildDemoWeekTasks,
  localMapFromFakeDetails,
  parseTimeToMinutes,
  type LocalPlannerMap,
} from "../../lib/fakeLocalMap";
import { isRequiredMapTask } from "../../lib/staffingRatio";
import {
  buildDayTableRows,
  siblingMapIdsInBucket,
  unfilledFromBucketView,
  type DayTableRow,
} from "../../lib/mapClientBuckets";
import {
  clearShiftPlanDraft,
  draftHasWork,
  readShiftPlanDraft,
  writeShiftPlanDraft,
} from "../../lib/shiftPlanDraft";
import { formatMapTime } from "../../lib/hubDisplay";
import { Modal } from "../common/Modal";

function ratingLabel(s: { supervisorRating?: number | null; isShiftLeader: boolean }): string {
  return `r${effectiveSupervisorRating(s.supervisorRating, s.isShiftLeader)}`;
}

/** Hours they submitted for a given day (what they filled on the form). */
function staffDayFillLabel(s: ShiftPlanStaff, dayOfWeek: number): string {
  const d = s.days.find((x) => x.dayOfWeek === dayOfWeek);
  if (!d) return "—";
  if (d.hoursLabel?.trim()) return d.hoursLabel.trim();
  return formatAvailabilityWindow(d);
}

/** Calendar day this slot works on (morning relief on a night map → next day). */
function slotAvailDayOfWeek(mapDayOfWeek: number, slotStartMinutes: number): number {
  if (slotStartMinutes >= 24 * 60) return Math.min(5, mapDayOfWeek + 1);
  return mapDayOfWeek;
}

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

type TaskSortBy = "type" | "client" | "start" | "maps" | "supervisor";
type TaskSortDir = "asc" | "desc";
type DayTaskSort = { by: TaskSortBy; dir: TaskSortDir };

function rowClient(row: DayTableRow): string {
  return row.kind === "bucket" ? row.bucket.client : row.map.client || "—";
}

function rowStart(row: DayTableRow): number {
  if (row.kind === "bucket") return row.bucket.startMinutes ?? 99999;
  return row.map.startMinutes ?? 99999;
}

function rowTypeLabel(row: DayTableRow): string {
  return row.kind === "bucket" ? "Map" : taskKindLabel(row.map.taskKind);
}

function rowMapCount(row: DayTableRow): number {
  return row.kind === "bucket" ? row.bucket.count : 0;
}

function rowCanonicalMap(row: DayTableRow): ShiftPlanMap {
  return row.kind === "bucket" ? row.bucket.canonical : row.map;
}

function sortDayTableRows(
  rows: DayTableRow[],
  sort: DayTaskSort,
  mapAssignees: Record<string, MapSupervisorSlot[]>,
  staff: ShiftPlanStaff[]
): DayTableRow[] {
  const staffName = (userId: string) =>
    staff.find((s) => s.userId === userId)?.name ?? "";

  const supervisorKey = (m: ShiftPlanMap) => {
    const slots = mapAssignees[m.id] ?? [];
    if (slots.length === 0) return "\uffff";
    return slots
      .map((s) => staffName(s.userId))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
  };

  const dirMul = sort.dir === "desc" ? -1 : 1;

  return rows.slice().sort((a, b) => {
    let cmp = 0;
    switch (sort.by) {
      case "type":
        cmp = rowTypeLabel(a).localeCompare(rowTypeLabel(b));
        break;
      case "client":
        cmp = rowClient(a).localeCompare(rowClient(b));
        break;
      case "start":
        cmp = rowStart(a) - rowStart(b);
        break;
      case "maps":
        cmp = rowMapCount(a) - rowMapCount(b);
        break;
      case "supervisor":
        cmp = supervisorKey(rowCanonicalMap(a)).localeCompare(
          supervisorKey(rowCanonicalMap(b))
        );
        break;
    }
    if (cmp !== 0) return cmp * dirMul;
    const sa = rowStart(a) - rowStart(b);
    if (sa !== 0) return sa;
    return rowClient(a).localeCompare(rowClient(b));
  });
}

export function OpsShiftPlanner() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<ShiftPlanView | null>(null);
  const weekIsoInit = isoWeekStart(defaultSubmissionWeekStart());
  const draftInit = readShiftPlanDraft(weekIsoInit);
  const [assignments, setAssignments] = useState<ShiftPlanAssignment[]>(
    () => draftInit?.assignments ?? []
  );
  /** Per-map supervisor slots (1+; hours must sit inside their availability, 6–12h) */
  const [mapAssignees, setMapAssignees] = useState<Record<string, MapSupervisorSlot[]>>(
    () => draftInit?.mapAssignees ?? {}
  );
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
  const [draftRestored, setDraftRestored] = useState(() => draftHasWork(draftInit));
  /** Frontend-only fake maps for testing (no CRM sync) — keep draft or demo */
  const [localMaps, setLocalMaps] = useState<LocalPlannerMap[]>(() =>
    draftInit?.localMaps?.length ? draftInit.localMaps : buildDemoWeekTasks()
  );
  const [fakeMapDay, setFakeMapDay] = useState<(typeof AVAILABILITY_DAYS)[number]>(0);
  const [fakeMapNumber, setFakeMapNumber] = useState("");
  const [fakeClient, setFakeClient] = useState("");
  const [fakeMapper, setFakeMapper] = useState("");
  const [fakeStart, setFakeStart] = useState("09:00");
  const [fakeEnd, setFakeEnd] = useState("");
  const [fakeTaskKind, setFakeTaskKind] = useState<ScheduleTaskKind>("MAP");
  const [fakeMapHint, setFakeMapHint] = useState(
    draftHasWork(draftInit)
      ? "Restored your unsaved draft for this week."
      : "Demo week loaded (local only) — maps, meetings & mapping refresh. Not saved to DB."
  );
  /** Per-day column sort (default: start ascending). Tap header to sort; tap again to flip. */
  const [daySortBy, setDaySortBy] = useState<Partial<Record<number, DayTaskSort>>>({});

  const applyPlan = useCallback(
    (
      plan: ShiftPlanView,
      nextAssignments: ShiftPlanAssignment[],
      _warnings?: string[],
      opts?: {
        fromAutoPlan?: boolean;
        plannedDays?: number[];
        /** Maps to seed (server + local). Never write local maps into plan.mapsPerDay. */
        seedMapsPerDay?: ShiftPlanView["mapsPerDay"];
      }
    ) => {
      // Keep CRM/server maps only in state — local fakes live in `localMaps`
      const serverMapsPerDay = (plan.mapsPerDay ?? []).map((d) => ({
        ...d,
        maps: d.maps.filter((m) => !m.id.startsWith("local-")),
        count: d.maps.filter((m) => !m.id.startsWith("local-")).length,
      }));
      setData({ ...plan, mapsPerDay: serverMapsPerDay });

      const mapsForSeed = opts?.seedMapsPerDay ?? serverMapsPerDay;
      const seeded = seedMapAssignees(mapsForSeed, nextAssignments, plan.staff);
      const planned = opts?.plannedDays?.length ? new Set(opts.plannedDays) : null;

      // Auto-plan day roster is the source of truth for assigned-day ratios.
      // Do not inflate counts by merging map-spill people who weren't on that day's plan.
      if (opts?.fromAutoPlan) {
        setAssignments(nextAssignments);
      } else {
        const mergedAssignments = [...nextAssignments];
        const staffById = new Map(plan.staff.map((s) => [s.userId, s]));
        for (const dayEntry of mapsForSeed) {
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
              const assignDay =
                slot.startMinutes >= 24 * 60 ? dayEntry.dayOfWeek + 1 : dayEntry.dayOfWeek;
              if (assignDay > 5) continue;
              if (
                mergedAssignments.some(
                  (a) => a.dayOfWeek === assignDay && a.userId === person.userId
                )
              ) {
                have.add(slot.userId);
                continue;
              }
              // Never count a day they did not offer
              if (!person.days.some((d) => d.dayOfWeek === assignDay && d.canWork)) continue;
              mergedAssignments.push({
                dayOfWeek: assignDay,
                userId: person.userId,
                userName: person.name,
                isShiftLeader: person.isShiftLeader,
              });
              have.add(slot.userId);
            }
          }
        }
        setAssignments(mergedAssignments);
      }

      if (!planned) {
        setMapAssignees(seeded.assignees);
        setUnfilledMaps(seeded.unfilled);
      } else {
        setMapAssignees((prev) => {
          const next = { ...prev };
          for (const dayEntry of mapsForSeed) {
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
      const weekIso = isoWeekStart(weekStart);
      const plan = await api.getShiftPlan(weekIso);
      const draft = readShiftPlanDraft(weekIso);

      // Always take staff + CRM maps from server; keep OPS in-progress work from draft
      const serverMapsPerDay = (plan.mapsPerDay ?? []).map((d) => ({
        ...d,
        maps: d.maps.filter((m) => !m.id.startsWith("local-")),
        count: d.maps.filter((m) => !m.id.startsWith("local-")).length,
      }));
      setData({ ...plan, mapsPerDay: serverMapsPerDay });

      if (draftHasWork(draft)) {
        setAssignments(draft!.assignments);
        setMapAssignees(draft!.mapAssignees);
        setLocalMaps(draft!.localMaps);
        setDraftRestored(true);
        setFakeMapHint("Restored your unsaved draft for this week (safe across refresh).");
        setSuccess("Restored your unsaved draft for this week.");
        // Recompute unfilled from restored map seats
        const mapsForCheck = AVAILABILITY_DAYS.map((dayOfWeek) => {
          const fromServer = serverMapsPerDay.find((d) => d.dayOfWeek === dayOfWeek);
          const serverMaps = fromServer?.maps ?? [];
          const extras = (draft!.localMaps ?? []).filter((m) => m.dayOfWeek === dayOfWeek);
          const maps = [...serverMaps, ...extras];
          return { dayOfWeek, count: maps.length, maps };
        });
        const seeded = seedMapAssignees(mapsForCheck, draft!.assignments, plan.staff);
        // Prefer restored seats; only use seed to discover still-empty maps
        const restored = draft!.mapAssignees;
        const unfilled = seeded.unfilled.filter((u) => (restored[u.mapId]?.length ?? 0) === 0);
        setUnfilledMaps(unfilled);
        setShowAskCoverageAlert(unfilled.length > 0);
      } else {
        setDraftRestored(false);
        applyPlan(plan, plan.assignments, plan.warnings);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [weekStart, applyPlan]);

  useEffect(() => {
    void load();
  }, [load]);

  // Autosave draft in this browser so refresh does not wipe OPS work
  useEffect(() => {
    if (loading) return;
    const weekIso = isoWeekStart(weekStart);
    const timer = window.setTimeout(() => {
      writeShiftPlanDraft({
        weekStart: weekIso,
        assignments,
        mapAssignees,
        localMaps,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loading, weekStart, assignments, mapAssignees, localMaps]);

  function changeWeek(delta: number) {
    // Flush current week draft before switching
    writeShiftPlanDraft({
      weekStart: isoWeekStart(weekStart),
      assignments,
      mapAssignees,
      localMaps,
    });
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(weekStartSunday(d));
    setLocalMaps([]);
    setFakeMapHint("");
    setSuccess("");
  }

  /** Server maps + frontend-only fake maps for testing (deduped by id). */
  const effectiveMapsPerDay = useMemo(() => {
    const base = data?.mapsPerDay ?? [];
    return AVAILABILITY_DAYS.map((dayOfWeek) => {
      const fromServer = base.find((d) => d.dayOfWeek === dayOfWeek);
      const serverMaps = (fromServer?.maps ?? []).filter((m) => !m.id.startsWith("local-"));
      const seen = new Set(serverMaps.map((m) => m.id));
      const extras = localMaps.filter((m) => {
        if (m.dayOfWeek !== dayOfWeek) return false;
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      const maps = [...serverMaps, ...extras];
      return { dayOfWeek, count: maps.length, maps };
    });
  }, [data?.mapsPerDay, localMaps]);

  const mapsByDay = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of effectiveMapsPerDay) {
      map.set(entry.dayOfWeek, entry.count);
    }
    return map;
  }, [effectiveMapsPerDay]);

  /**
   * SL missing alert only when every required map that day is filled but there is no SL.
   * Meetings may stay empty and do not block / trigger this.
   */
  const missingSlDays = useMemo(() => {
    const daysWithMaps = effectiveMapsPerDay.filter((d) =>
      d.maps.some((m) => isRequiredMapTask(m.taskKind))
    );
    if (daysWithMaps.length === 0) return [] as number[];

    const isDayMapsFilled = (dayOfWeek: number) => {
      const maps = (
        effectiveMapsPerDay.find((d) => d.dayOfWeek === dayOfWeek)?.maps ?? []
      ).filter((m) => isRequiredMapTask(m.taskKind));
      if (maps.length === 0) return false;
      return maps.every((m) => (mapAssignees[m.id]?.length ?? 0) > 0);
    };
    const dayHasSl = (dayOfWeek: number) =>
      assignments.some((a) => a.dayOfWeek === dayOfWeek && a.isShiftLeader);

    return daysWithMaps
      .filter((d) => isDayMapsFilled(d.dayOfWeek) && !dayHasSl(d.dayOfWeek))
      .map((d) => d.dayOfWeek);
  }, [effectiveMapsPerDay, mapAssignees, assignments]);

  const assignedCountByUser = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Set<string>();
    for (const a of assignments) {
      const key = `${a.userId}:${a.dayOfWeek}`;
      if (seen.has(key)) continue;
      seen.add(key);
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

  /** People who offered hours that fit this task at (or covering) map start. */
  function supervisorOptionsForMap(
    dayOfWeek: number,
    clock: number | null,
    client: string,
    taskKind: ScheduleTaskKind | undefined,
    alreadySelected: string[] = []
  ): ShiftPlanStaff[] {
    // Meetings / refresh / happy hour are short events — only need to cover the start hour
    const shortEvent =
      taskKind === "COMPANY_MEETING" ||
      taskKind === "MAPPING_REFRESH" ||
      taskKind === "HAPPY_HOUR";

    return (data?.staff ?? [])
      .filter((s) => !alreadySelected.includes(s.userId))
      .filter((s) => canSuperviseClient(s, client, taskKind, { relaxClient: true }))
      .filter((s) => {
        if (clock == null) {
          return (
            proposeWorkWindow(s, dayOfWeek, null, { allowShort: shortEvent }) != null
          );
        }
        if (!coversMapHour(s, dayOfWeek, clock)) return false;
        // Real maps: full ≥6h window. Events: anyone free at that hour.
        if (shortEvent) {
          return (
            proposeWorkWindow(s, dayOfWeek, clock, { allowShort: true }) != null
          );
        }
        return proposeWorkWindow(s, dayOfWeek, clock) != null;
      })
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
        if (a.isShiftLeader !== b.isShiftLeader) return a.isShiftLeader ? -1 : 1;
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
    const maps = effectiveMapsPerDay.find((d) => d.dayOfWeek === dayOfWeek)?.maps ?? [];
    const next = { ...mapAssignees };
    const unique: MapSupervisorSlot[] = [];
    const seen = new Set<string>();
    for (const slot of slots) {
      if (!slot.userId || seen.has(slot.userId)) continue;
      seen.add(slot.userId);
      unique.push(slot);
    }
    // MAP rows are client×start buckets — keep sibling maps in sync
    const targetIds = siblingMapIdsInBucket(maps, map);
    for (const id of targetIds) {
      if (unique.length === 0) delete next[id];
      else next[id] = unique.map((s) => ({ ...s }));
    }
    setMapAssignees(next);
    syncDayAssignments(dayOfWeek, next, maps);
    setUnfilledMaps((prev) => {
      const drop = new Set(targetIds);
      const rest = prev.filter((u) => !drop.has(u.mapId));
      if (unique.length > 0) {
        if (rest.length === 0) setShowAskCoverageAlert(false);
        return rest;
      }
      const clock = map.startMinutes ?? null;
      const startLabel = clock != null ? minutesToTime(clock) : "?";
      const canonicalId = targetIds.slice().sort()[0] ?? map.id;
      return [
        ...rest,
        {
          dayOfWeek,
          mapId: canonicalId,
          mapNumber:
            (map.taskKind ?? "MAP") === "MAP" && targetIds.length > 1
              ? `${map.client || "—"} ×${targetIds.length}`
              : map.mapNumber,
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

    const shortEvent =
      map.taskKind === "COMPANY_MEETING" ||
      map.taskKind === "MAPPING_REFRESH" ||
      map.taskKind === "HAPPY_HOUR";

    // First seat must cover map start; extra seats may overlap or start later
    const entrance = map.startMinutes ?? null;
    if (
      current.length === 0 &&
      map.startMinutes != null &&
      !opts?.askOverride &&
      !coversMapHour(person, dayOfWeek, map.startMinutes)
    ) {
      setError(
        `${person.name} is not available at map start (${minutesToTime(map.startMinutes)}).`
      );
      return;
    }
    let win = proposeWorkWindow(person, dayOfWeek, entrance, {
      allowShort: shortEvent || opts?.askOverride,
    });
    if (!win && current.length > 0) {
      // Extra supervisor: try their own earliest start that day
      win = proposeWorkWindow(person, dayOfWeek, null, { allowShort: true });
    }
    if (!win && opts?.askOverride) {
      win = proposeWorkWindow(person, dayOfWeek, entrance, { allowShort: true });
    }
    // Short event: if they cover the hour, clip to event end (or avail end)
    if (!win && shortEvent && entrance != null && coversMapHour(person, dayOfWeek, entrance)) {
      const eventEnd =
        map.endMinutes != null && map.endMinutes > entrance
          ? map.endMinutes
          : entrance + 60;
      win = {
        startMinutes: entrance,
        endMinutes: eventEnd,
        duration: eventEnd - entrance,
      };
    }
    if (!win && opts?.askOverride && entrance != null) {
      win = {
        startMinutes: entrance,
        endMinutes: entrance + 6 * 60,
        duration: 6 * 60,
      };
    }
    if (!win) return;
    if (
      current.length === 0 &&
      map.startMinutes != null &&
      win.startMinutes > map.startMinutes &&
      !opts?.askOverride
    ) {
      setError(
        `Cannot start after the map (${minutesToTime(map.startMinutes)}). Pick someone available then.`
      );
      return;
    }
    setMapSupervisorSlots(dayOfWeek, map, [
      ...current,
      {
        userId,
        startMinutes: win.startMinutes,
        endMinutes: win.endMinutes,
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

  /** Clear assignments so OPS can fix mistakes / assign by hand. */
  function clearPlan(dayOfWeek?: number) {
    if (!data) return;
    setError("");
    setShowAskCoverageAlert(false);
    if (dayOfWeek == null) {
      setAssignments([]);
      setMapAssignees({});
      clearShiftPlanDraft(isoWeekStart(weekStart));
      setDraftRestored(false);
      setUnfilledMaps(unfilledFromBucketView(effectiveMapsPerDay, {}, minutesToTime));
      setSuccess("Cleared week — add supervisors per client · start.");
      return;
    }
    const dayMaps =
      effectiveMapsPerDay.find((d) => d.dayOfWeek === dayOfWeek)?.maps ?? [];
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
        ...unfilledFromBucketView(
          [{ dayOfWeek, maps: dayMaps }],
          {},
          minutesToTime
        ),
      ];
    });
    const label =
      DAY_LABELS[
        AVAILABILITY_DAYS.indexOf(dayOfWeek as (typeof AVAILABILITY_DAYS)[number])
      ];
    setSuccess(`${label} cleared — add supervisors per client · start.`);
  }

  function addFakeMap() {
    const mapNumber = fakeMapNumber.trim();
    if (!mapNumber) {
      setFakeMapHint("Enter a map / task number (fake is fine).");
      return;
    }
    const startMinutes = parseTimeToMinutes(fakeStart);
    if (fakeStart.trim() && startMinutes == null) {
      setFakeMapHint("Start time must look like 09:00.");
      return;
    }
    const endMinutes = parseTimeToMinutes(fakeEnd);
    if (fakeEnd.trim() && endMinutes == null) {
      setFakeMapHint("End time must look like 17:00 (or leave blank).");
      return;
    }
    const entry = localMapFromFakeDetails({
      dayOfWeek: fakeMapDay,
      mapNumber,
      client: fakeClient,
      mapperName: fakeMapper,
      startMinutes,
      endMinutes,
      taskKind: fakeTaskKind,
    });
    setLocalMaps((prev) => [...prev, entry]);
    setFakeMapNumber("");
    setFakeClient("");
    setFakeMapper("");
    setFakeStart("09:00");
    setFakeEnd("");
    setFakeTaskKind("MAP");
    const dayLabel =
      DAY_LABELS[
        AVAILABILITY_DAYS.indexOf(fakeMapDay as (typeof AVAILABILITY_DAYS)[number])
      ];
    setFakeMapHint(
      `Added ${taskKindLabel(entry.taskKind)} ${entry.mapNumber} on ${dayLabel} (local only — not in DB).`
    );
  }

  function loadDemoWeek() {
    setLocalMaps(buildDemoWeekTasks());
    setAssignments([]);
    setMapAssignees({});
    setUnfilledMaps([]);
    setFakeMapHint(
      "Demo reloaded: maps split ~half at 08:00 / half at 10:00. Local only — not in DB."
    );
    setSuccess("Demo tasks loaded — try Auto-plan week.");
  }

  function clearDemoMaps() {
    setLocalMaps([]);
    setFakeMapHint("Cleared all local fake tasks.");
  }

  function removeLocalMap(mapId: string) {
    setLocalMaps((prev) => prev.filter((m) => m.id !== mapId));
    setMapAssignees((prev) => {
      const next = { ...prev };
      delete next[mapId];
      return next;
    });
    setUnfilledMaps((prev) => prev.filter((u) => u.mapId !== mapId));
  }

  async function handleAuto(dayOfWeek?: number, replan = false) {
    if (!data) return;
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
          avoidUserIds = prevDayPeople;
        } else {
          setDayVariants((prev) => ({ ...prev, [dayOfWeek]: 0 }));
        }
      } else if (replan) {
        variant = weekVariant + 1;
        setWeekVariant(variant);
        avoidUserIds = [...new Set(assignments.map((a) => a.userId))];
      } else {
        setWeekVariant(0);
      }

      const lockedAssignments =
        dayOfWeek != null
          ? assignments.filter((a) => a.dayOfWeek !== dayOfWeek)
          : undefined;

      const result = autoPlanAvailability({
        staff: data.staff,
        mapsPerDay: effectiveMapsPerDay,
        dayOfWeek,
        lockedAssignments,
        variant,
        avoidUserIds,
      });

      applyPlan(
        {
          ...data,
          dayPlans: result.dayPlans,
          warnings: result.warnings,
        },
        result.assignments,
        result.warnings,
        {
          fromAutoPlan: true,
          plannedDays: dayOfWeek != null ? [dayOfWeek] : undefined,
          seedMapsPerDay: effectiveMapsPerDay,
        }
      );

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
            ? `${label} re-planned — kept ${lockedDays} other day(s) (fairness).`
            : `${label} planned — kept ${lockedDays} other day(s).`
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
      setSuccess("Plan published — draft kept in this browser so refresh won’t wipe map seats.");
      writeShiftPlanDraft({
        weekStart: isoWeekStart(weekStart),
        assignments,
        mapAssignees,
        localMaps,
      });
      setDraftRestored(true);
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
              {data?.published
                ? "Published"
                : draftRestored || assignments.length > 0
                  ? "Draft autosaved in this browser — safe to refresh"
                  : "Draft until you save & publish"}
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
            onClick={() => clearPlan()}
            disabled={autoRunning || loading || !data}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 text-slate-800 bg-white hover:bg-slate-50 disabled:opacity-50"
            title="Clear assignments after a mistake so you can re-assign"
          >
            Clear
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
      {missingSlDays.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-rose-950">
            Shift leader missing
          </p>
          <p className="text-xs text-rose-950/90">
            Every shift needs an SL. These day(s) are fully filled but have no shift leader:{" "}
            {missingSlDays
              .map(
                (d) =>
                  DAY_LABELS[
                    AVAILABILITY_DAYS.indexOf(d as (typeof AVAILABILITY_DAYS)[number])
                  ]
              )
              .join(", ")}
            . Assign an SL or ask one to cover.
          </p>
        </div>
      )}
      {(showAskCoverageAlert && unfilledMaps.length > 0) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-950">
            {unfilledMaps.length} coverage gap{unfilledMaps.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-amber-950/90">
            Every map needs at least one supervisor. Yellow rows have none assigned. Use “add
            supervisor” / “ask for help”, or re-run Auto-plan.
          </p>
          <ul className="text-[11px] text-amber-950/90 max-h-28 overflow-y-auto space-y-0.5">
            {unfilledMaps.slice(0, 12).map((u) => (
              <li key={`${u.mapId}-${u.startLabel}`}>
                {DAY_LABELS[
                  AVAILABILITY_DAYS.indexOf(u.dayOfWeek as (typeof AVAILABILITY_DAYS)[number])
                ] ?? "Day"}{" "}
                · {u.startLabel}: {u.reason}
              </li>
            ))}
            {unfilledMaps.length > 12 && (
              <li>…and {unfilledMaps.length - 12} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">Fake tasks (test only)</p>
            <p className="text-[11px] text-muted mt-0.5">
              Local only — nothing writes to the DB. Demo week is preloaded with maps, company
              meetings, happy hour, and mapping refresh.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => loadDemoWeek()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100"
            >
              Reload demo week
            </button>
            <button
              type="button"
              onClick={() => clearDemoMaps()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
            >
              Clear fake tasks
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Day</label>
            <select
              className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-white"
              value={fakeMapDay}
              onChange={(e) =>
                setFakeMapDay(Number(e.target.value) as (typeof AVAILABILITY_DAYS)[number])
              }
            >
              {AVAILABILITY_DAYS.map((d, i) => (
                <option key={d} value={d}>
                  {DAY_LABELS[i]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Type</label>
            <select
              className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-white"
              value={fakeTaskKind}
              onChange={(e) => setFakeTaskKind(e.target.value as ScheduleTaskKind)}
            >
              <option value="MAP">Map</option>
              <option value="COMPANY_MEETING">Company meeting</option>
              <option value="MAPPING_REFRESH">Mapping refresh</option>
              <option value="HAPPY_HOUR">Happy hour</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Number *
            </label>
            <input
              type="text"
              value={fakeMapNumber}
              onChange={(e) => setFakeMapNumber(e.target.value)}
              placeholder="FAKE-01"
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Client</label>
            <input
              type="text"
              value={fakeClient}
              onChange={(e) => setFakeClient(e.target.value)}
              placeholder="Test client"
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Mapper</label>
            <input
              type="text"
              value={fakeMapper}
              onChange={(e) => setFakeMapper(e.target.value)}
              placeholder="Mapper name"
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Start</label>
            <input
              type="time"
              value={fakeStart}
              onChange={(e) => setFakeStart(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              End (optional)
            </label>
            <input
              type="time"
              value={fakeEnd}
              onChange={(e) => setFakeEnd(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-white"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => addFakeMap()}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
          >
            Add fake task
          </button>
          {fakeMapHint && (
            <p className="text-[11px] text-slate-700">{fakeMapHint}</p>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading shift plan…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-4">
            {AVAILABILITY_DAYS.map((day, idx) => {
              const label = DAY_LABELS[idx];
              const mapsCount = mapsByDay.get(day) ?? 0;
              const mapsList =
                effectiveMapsPerDay.find((m) => m.dayOfWeek === day)?.maps ?? [];
              const dayRoster = assignments.filter((a) => a.dayOfWeek === day);
              const slOnShift = dayRoster.filter((a) => a.isShiftLeader).length;
              const supOnShift = dayRoster.filter((a) => !a.isShiftLeader).length;
              const dayRows = buildDayTableRows(mapsList);

              return (
                <div key={day} className="rounded-xl border border-border bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {mapsCount === 0
                          ? "No tasks"
                          : `${mapsCount} task${mapsCount === 1 ? "" : "s"}`}
                        {dayRoster.length > 0 && (
                          <>
                            {" · "}
                            {slOnShift} SL
                            {" · "}
                            {supOnShift} Sup
                          </>
                        )}
                        {mapsCount > 0 && dayRoster.length === 0 && (
                          <> · not planned yet</>
                        )}
                      </p>
                    </div>
                    {mapsCount > 0 && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                          onClick={() => clearPlan(day)}
                          disabled={autoRunning || loading}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-800 bg-white hover:bg-slate-50 disabled:opacity-50"
                          title="Clear this day after a mistake"
                        >
                          Clear
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
                            {(
                              [
                                { key: "type" as const, label: "Type" },
                                { key: "client" as const, label: "Client" },
                                { key: "start" as const, label: "Start" },
                                {
                                  key: "maps" as const,
                                  label: "Maps",
                                  className: "whitespace-nowrap",
                                },
                                {
                                  key: "supervisor" as const,
                                  label: "Supervisors",
                                  className: "min-w-[200px]",
                                },
                              ]
                            ).map((col) => {
                              const active = daySortBy[day] ?? {
                                by: "start" as TaskSortBy,
                                dir: "asc" as TaskSortDir,
                              };
                              const isActive = active.by === col.key;
                              return (
                                <th
                                  key={col.key}
                                  className={`text-left font-semibold px-2 py-1.5 ${col.className ?? ""}`}
                                >
                                  <button
                                    type="button"
                                    className={`inline-flex items-center gap-1 select-none hover:text-slate-900 ${
                                      isActive ? "text-slate-900" : "text-slate-600"
                                    }`}
                                    aria-label={`Sort by ${col.label}`}
                                    title={`Sort by ${col.label}`}
                                    onClick={() =>
                                      setDaySortBy((prev) => {
                                        const cur = prev[day] ?? {
                                          by: "start" as TaskSortBy,
                                          dir: "asc" as TaskSortDir,
                                        };
                                        if (cur.by === col.key) {
                                          return {
                                            ...prev,
                                            [day]: {
                                              by: col.key,
                                              dir: cur.dir === "asc" ? "desc" : "asc",
                                            },
                                          };
                                        }
                                        return {
                                          ...prev,
                                          [day]: { by: col.key, dir: "asc" },
                                        };
                                      })
                                    }
                                  >
                                    <span>{col.label}</span>
                                    <span
                                      className={`inline-flex flex-col leading-[0.65] text-[8px] ${
                                        isActive ? "text-brand-600" : "text-slate-400"
                                      }`}
                                      aria-hidden
                                    >
                                      <span
                                        className={
                                          isActive && active.dir === "asc"
                                            ? "opacity-100"
                                            : "opacity-40"
                                        }
                                      >
                                        ▲
                                      </span>
                                      <span
                                        className={
                                          isActive && active.dir === "desc"
                                            ? "opacity-100"
                                            : "opacity-40"
                                        }
                                      >
                                        ▼
                                      </span>
                                    </span>
                                  </button>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {sortDayTableRows(
                            dayRows,
                            daySortBy[day] ?? { by: "start", dir: "asc" },
                            mapAssignees,
                            data?.staff ?? []
                          ).map((row) => {
                            const m = rowCanonicalMap(row);
                            const clock = m.startMinutes ?? null;
                            const selectedSlots = mapAssignees[m.id] ?? [];
                            const selectedIds = selectedSlots.map((s) => s.userId);
                            const isMapBucket = row.kind === "bucket";
                            const mapCount = isMapBucket ? row.bucket.count : 0;
                            const isUnfilled =
                              (isMapBucket || isRequiredMapTask(m.taskKind)) &&
                              selectedSlots.length === 0;
                            const isLocal = isMapBucket
                              ? row.bucket.maps.every((lm) =>
                                  localMaps.some((x) => x.id === lm.id)
                                )
                              : localMaps.some((lm) => lm.id === m.id);
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
                            const rowKey = isMapBucket ? `bucket-${row.bucket.key}` : m.id;
                            return (
                              <tr
                                key={rowKey}
                                className={
                                  isUnfilled
                                    ? "border-t border-amber-200 bg-amber-50/80"
                                    : "border-t border-slate-100 bg-white/60"
                                }
                              >
                                <td className="px-2 py-1.5 text-slate-800 align-top whitespace-nowrap">
                                  <span className="font-medium">{rowTypeLabel(row)}</span>
                                  {isLocal && (
                                    <button
                                      type="button"
                                      className="ml-1.5 text-[10px] text-rose-700 hover:underline"
                                      title="Remove local draft"
                                      onClick={() => {
                                        if (isMapBucket) {
                                          for (const bm of row.bucket.maps) removeLocalMap(bm.id);
                                        } else {
                                          removeLocalMap(m.id);
                                        }
                                      }}
                                    >
                                      remove
                                    </button>
                                  )}
                                </td>
                                <td
                                  className="px-2 py-1.5 text-slate-700 align-top max-w-[120px] truncate"
                                  title={rowClient(row)}
                                >
                                  {rowClient(row)}
                                </td>
                                <td className="px-2 py-1.5 tabular-nums text-slate-700 align-top">
                                  {m.fieldDate
                                    ? formatMapTime(m.fieldDate)
                                    : clock != null
                                      ? minutesToTime(clock)
                                      : "—"}
                                </td>
                                <td className="px-2 py-1.5 tabular-nums text-slate-900 align-top font-semibold">
                                  {isMapBucket ? mapCount : "—"}
                                </td>
                                <td className="px-2 py-1.5 align-top">
                                  <div className="space-y-1.5">
                                    {selectedSlots.map((slot, slotIdx) => {
                                      const s = data?.staff.find((x) => x.userId === slot.userId);
                                      if (!s) return null;
                                      const startOpts = allowedStartOptions(
                                        s,
                                        day,
                                        slotIdx === 0 ? clock : null
                                      ).filter(
                                        (t) =>
                                          clock == null ||
                                          slotIdx > 0 ||
                                          t <= clock
                                      );
                                      const untilH = formatSlotEnd(slot.endMinutes);
                                      const availDay = slotAvailDayOfWeek(day, slot.startMinutes);
                                      const dayFill = staffDayFillLabel(s, availDay);
                                      return (
                                        <div
                                          key={slot.userId}
                                          className="rounded-md bg-brand-50 text-brand-900 border border-brand-100 px-1.5 py-1 space-y-1"
                                        >
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="text-[10px] font-medium truncate">
                                              {s.isShiftLeader ? "SL" : "Sup"} · {s.name}
                                            </span>
                                            <button
                                              type="button"
                                              className="text-brand-700/70 hover:text-rose-700 text-[11px] shrink-0"
                                              onClick={() => removeMapSupervisor(day, m, slot.userId)}
                                              title="Remove"
                                            >
                                              ×
                                            </button>
                                          </div>
                                          {dayFill !== "—" && (
                                            <p className="text-[9px] text-brand-800/80 leading-tight">
                                              Filled: {dayFill}
                                            </p>
                                          )}
                                          <div className="flex flex-wrap items-center gap-1 text-[10px]">
                                            <span className="text-muted">In</span>
                                            <select
                                              className="border border-brand-200 rounded px-1 py-0.5 bg-white max-w-[5.5rem]"
                                              value={slot.startMinutes}
                                              onChange={(e) =>
                                                updateMapSupervisorEntrance(
                                                  day,
                                                  m,
                                                  slot.userId,
                                                  Number(e.target.value)
                                                )
                                              }
                                            >
                                              {(startOpts.includes(slot.startMinutes)
                                                ? startOpts
                                                : [slot.startMinutes, ...startOpts]
                                              ).map((t) => (
                                                <option key={t} value={t}>
                                                  {formatSlotStart(t)}
                                                </option>
                                              ))}
                                            </select>
                                            <span className="text-muted">
                                              until {untilH} (shift)
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    <select
                                      className="w-full text-[10px] border border-dashed border-slate-300 rounded-md px-1.5 py-1 bg-white text-slate-600"
                                      value=""
                                      onChange={(e) => {
                                        const uid = e.target.value;
                                        e.target.value = "";
                                        if (uid) addMapSupervisor(day, m, uid);
                                      }}
                                    >
                                      <option value="">— add supervisor —</option>
                                      {options.map((s) => {
                                        const shortEvent =
                                          m.taskKind === "COMPANY_MEETING" ||
                                          m.taskKind === "HAPPY_HOUR" ||
                                          m.taskKind === "MAPPING_REFRESH";
                                        const win = proposeWorkWindow(s, day, clock, {
                                          allowShort: shortEvent,
                                        });
                                        const hint = win
                                          ? `in ${formatSlotStart(win.startMinutes)} → ${formatSlotEnd(win.endMinutes)}`
                                          : "";
                                        return (
                                          <option key={s.userId} value={s.userId}>
                                            {s.isShiftLeader ? "SL" : "Sup"} · {s.name}
                                            {hint ? ` · ${hint}` : ""}
                                          </option>
                                        );
                                      })}
                                    </select>
                                    {askOptions.length > 0 && (
                                      <select
                                        className="w-full text-[10px] border border-dashed border-amber-300 rounded-md px-1.5 py-1 bg-amber-50/80 text-amber-900"
                                        value=""
                                        onChange={(e) => {
                                          const uid = e.target.value;
                                          e.target.value = "";
                                          if (uid)
                                            addMapSupervisor(day, m, uid, { askOverride: true });
                                        }}
                                      >
                                        <option value="">— ask for help (not offered) —</option>
                                        {askOptions.map((s) => (
                                          <option key={s.userId} value={s.userId}>
                                            {s.isShiftLeader ? "SL" : "Sup"} · {s.name}
                                          </option>
                                        ))}
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
                        {s.isShiftLeader ? "SL" : "Sup"} · {ratingLabel(s)}
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
