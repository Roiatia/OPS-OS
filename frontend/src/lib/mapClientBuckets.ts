import type { ShiftPlanMap } from "../types/availability";
import { MAPS_PER_PERSON, isRequiredMapTask } from "./staffingRatio";
import type { MapSupervisorSlot } from "./mapSupervisorSlots";

/** One MAP group: same client + start time (shift-level unit for availability). */
export type MapClientStartBucket = {
  key: string;
  client: string;
  startMinutes: number | null;
  maps: ShiftPlanMap[];
  count: number;
  /** Stable representative for reads/writes before mirroring. */
  canonical: ShiftPlanMap;
};

export type DayTableRow =
  | { kind: "bucket"; bucket: MapClientStartBucket }
  | { kind: "event"; map: ShiftPlanMap };

export function clientStartBucketKey(
  client: string,
  startMinutes: number | null | undefined
): string {
  return `${client || "—"}\0${startMinutes ?? -1}`;
}

/** Supervisors needed for a client×time load (~2 maps per person). */
export function seatsForMapBucket(mapCount: number): number {
  if (mapCount <= 0) return 0;
  return Math.max(1, Math.ceil(mapCount / MAPS_PER_PERSON));
}

function sortMapsStable(maps: ShiftPlanMap[]): ShiftPlanMap[] {
  return [...maps].sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      a.mapNumber.localeCompare(b.mapNumber)
  );
}

/** Group MAP tasks by client + start. Non-MAP tasks are ignored. */
export function groupMapsByClientStart(maps: ShiftPlanMap[]): MapClientStartBucket[] {
  const groups = new Map<string, ShiftPlanMap[]>();
  for (const m of maps) {
    if ((m.taskKind ?? "MAP") !== "MAP") continue;
    const key = clientStartBucketKey(m.client || "—", m.startMinutes);
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const mapsSorted = sortMapsStable(members);
      const first = mapsSorted[0]!;
      return {
        key,
        client: first.client || "—",
        startMinutes: first.startMinutes ?? null,
        maps: mapsSorted,
        count: mapsSorted.length,
        canonical: first,
      };
    })
    .sort(
      (a, b) =>
        (a.startMinutes ?? 99999) - (b.startMinutes ?? 99999) ||
        a.client.localeCompare(b.client)
    );
}

/**
 * Day table rows: one row per MAP client×start bucket; meetings / HH / refresh stay 1:1.
 */
export function buildDayTableRows(maps: ShiftPlanMap[]): DayTableRow[] {
  const buckets = groupMapsByClientStart(maps);
  const used = new Set(buckets.flatMap((b) => b.maps.map((m) => m.id)));
  const events = maps.filter((m) => !used.has(m.id));
  const rows: DayTableRow[] = [
    ...buckets.map((bucket) => ({ kind: "bucket" as const, bucket })),
    ...events.map((map) => ({ kind: "event" as const, map })),
  ];
  return rows;
}

/** All map ids that share this map's client + start (MAP only). */
export function siblingMapIdsInBucket(
  maps: ShiftPlanMap[],
  map: ShiftPlanMap
): string[] {
  if ((map.taskKind ?? "MAP") !== "MAP") return [map.id];
  const key = clientStartBucketKey(map.client || "—", map.startMinutes);
  return maps
    .filter(
      (m) =>
        (m.taskKind ?? "MAP") === "MAP" &&
        clientStartBucketKey(m.client || "—", m.startMinutes) === key
    )
    .map((m) => m.id);
}

/**
 * After per-map seeding: one shared seat list per client×start,
 * trimmed to ~2 maps/person, copied onto every map in the bucket.
 */
export function consolidateBucketAssignees(
  mapsPerDay: { dayOfWeek: number; maps: ShiftPlanMap[] }[],
  assignees: Record<string, MapSupervisorSlot[]>
): Record<string, MapSupervisorSlot[]> {
  const next = { ...assignees };
  for (const dayEntry of mapsPerDay) {
    for (const bucket of groupMapsByClientStart(dayEntry.maps)) {
      const seats = seatsForMapBucket(bucket.count);
      const merged: MapSupervisorSlot[] = [];
      const seen = new Set<string>();
      // Prefer canonical map's order, then other members
      const order = [bucket.canonical, ...bucket.maps.filter((m) => m.id !== bucket.canonical.id)];
      for (const m of order) {
        for (const slot of next[m.id] ?? []) {
          if (!slot.userId || seen.has(slot.userId)) continue;
          seen.add(slot.userId);
          merged.push(slot);
          if (merged.length >= seats) break;
        }
        if (merged.length >= seats) break;
      }
      for (const m of bucket.maps) {
        if (merged.length === 0) delete next[m.id];
        else next[m.id] = merged.map((s) => ({ ...s }));
      }
    }
  }
  return next;
}

/** Unfilled only when a required MAP bucket (or non-MAP required task) has no seats. */
export function unfilledFromBucketView(
  mapsPerDay: { dayOfWeek: number; maps: ShiftPlanMap[] }[],
  assignees: Record<string, MapSupervisorSlot[]>,
  minutesToTime: (m: number) => string
): {
  dayOfWeek: number;
  mapId: string;
  mapNumber: string;
  startLabel: string;
  reason: string;
}[] {
  const out: {
    dayOfWeek: number;
    mapId: string;
    mapNumber: string;
    startLabel: string;
    reason: string;
  }[] = [];
  for (const dayEntry of mapsPerDay) {
    for (const bucket of groupMapsByClientStart(dayEntry.maps)) {
      const seats = assignees[bucket.canonical.id] ?? [];
      if (seats.length > 0) continue;
      const startLabel =
        bucket.startMinutes != null ? minutesToTime(bucket.startMinutes) : "?";
      out.push({
        dayOfWeek: dayEntry.dayOfWeek,
        mapId: bucket.canonical.id,
        mapNumber: `${bucket.client} ×${bucket.count}`,
        startLabel,
        reason: `No supervisor for ${bucket.client} at ${startLabel} (${bucket.count} map${bucket.count === 1 ? "" : "s"})`,
      });
    }
    for (const m of dayEntry.maps) {
      if ((m.taskKind ?? "MAP") === "MAP") continue;
      if (!isRequiredMapTask(m.taskKind)) continue;
      if ((assignees[m.id] ?? []).length > 0) continue;
      const startLabel = m.startMinutes != null ? minutesToTime(m.startMinutes) : "?";
      out.push({
        dayOfWeek: dayEntry.dayOfWeek,
        mapId: m.id,
        mapNumber: m.mapNumber,
        startLabel,
        reason: `No supervisor available for this map at ${startLabel}`,
      });
    }
  }
  return out;
}
