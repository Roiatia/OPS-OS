import type { MapRecord, MapStatus } from "../types";
import { getMapDisplayState } from "./mapDisplay";
import { MAP_STATUS_LABELS, MAP_STATUS_VALUES } from "./mapStatus";

const ARCHIVED = new Set(["APPROVED", "CANCELLED"]);

/** New assignment — inspector has not accepted yet */
export function isInspectorInbox(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;

  if (map.phase === "INTAKE") {
    return map.inspectorAssignAccepted !== true;
  }

  if (map.status !== null) return false;
  return ["PREP", "POLISH"].includes(map.phase);
}

/** New QA assignment on intake — QA has not accepted yet */
export function isQaInbox(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.phase !== "INTAKE") return false;
  if (map.assignedQa?.id !== userId) return false;
  return map.qaAssignAccepted !== true;
}

/** Accepted and in progress — shared inspector ↔ QA workspace */
export function isInspectorActive(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;
  if (isInspectorInbox(map, userId)) return false;
  return true;
}

/**
 * Maps this QA owns after accepting (or already past intake), plus anything
 * currently in a review/fix queue. Scoped to assignedQa when userId is set.
 */
export function isQaActive(map: MapRecord, userId?: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (userId && isQaInbox(map, userId)) return false;

  const assignedToMe = !userId || map.assignedQa?.id === userId;

  if (assignedToMe && map.assignedQa) {
    if (map.phase === "INTAKE" && map.releasedToPipeline && map.qaAssignAccepted) {
      return true;
    }
    if (["PREP", "UPLOAD_REVIEW", "FIELD", "POLISH", "QA_REVIEW"].includes(map.phase)) {
      return true;
    }
  }

  if (["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase)) return true;
  if (map.status === "FIX" || map.status === "FIX_DONE") return true;
  return false;
}

export type StatusAction = { kind: "map_status"; status: MapStatus };

export interface StatusOption {
  value: MapStatus;
  label: string;
  action: StatusAction;
}

export const MAP_STATUS_OPTIONS: StatusOption[] = MAP_STATUS_VALUES.map((status) => ({
  value: status,
  label: MAP_STATUS_LABELS[status],
  action: { kind: "map_status", status },
}));

/** Same options for inspector and QA — one shared status everywhere. */
export function getMapStatusOptions(_map: MapRecord): StatusOption[] {
  return MAP_STATUS_OPTIONS;
}

/** @deprecated Use getMapStatusOptions */
export function getInspectorStatusOptions(map: MapRecord): StatusOption[] {
  return getMapStatusOptions(map);
}

/** @deprecated Use getMapStatusOptions */
export function getQaStatusOptions(map: MapRecord): StatusOption[] {
  return getMapStatusOptions(map);
}

export function isFixStatusOption(option: StatusOption): boolean {
  return option.value === "FIX";
}

export function getCurrentStatusValue(map: MapRecord): MapStatus | "" {
  return map.status ?? "";
}

/** @deprecated Use getCurrentStatusValue */
export function getCurrentStatusValueForRole(
  map: MapRecord,
  _role: "inspector" | "qa"
): MapStatus | "" {
  return getCurrentStatusValue(map);
}

export function getRoleStatusLabel(map: MapRecord): string {
  return getMapDisplayState(map);
}

export function statusRowClass(map: MapRecord): string {
  const state = getMapDisplayState(map);
  switch (state) {
    case "Fix":
      return "bg-red-50/80";
    case "Approved":
      return "bg-emerald-50/80";
    case "Done":
      return "bg-sky-50/80";
    case "Accepted":
      return "bg-amber-50/60";
    case "Fix Done":
      return "bg-violet-50/70";
    case "Processing":
      return "bg-blue-50/60";
    default:
      return "";
  }
}

export function formatNotePreview(notes: MapRecord["notes"]): string {
  if (!notes?.length) return "";
  const last = notes[notes.length - 1]!;
  const prefix = last.user.name.split(" ")[0];
  const roleTag = notes.length > 0 ? `[${prefix}] ` : "";
  return `${roleTag}${last.body}`;
}

export function getRoleStatusList(): readonly string[] {
  return MAP_STATUS_VALUES.map((s) => MAP_STATUS_LABELS[s]);
}
