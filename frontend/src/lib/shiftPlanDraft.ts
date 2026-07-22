import type { ShiftPlanAssignment } from "../types/availability";
import type { MapSupervisorSlot } from "./mapSupervisorSlots";
import type { LocalPlannerMap } from "./fakeLocalMap";

/** Bump when demo map defaults change so stale localStorage drafts don't win. */
const DRAFT_PREFIX = "ops-os:shift-plan-draft:v3:";

export type ShiftPlanDraft = {
  weekStart: string;
  savedAt: string;
  assignments: ShiftPlanAssignment[];
  mapAssignees: Record<string, MapSupervisorSlot[]>;
  localMaps: LocalPlannerMap[];
};

function storageKey(weekStart: string): string {
  return `${DRAFT_PREFIX}${weekStart}`;
}

export function readShiftPlanDraft(weekStart: string): ShiftPlanDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(weekStart));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShiftPlanDraft;
    if (!parsed || parsed.weekStart !== weekStart) return null;
    if (!Array.isArray(parsed.assignments)) return null;
    return {
      weekStart: parsed.weekStart,
      savedAt: parsed.savedAt ?? new Date().toISOString(),
      assignments: parsed.assignments,
      mapAssignees: parsed.mapAssignees ?? {},
      localMaps: Array.isArray(parsed.localMaps) ? parsed.localMaps : [],
    };
  } catch {
    return null;
  }
}

export function writeShiftPlanDraft(draft: Omit<ShiftPlanDraft, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: ShiftPlanDraft = {
      ...draft,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey(draft.weekStart), JSON.stringify(payload));
  } catch {
    // Quota / private mode — ignore; draft is best-effort
  }
}

export function clearShiftPlanDraft(weekStart: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(weekStart));
  } catch {
    // ignore
  }
}

export function draftHasWork(draft: ShiftPlanDraft | null): boolean {
  if (!draft) return false;
  return (
    draft.assignments.length > 0 ||
    Object.keys(draft.mapAssignees).length > 0 ||
    draft.localMaps.length > 0
  );
}
