import type { MapRecord } from "../types";
import { getMapDisplayState } from "./mapDisplay";

const ARCHIVED = new Set(["APPROVED", "CANCELLED"]);

/** New assignment — inspector has not accepted yet */
export function isInspectorInbox(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;
  if (map.inspectorStatus !== null) return false;
  return ["PREP", "POLISH"].includes(map.phase);
}

/** Accepted and in progress — shared inspector ↔ QA workspace */
export function isInspectorActive(map: MapRecord, userId: string): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (map.assignedInspector?.id !== userId) return false;
  if (map.inspectorStatus !== null) return true;
  if (map.qaStatus === "FIX") return true;
  return false;
}

/** Maps the QA team works on in the shared active table */
export function isQaActive(map: MapRecord): boolean {
  if (ARCHIVED.has(map.phase)) return false;
  if (["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase)) return true;
  if (map.qaStatus === "FIX" || map.qaStatus === "FIX_DONE") return true;
  return false;
}

/** Maps awaiting supervisor acceptance */
export function isSupervisorInbox(map: MapRecord, userId: string): boolean {
  if (map.phase !== "FIELD") return false;
  if (map.assignedSupervisor?.id !== userId) return false;
  return map.supervisorStatus === null;
}

/** Maps the supervisor is actively mapping in the field */
export function isSupervisorActive(map: MapRecord, userId: string): boolean {
  if (map.phase !== "FIELD") return false;
  if (map.assignedSupervisor?.id !== userId) return false;
  return map.supervisorStatus !== null && map.supervisorStatus !== "DONE";
}

/** Supervisor finished — waiting for OPS manager to release to graphics */
export function isSupervisorAwaitingOps(map: MapRecord, userId: string): boolean {
  if (map.phase !== "FIELD") return false;
  if (map.assignedSupervisor?.id !== userId) return false;
  return map.supervisorStatus === "DONE";
}

export function getSupervisorStatusOptions(map: MapRecord): StatusOption[] {
  if (map.phase !== "FIELD") return [];
  if (map.supervisorStatus === "DONE") return [];

  const options: StatusOption[] = [];
  if (!map.supervisorStatus) {
    options.push({
      value: "ACCEPTED",
      label: "Accepted",
      action: { kind: "supervisor", status: "ACCEPTED" },
    });
    return options;
  }
  options.push(
    {
      value: "ACCEPTED",
      label: "Accepted",
      action: { kind: "supervisor", status: "ACCEPTED" },
    },
    {
      value: "PROCESSING",
      label: "Mapping",
      action: { kind: "supervisor", status: "PROCESSING" },
    },
    {
      value: "DONE",
      label: "Done",
      action: { kind: "supervisor", status: "DONE" },
    }
  );
  return options;
}

export type StatusAction =
  | { kind: "inspector"; status: "ACCEPTED" | "PROCESSING" | "DONE" }
  | { kind: "supervisor"; status: "ACCEPTED" | "PROCESSING" | "DONE" }
  | { kind: "qa_review"; status: "fix" | "fix_done" | "approved" }
  | { kind: "upload_review"; approved: boolean };

export interface StatusOption {
  value: string;
  label: string;
  action: StatusAction;
}

export function getInspectorStatusOptions(map: MapRecord): StatusOption[] {
  if (map.qaStatus === "FIX" && map.phase === "POLISH") {
    return [{ value: "fix_done", label: "FixDone", action: { kind: "qa_review", status: "fix_done" } }];
  }
  if (!["PREP", "POLISH"].includes(map.phase)) return [];

  const options: StatusOption[] = [];
  if (!map.inspectorStatus) {
    options.push({
      value: "ACCEPTED",
      label: "Accepted",
      action: { kind: "inspector", status: "ACCEPTED" },
    });
    return options;
  }
  options.push(
    {
      value: "ACCEPTED",
      label: "Accepted",
      action: { kind: "inspector", status: "ACCEPTED" },
    },
    {
      value: "PROCESSING",
      label: "Processing",
      action: { kind: "inspector", status: "PROCESSING" },
    },
    {
      value: "DONE",
      label: "Done",
      action: { kind: "inspector", status: "DONE" },
    }
  );
  return options;
}

export function getQaStatusOptions(map: MapRecord): StatusOption[] {
  if (map.phase === "UPLOAD_REVIEW") {
    return [
      {
        value: "upload_approved",
        label: "Approved",
        action: { kind: "upload_review", approved: true },
      },
      {
        value: "upload_fix",
        label: "Fix",
        action: { kind: "upload_review", approved: false },
      },
    ];
  }
  if (map.phase === "QA_REVIEW" && map.qaStatus !== "FIX_DONE") {
    return [
      { value: "approved", label: "Approved", action: { kind: "qa_review", status: "approved" } },
      { value: "fix", label: "Fix", action: { kind: "qa_review", status: "fix" } },
    ];
  }
  if (map.qaStatus === "FIX_DONE") {
    return [
      { value: "approved", label: "Approved", action: { kind: "qa_review", status: "approved" } },
    ];
  }
  return [];
}

/**
 * Status transitions the graphics team leader can drive from their board — the
 * union of what the assigned inspector / QA could do at the map's current
 * phase. Prep/Polish expose the inspector moves; the review phases expose the
 * QA moves. Other phases (intake, field, archived) offer nothing to change.
 */
export function getLeaderStatusOptions(map: MapRecord): StatusOption[] {
  if (["PREP", "POLISH"].includes(map.phase)) {
    return getInspectorStatusOptions(map);
  }
  if (["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase)) {
    return getQaStatusOptions(map);
  }
  return [];
}

export function getCurrentStatusValue(map: MapRecord, role: "inspector" | "qa"): string {
  const display = getMapDisplayState(map);
  if (display === "In QA") return role === "qa" ? "in_qa" : "DONE";
  if (display === "—") return "";
  if (display === "FixDone") return "fix_done";
  if (display === "Fix") return "fix";
  if (display === "Approved") return "approved";
  return display.toUpperCase().replace("FIXDONE", "FIX_DONE");
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
    default:
      return "";
  }
}

export function formatNotePreview(notes: MapRecord["notes"]): string {
  if (!notes?.length) return "";
  // Pick the newest note regardless of array order — the slimmed list payload
  // returns notes newest-first (capped), while detail payloads are oldest-first.
  const last = notes.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const prefix = last.user.name.split(" ")[0];
  const roleTag = notes.length > 0 ? `[${prefix}] ` : "";
  return `${roleTag}${last.body}`;
}
