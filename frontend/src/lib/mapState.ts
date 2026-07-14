import type { MapRecord } from "../types";

const ARCHIVED = new Set(["APPROVED", "CANCELLED"]);

export function isArchivedMap(map: MapRecord) {
  return ARCHIVED.has(map.phase);
}

/** Merge upserted maps into the active (non-archived) list. */
export function upsertActiveMaps(prev: MapRecord[], incoming: MapRecord[]): MapRecord[] {
  let next = prev;
  for (const map of incoming) {
    if (isArchivedMap(map)) {
      next = next.filter((m) => m.id !== map.id);
      continue;
    }
    const idx = next.findIndex((m) => m.id === map.id);
    if (idx >= 0) {
      if (next === prev) next = [...prev];
      next[idx] = map;
    } else {
      next = [map, ...(next === prev ? prev : next)];
    }
  }
  return next;
}

/** Merge upserted maps into the history (archived) list. */
export function upsertHistoryMaps(prev: MapRecord[], incoming: MapRecord[]): MapRecord[] {
  let next = prev;
  for (const map of incoming) {
    if (!isArchivedMap(map)) {
      next = next.filter((m) => m.id !== map.id);
      continue;
    }
    const idx = next.findIndex((m) => m.id === map.id);
    if (idx >= 0) {
      if (next === prev) next = [...prev];
      next[idx] = map;
    } else {
      next = [map, ...(next === prev ? prev : next)];
    }
  }
  return next;
}

export function removeMapsById(prev: MapRecord[], mapIds: string[]): MapRecord[] {
  if (mapIds.length === 0) return prev;
  const remove = new Set(mapIds);
  return prev.filter((m) => !remove.has(m.id));
}
