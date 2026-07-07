import type { MapPhase, MapRecord } from "../types";

/** Short station label for the pipeline table */
export const STATION_LABELS: Record<MapPhase, string> = {
  INTAKE: "Intake",
  PREP: "Prep",
  UPLOAD_REVIEW: "QA",
  FIELD: "Field",
  POLISH: "Polish",
  QA_REVIEW: "QA",
  APPROVED: "Done",
  CANCELLED: "Cancelled",
};

/** Canonical workflow states — inspector & QA only may change these */
export const WORKFLOW_STATES = [
  "Accepted",
  "Processing",
  "Done",
  "In QA",
  "Fix",
  "FixDone",
  "Approved",
  "Cancelled",
] as const;

export type WorkflowDisplayState = (typeof WORKFLOW_STATES)[number] | "—";

/** Inspector-owned states */
export const INSPECTOR_STATES = ["Accepted", "Processing", "Done", "FixDone"] as const;

/** QA-owned states */
export const QA_STATES = ["Fix", "Approved"] as const;

export function getMapStation(map: MapRecord): string {
  return STATION_LABELS[map.phase];
}

/** Single display state for the State column — synced from inspector & QA updates only */
export function getMapDisplayState(map: MapRecord): WorkflowDisplayState {
  const { qaStatus, inspectorStatus, phase } = map;

  if (phase === "CANCELLED") return "Cancelled";
  if (qaStatus === "FIX") return "Fix";
  if (qaStatus === "FIX_DONE") return "FixDone";
  if (qaStatus === "APPROVED" || phase === "APPROVED") return "Approved";

  if (
    (phase === "UPLOAD_REVIEW" || phase === "QA_REVIEW") &&
    inspectorStatus === "DONE" &&
    !qaStatus
  ) {
    return "In QA";
  }

  if (inspectorStatus === "ACCEPTED") return "Accepted";
  if (inspectorStatus === "PROCESSING") return "Processing";
  if (inspectorStatus === "DONE") return "Done";

  return "—";
}

/** @deprecated Use getMapDisplayState */
export function getMapState(map: MapRecord): string {
  return getMapDisplayState(map);
}

export function getMapAssignee(map: MapRecord): string {
  if (map.phase === "UPLOAD_REVIEW" || map.phase === "QA_REVIEW") {
    return map.assignedQa?.name ?? "—";
  }
  if (map.phase === "INTAKE") return "—";
  if (map.assignedInspector) return map.assignedInspector.name;
  return "—";
}

export function countMapsForMember(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) => m.assignedInspector?.id === userId || m.assignedQa?.id === userId
  ).length;
}

export type TaskType = "Upload" | "Polish";

export function getTaskType(map: MapRecord): TaskType | null {
  if (["INTAKE", "PREP", "UPLOAD_REVIEW"].includes(map.phase)) return "Upload";
  if (["POLISH", "QA_REVIEW"].includes(map.phase)) return "Polish";
  return null;
}

export function canAssignInspector(map: MapRecord): boolean {
  return ["INTAKE", "PREP", "POLISH"].includes(map.phase);
}

export function canAssignQa(map: MapRecord): boolean {
  return ["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase);
}

export function needsInspectorAssignment(map: MapRecord): boolean {
  return map.phase === "INTAKE";
}

export function needsQaAssignment(map: MapRecord): boolean {
  return canAssignQa(map) && !map.assignedQa;
}

export function countInspectorWorkload(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) =>
      m.assignedInspector?.id === userId &&
      ["PREP", "POLISH"].includes(m.phase)
  ).length;
}

export function countQaWorkload(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) =>
      m.assignedQa?.id === userId &&
      (["UPLOAD_REVIEW", "QA_REVIEW"].includes(m.phase) ||
        m.qaStatus === "FIX" ||
        m.qaStatus === "FIX_DONE")
  ).length;
}

export type AssignmentQueue =
  | "all"
  | "unassigned"
  | "needs_qa"
  | "in_progress"
  | "in_qa";

export function matchesQueue(map: MapRecord, queue: AssignmentQueue): boolean {
  switch (queue) {
    case "all":
      return true;
    case "unassigned":
      return needsInspectorAssignment(map);
    case "needs_qa":
      return needsQaAssignment(map);
    case "in_progress":
      return ["PREP", "POLISH", "FIELD"].includes(map.phase);
    case "in_qa":
      return ["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase);
    default:
      return true;
  }
}

export function getInspectorLabel(map: MapRecord): string {
  return map.assignedInspector?.name ?? "Unassigned";
}

export function getQaLabel(map: MapRecord): string {
  if (!canAssignQa(map) && !map.assignedQa) return "—";
  return map.assignedQa?.name ?? "Needs QA";
}

/** Active maps a team member is working on (inspector or QA), excluding approved. */
export function getActiveWorkForMember(maps: MapRecord[], userId: string): MapRecord[] {
  return maps.filter(
    (m) =>
      m.phase !== "APPROVED" &&
      m.phase !== "CANCELLED" &&
      (m.assignedInspector?.id === userId || m.assignedQa?.id === userId)
  );
}

export type MapColumnFilters = {
  map: string;
  client: string;
  task: string;
  station: string;
  state: string;
  inspector: string;
  qa: string;
};

export const EMPTY_COLUMN_FILTERS: MapColumnFilters = {
  map: "",
  client: "",
  task: "",
  station: "",
  state: "",
  inspector: "",
  qa: "",
};

export function matchesColumnFilters(map: MapRecord, filters: MapColumnFilters): boolean {
  const mapLabel = map.mapNumber.toLowerCase();
  const client = map.client.toLowerCase();
  const task = getTaskType(map) ?? "—";
  const station = getMapStation(map);
  const state = getMapDisplayState(map);
  const inspector = getInspectorLabel(map);
  const qa = getQaLabel(map);

  if (filters.map && !mapLabel.includes(filters.map.toLowerCase())) return false;
  if (filters.client && !client.includes(filters.client.toLowerCase())) return false;
  if (filters.task && task !== filters.task) return false;
  if (filters.station && station !== filters.station) return false;
  if (filters.state && state !== filters.state) return false;
  if (filters.inspector && inspector !== filters.inspector) return false;
  if (filters.qa && qa !== filters.qa) return false;

  return true;
}

export function workflowStateTone(state: WorkflowDisplayState): string {
  switch (state) {
    case "Accepted":
      return "ACCEPTED";
    case "Processing":
      return "PROCESSING";
    case "Done":
      return "DONE";
    case "In QA":
      return "UPLOAD_REVIEW";
    case "Fix":
      return "FIX";
    case "FixDone":
      return "FIX_DONE";
    case "Approved":
      return "APPROVED";
    case "Cancelled":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}
