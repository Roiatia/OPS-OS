import { useCallback, useEffect, useRef } from "react";
import type { MapPhase, MapRecord } from "../types";

/** Phases that leave the active board and belong in History. */
export const ARCHIVED_MAP_PHASES: MapPhase[] = ["APPROVED", "CANCELLED"];

export function isArchivedPhase(phase: MapPhase): boolean {
  return ARCHIVED_MAP_PHASES.includes(phase);
}

/**
 * Apply realtime upserts to an *active* maps list (archived maps excluded).
 *
 * - Existing, still-active map → replaced in place (0 API calls).
 * - Existing map that became archived → removed (and `needReload` so History
 *   can refresh, for pages that show it).
 * - Unknown map (new, or newly in the caller's scope) → not added blindly
 *   (that would bypass server-side visibility); `needReload` triggers a single
 *   scoped refetch instead.
 */
export function applyMapUpsert(
  prev: MapRecord[],
  incoming: MapRecord[]
): { next: MapRecord[]; needReload: boolean } {
  let next = prev;
  let needReload = false;

  for (const map of incoming) {
    const idx = next.findIndex((m) => m.id === map.id);
    if (isArchivedPhase(map.phase)) {
      if (idx >= 0) next = next.filter((m) => m.id !== map.id);
      needReload = true;
    } else if (idx >= 0) {
      next = next.map((m) => (m.id === map.id ? map : m));
    } else {
      needReload = true;
    }
  }

  return { next, needReload };
}

/**
 * Like {@link applyMapUpsert} but never adds unknown maps and never asks for a
 * reload. For role-filtered pages (inspector/QA) where most global upserts are
 * out of scope; newly in-scope maps arrive via the page's backstop poll.
 */
export function applyMapUpsertReplaceOnly(
  prev: MapRecord[],
  incoming: MapRecord[]
): MapRecord[] {
  let next = prev;
  for (const map of incoming) {
    const idx = next.findIndex((m) => m.id === map.id);
    if (idx < 0) continue;
    if (isArchivedPhase(map.phase)) next = next.filter((m) => m.id !== map.id);
    else next = next.map((m) => (m.id === map.id ? map : m));
  }
  return next;
}

export function removeMapsById(prev: MapRecord[], ids: string[]): MapRecord[] {
  if (ids.length === 0) return prev;
  const idSet = new Set(ids);
  const next = prev.filter((m) => !idSet.has(m.id));
  return next.length === prev.length ? prev : next;
}

/**
 * A debounced version of `fn`. Collapses bursts of realtime signals into a
 * single call. Stable identity across renders.
 */
export function useDebouncedCallback(fn: () => void, delay = 400): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    []
  );

  return useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => fnRef.current(), delay);
  }, [delay]);
}
