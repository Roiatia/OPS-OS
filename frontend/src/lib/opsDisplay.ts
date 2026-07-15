import type { MapPhase, MapRecord } from "../types";
import { getPipelineStageLabel, isUploadStageComplete } from "./pipeline";
import { getMapDisplayState, getInspectorLabel, getQaLabel } from "./mapDisplay";
import {
  FIELD_WORK_STATUS_LABELS,
  formatFieldDateTime,
  getSupervisorFieldStatus,
} from "./supervisorDisplay";

const GRAPHICS_PHASES: MapPhase[] = ["PREP", "UPLOAD_REVIEW", "POLISH", "QA_REVIEW"];

export type OpsMapQueue =
  | "all"
  | "today"
  | "new_from_cs"
  | "at_graphics"
  | "field"
  | "ready_to_release";

export const OPS_QUEUE_TABS: { id: OpsMapQueue; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "new_from_cs", label: "New from CS" },
  { id: "at_graphics", label: "At graphics" },
  { id: "field", label: "Field work" },
  { id: "ready_to_release", label: "Ready to accept" },
];

export function isScheduledToday(map: MapRecord): boolean {
  if (!map.fieldDate) return false;
  const d = new Date(map.fieldDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function isAtGraphics(map: MapRecord): boolean {
  return GRAPHICS_PHASES.includes(map.phase);
}

export function isReadyToRelease(map: MapRecord): boolean {
  return map.phase === "FIELD" && getSupervisorFieldStatus(map) === "COMPLETED";
}

/** Ready-to-accept maps first, then most recently updated */
export function sortOpsMaps(maps: MapRecord[]): MapRecord[] {
  return [...maps].sort((a, b) => {
    const aReady = isReadyToRelease(a) ? 1 : 0;
    const bReady = isReadyToRelease(b) ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function getReadyToAcceptMaps(maps: MapRecord[]): MapRecord[] {
  return sortOpsMaps(maps.filter(isReadyToRelease));
}

export function needsSupervisorAssignment(map: MapRecord): boolean {
  return map.phase === "FIELD" && isUploadStageComplete(map) && !map.assignedSupervisor;
}

export function canAssignSupervisor(map: MapRecord): boolean {
  return (
    map.phase === "FIELD" &&
    isUploadStageComplete(map) &&
    getSupervisorFieldStatus(map) !== "COMPLETED"
  );
}

export function canReleaseToPolish(map: MapRecord): boolean {
  return isReadyToRelease(map);
}

export function canSendToGraphics(map: MapRecord): boolean {
  return map.phase === "INTAKE" && !map.releasedToGraphics;
}

export function canShuffleSupervisor(map: MapRecord): boolean {
  return (
    map.phase === "FIELD" &&
    isUploadStageComplete(map) &&
    map.fieldWorkStatus === "UNCOMPLETED" &&
    getSupervisorFieldStatus(map) !== "COMPLETED"
  );
}

export function matchesOpsQueue(map: MapRecord, queue: OpsMapQueue): boolean {
  switch (queue) {
    case "all":
      return true;
    case "today":
      return isScheduledToday(map);
    case "new_from_cs":
      return map.phase === "INTAKE";
    case "at_graphics":
      return isAtGraphics(map);
    case "field":
      return map.phase === "FIELD";
    case "ready_to_release":
      return isReadyToRelease(map);
    default:
      return true;
  }
}

export function getOpsPipelineLabel(map: MapRecord): string {
  return getPipelineStageLabel(map);
}

export function getOpsGraphicsWorkLine(map: MapRecord): string | null {
  if (!isAtGraphics(map)) return null;
  const state = getMapDisplayState(map);
  if (map.phase === "UPLOAD_REVIEW" || map.phase === "QA_REVIEW") {
    const qa = getQaLabel(map);
    return qa !== "—" ? `QA: ${qa} · ${state}` : `QA · ${state}`;
  }
  const inspector = getInspectorLabel(map);
  return inspector !== "—" ? `Inspector: ${inspector} · ${state}` : state;
}

export function getOpsStatusLabel(map: MapRecord): string {
  if (map.phase === "INTAKE") {
    return map.releasedToGraphics ? "Awaiting graphics" : "New";
  }
  if (isAtGraphics(map)) {
    return getMapDisplayState(map);
  }
  if (map.phase === "FIELD") {
    if (needsSupervisorAssignment(map)) return "Needs supervisor";
    const status = getSupervisorFieldStatus(map);
    const base = FIELD_WORK_STATUS_LABELS[status];
    if (status === "UNCOMPLETED" && (map.fieldProgressPercent ?? 0) > 0) {
      return `${base} (${map.fieldProgressPercent}%)`;
    }
    return base;
  }
  return "—";
}

export function opsPipelineTone(map: MapRecord): string {
  if (map.phase === "INTAKE" && !map.releasedToGraphics) return "PROCESSING";
  if (isReadyToRelease(map)) return "DONE";
  if (map.phase === "FIELD") {
    if (needsSupervisorAssignment(map)) return "FIX";
    return getSupervisorFieldStatus(map) === "COMPLETED" ? "DONE" : "PROCESSING";
  }
  if (isAtGraphics(map)) {
    const state = getMapDisplayState(map);
    if (state === "Approved" || state === "Done") return "DONE";
    if (state === "Fix") return "FIX";
    return "PROCESSING";
  }
  return "PROCESSING";
}

export function opsStatusTone(map: MapRecord): string {
  return opsPipelineTone(map);
}

export { FIELD_WORK_STATUS_LABELS, formatFieldDateTime, getSupervisorFieldStatus };
