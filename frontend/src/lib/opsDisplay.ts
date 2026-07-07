import type { MapPhase, MapRecord } from "../types";
import { PHASE_LABELS } from "../types";
import { getMapDisplayState, getInspectorLabel, getQaLabel } from "./mapDisplay";
import {
  FIELD_WORK_STATUS_LABELS,
  formatFieldDateTime,
  getSupervisorFieldStatus,
} from "./supervisorDisplay";

const GRAPHICS_PHASES: MapPhase[] = ["PREP", "UPLOAD_REVIEW", "POLISH", "QA_REVIEW"];

export type OpsMapQueue =
  | "all"
  | "new_from_cs"
  | "at_graphics"
  | "field"
  | "ready_to_release";

export const OPS_QUEUE_TABS: { id: OpsMapQueue; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new_from_cs", label: "New from CS" },
  { id: "at_graphics", label: "At graphics" },
  { id: "field", label: "Field work" },
  { id: "ready_to_release", label: "Ready to accept" },
];

export function isAtGraphics(map: MapRecord): boolean {
  return GRAPHICS_PHASES.includes(map.phase);
}

export function isReadyToRelease(map: MapRecord): boolean {
  return map.phase === "FIELD" && getSupervisorFieldStatus(map) === "COMPLETED";
}

export function needsSupervisorAssignment(map: MapRecord): boolean {
  return map.phase === "FIELD" && !map.assignedSupervisor;
}

export function canAssignSupervisor(map: MapRecord): boolean {
  return map.phase === "FIELD" && getSupervisorFieldStatus(map) !== "COMPLETED";
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
    map.fieldWorkStatus === "UNCOMPLETED" &&
    getSupervisorFieldStatus(map) !== "COMPLETED"
  );
}

export function matchesOpsQueue(map: MapRecord, queue: OpsMapQueue): boolean {
  switch (queue) {
    case "all":
      return true;
    case "new_from_cs":
      return map.phase === "INTAKE";
    case "at_graphics":
      return isAtGraphics(map);
    case "field":
      return map.phase === "FIELD" && !isReadyToRelease(map);
    case "ready_to_release":
      return isReadyToRelease(map);
    default:
      return true;
  }
}

export function getOpsPipelineLabel(map: MapRecord): string {
  if (map.phase === "INTAKE") {
    return map.releasedToGraphics ? "Sent to graphics" : "New from CS";
  }
  if (isAtGraphics(map)) {
    return `Graphics — ${PHASE_LABELS[map.phase]}`;
  }
  if (isReadyToRelease(map)) return "Field complete";
  if (map.phase === "FIELD") return "Field mapping";
  return PHASE_LABELS[map.phase];
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
    return FIELD_WORK_STATUS_LABELS[getSupervisorFieldStatus(map)];
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
