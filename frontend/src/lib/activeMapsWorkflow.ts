import type { MapRecord } from "../types";
import { getMapDisplayState, getMapWorkflowPhaseTarget, INSPECTOR_STATES, QA_STATES } from "./mapDisplay";

const ARCHIVED = new Set(["APPROVED", "CANCELLED"]);

/** New assignment — inspector has not accepted yet */
export function isInspectorInbox(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;

  if (map.phase === "INTAKE") {
    return map.inspectorAssignAccepted !== true;
  }

  if (map.inspectorStatus !== null) return false;
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

/** Maps the QA team works on in the shared active table */
export function isQaActive(map: MapRecord): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase)) return true;
  if (map.qaStatus === "FIX" || map.qaStatus === "FIX_DONE") return true;
  return false;
}

export type StatusAction =
  | { kind: "inspector"; status: "ACCEPTED" | "PROCESSING" | "DONE" }
  | { kind: "qa_review"; status: "fix" | "fix_done" | "approved" }
  | { kind: "upload_review"; approved: boolean };

export interface StatusOption {
  value: string;
  label: string;
  action: StatusAction;
}

const INSPECTOR_STATUS_OPTIONS: StatusOption[] = [
  { value: "ACCEPTED", label: "Accepted", action: { kind: "inspector", status: "ACCEPTED" } },
  { value: "PROCESSING", label: "Processing", action: { kind: "inspector", status: "PROCESSING" } },
  { value: "DONE", label: "Done", action: { kind: "inspector", status: "DONE" } },
  { value: "fix_done", label: "FixDone", action: { kind: "qa_review", status: "fix_done" } },
];

/** Inspector may change status during pre-upload or polish stations, or while fixing */
export function canInspectorEditStatus(map: MapRecord): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  const station = getMapWorkflowPhaseTarget(map);
  if (station === "UPLOADED" || station === "POLISHED") return false;
  if (map.qaStatus === "FIX") return true;
  return station === "PRE_UPLOAD" || station === "POLISH";
}

/** QA may change status when the map is ready for their review */
export function canQaEditStatus(map: MapRecord): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.qaStatus === "FIX") return false;

  if (map.phase === "UPLOAD_REVIEW") {
    if (map.qaStatus === "FIX_DONE") return true;
    return map.inspectorStatus === "DONE";
  }

  if (map.phase === "QA_REVIEW") {
    if (map.qaStatus === "FIX_DONE") return true;
    return map.inspectorStatus === "DONE";
  }

  if (map.qaStatus === "FIX_DONE") return true;
  return false;
}

export function getInspectorStatusOptions(map: MapRecord): StatusOption[] {
  if (!canInspectorEditStatus(map)) return [];
  return INSPECTOR_STATUS_OPTIONS;
}

export function getQaStatusOptions(map: MapRecord): StatusOption[] {
  if (!canQaEditStatus(map)) return [];

  if (map.phase === "UPLOAD_REVIEW") {
    if (map.qaStatus === "FIX_DONE") {
      return [
        {
          value: "approved",
          label: "Approved",
          action: { kind: "upload_review", approved: true },
        },
      ];
    }
    return [
      {
        value: "approved",
        label: "Approved",
        action: { kind: "upload_review", approved: true },
      },
      {
        value: "fix",
        label: "Fix",
        action: { kind: "upload_review", approved: false },
      },
    ];
  }

  if (map.qaStatus === "FIX_DONE") {
    return [
      { value: "approved", label: "Approved", action: { kind: "qa_review", status: "approved" } },
    ];
  }

  return [
    { value: "approved", label: "Approved", action: { kind: "qa_review", status: "approved" } },
    { value: "fix", label: "Fix", action: { kind: "qa_review", status: "fix" } },
  ];
}

export function getInspectorStatusLabel(map: MapRecord): string {
  if (map.qaStatus === "FIX_DONE") return "FixDone";
  if (map.inspectorStatus === "ACCEPTED") return "Accepted";
  if (map.inspectorStatus === "PROCESSING") return "Processing";
  if (map.inspectorStatus === "DONE") return "Done";
  return "—";
}

export function getQaStatusLabel(map: MapRecord): string {
  if (map.qaStatus === "FIX") return "Fix";
  if (map.qaStatus === "APPROVED" || map.phase === "APPROVED") return "Approved";
  if (map.qaStatus === "FIX_DONE") return "FixDone";
  const display = getMapDisplayState(map);
  if (display === "In QA") return "—";
  return "—";
}

export function getCurrentStatusValue(map: MapRecord, role: "inspector" | "qa"): string {
  if (role === "inspector") {
    if (map.qaStatus === "FIX_DONE") return "fix_done";
    if (map.qaStatus === "FIX") return map.inspectorStatus ?? "";
    if (map.inspectorStatus === "DONE") return "DONE";
    if (map.inspectorStatus === "PROCESSING") return "PROCESSING";
    if (map.inspectorStatus === "ACCEPTED") return "ACCEPTED";
    return "";
  }

  if (map.qaStatus === "FIX") return "fix";
  if (map.qaStatus === "APPROVED" || map.phase === "APPROVED") return "approved";
  if (map.qaStatus === "FIX_DONE") return "";
  return "";
}

export function getRoleStatusLabel(map: MapRecord, role: "inspector" | "qa"): string {
  return role === "inspector" ? getInspectorStatusLabel(map) : getQaStatusLabel(map);
}

export function statusRowClass(map: MapRecord): string {
  const state = getMapDisplayState(map);
  switch (state) {
    case "Fix":
      return "bg-red-50/80";
    case "Approved":
      return "bg-emerald-50/80";
    case "In QA":
      return "bg-sky-50/80";
    case "Accepted":
      return "bg-amber-50/60";
    case "FixDone":
      return "bg-violet-50/70";
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

/** All statuses a role may set (for UI hints) */
export function getRoleStatusList(role: "inspector" | "qa"): readonly string[] {
  return role === "inspector" ? INSPECTOR_STATES : QA_STATES;
}
