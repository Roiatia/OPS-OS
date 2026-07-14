import type { MapRecord, MapStatus } from "../types";
import { getMapDisplayState } from "./mapDisplay";
import { MAP_STATUS_LABELS, MAP_STATUS_VALUES } from "./mapStatus";

const ARCHIVED = new Set(["APPROVED", "CANCELLED"]);

/**
 * Inspector Inbox: assigned to me, not accepted yet.
 * INTAKE uses inspectorAssignAccepted; PREP/POLISH with null status is a
 * legacy "pending accept" path. Once status is set, the map is Active.
 */
export function isInspectorInbox(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;

  if (map.phase === "INTAKE") {
    return map.inspectorAssignAccepted !== true;
  }

  // Shared status already set → active work, not inbox.
  if (map.status !== null) return false;
  return ["PREP", "POLISH"].includes(map.phase);
}

/**
 * QA Inbox is intake-only (must accept assignment first).
 * Later phases use isQaActive for the shared review workspace.
 */
export function isQaInbox(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.phase !== "INTAKE") return false;
  if (map.assignedQa?.id !== userId) return false;
  return map.qaAssignAccepted !== true;
}

/** Inspector Active = assigned to me and not sitting in Inbox. */
export function isInspectorActive(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;
  if (isInspectorInbox(map, userId)) return false;
  return true;
}

/**
 * QA Active:
 * - Assigned maps after accept / in pipeline phases
 * - Any UPLOAD_REVIEW / QA_REVIEW (so review work is never invisible)
 * - FIX / FIX_DONE (needs QA regardless of assignee)
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

/** Returns true when the status option represents a fix request. */
export function isFixStatusOption(option: StatusOption): boolean {
  return option.value === "FIX";
}

/** Returns the map's current status value, or empty string if unset. */
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

/** Returns the human-readable shared status label for a map. */
export function getRoleStatusLabel(map: MapRecord): string {
  return getMapDisplayState(map);
}

/** Returns a background class for table rows based on map status. */
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

/** Builds a one-line preview of the most recent map note. */
export function formatNotePreview(notes: MapRecord["notes"]): string {
  if (!notes?.length) return "";
  const last = notes[notes.length - 1]!;
  const prefix = last.user.name.split(" ")[0];
  const roleTag = notes.length > 0 ? `[${prefix}] ` : "";
  return `${roleTag}${last.body}`;
}

/** Returns all shared workflow status labels in display order. */
export function getRoleStatusList(): readonly string[] {
  return MAP_STATUS_VALUES.map((s) => MAP_STATUS_LABELS[s]);
}
