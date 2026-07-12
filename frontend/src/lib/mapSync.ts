import type { MapRecord } from "../types";

/** Normalize hub/API map fields used by Maps table + Hub */
export function normalizeMapRecord(map: MapRecord): MapRecord {
  return {
    ...map,
    fieldProgressPercent: map.fieldProgressPercent ?? 0,
    onHubStatusBoard: map.onHubStatusBoard ?? false,
  };
}

/** Apply a hub PATCH response into the Maps table list immediately */
export function patchMapInList(maps: MapRecord[], updated: MapRecord): MapRecord[] {
  const next = normalizeMapRecord(updated);
  const idx = maps.findIndex((m) => m.id === next.id);
  if (idx === -1) return [next, ...maps];
  return maps.map((m) => (m.id === next.id ? { ...m, ...next } : m));
}
