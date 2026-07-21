import type { MapPhase, MapRecord, MapStation, MapTask } from "../types";

/** @deprecated Phase step labels — prefer board station (OPS/GRAPHICS). Kept for OPS pipeline UI. */
export const PHASE_STATION_LABELS: Record<MapPhase, string> = {
  INTAKE: "Intake",
  PREP: "Prep",
  UPLOAD_REVIEW: "QA",
  FIELD: "Field",
  POLISH: "Polish",
  QA_REVIEW: "QA",
  APPROVED: "Done",
  CANCELLED: "Cancelled",
};

/** @deprecated Use PHASE_STATION_LABELS */
export const STATION_LABELS = PHASE_STATION_LABELS;

export const MAP_TASK_OPTIONS: { value: MapTask; label: string }[] = [
  { value: "UPLOAD", label: "Upload" },
  { value: "UPLOADED", label: "Uploaded" },
  { value: "POLISH", label: "Polish" },
];

export const MAP_STATION_OPTIONS: { value: MapStation; label: string }[] = [
  { value: "OPS", label: "OPS" },
  { value: "GRAPHICS", label: "GRAPHICS" },
];

export const MAP_TASK_LABELS: Record<MapTask, string> = {
  UPLOAD: "Upload",
  UPLOADED: "Uploaded",
  POLISH: "Polish",
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

/** Phase step label (legacy / OPS boards). Not the board Station column. */
export function getPhaseStationLabel(map: MapRecord): string {
  return PHASE_STATION_LABELS[map.phase];
}

/** @deprecated Use getPhaseStationLabel or getMapStation */
export function getMapStation(map: MapRecord): string {
  return map.station ?? "GRAPHICS";
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

export type TaskType = "Upload" | "Uploaded" | "Polish";

export function getTaskType(map: MapRecord): TaskType {
  const task = map.task ?? "UPLOAD";
  return MAP_TASK_LABELS[task] as TaskType;
}

export function taskTone(task: MapTask | TaskType | string): string {
  const t = typeof task === "string" && task === task.toUpperCase() ? task : undefined;
  const key = (t ??
    (task === "Upload"
      ? "UPLOAD"
      : task === "Uploaded"
        ? "UPLOADED"
        : task === "Polish"
          ? "POLISH"
          : "UPLOAD")) as MapTask;
  switch (key) {
    case "UPLOADED":
      return "UPLOAD_REVIEW";
    case "POLISH":
      return "POLISH";
    default:
      return "PREP";
  }
}

export function stationTone(station: MapStation | string): string {
  return station === "OPS" ? "FIELD" : "PREP";
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
  if (map.assignedInspector?.name) return map.assignedInspector.name;
  if (map.assigneeConflict) return "Please assign";
  if (map.task === "POLISH") {
    return map.graphicsPolishAssignee ?? "Unassigned";
  }
  return map.graphicsUploadAssignee ?? map.graphicsPolishAssignee ?? "Unassigned";
}

export function getQaLabel(map: MapRecord): string {
  if (map.assignedQa?.name) return map.assignedQa.name;
  if (map.assigneeConflict) return "Please assign";
  if (map.task === "POLISH") {
    return map.polishQaAssignee ?? (canAssignQa(map) ? "Needs QA" : "—");
  }
  const csv = map.uploadQaAssignee ?? map.polishQaAssignee;
  if (csv) return csv;
  if (!canAssignQa(map)) return "—";
  return "Needs QA";
}

/** Prefer typed date, else raw spreadsheet string. */
export function formatCsvDateCell(
  at: string | null | undefined,
  raw: string | null | undefined
): string {
  if (at) {
    try {
      return new Date(at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      /* fall through */
    }
  }
  const s = raw?.trim();
  return s || "—";
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
  batch: string;
  task: string;
  station: string;
  state: string;
  inspector: string;
  qa: string;
};

export const EMPTY_COLUMN_FILTERS: MapColumnFilters = {
  map: "",
  client: "",
  batch: "",
  task: "",
  station: "",
  state: "",
  inspector: "",
  qa: "",
};

export function matchesColumnFilters(map: MapRecord, filters: MapColumnFilters): boolean {
  const mapLabel = map.mapNumber.toLowerCase();
  const client = map.client.toLowerCase();
  const task = getTaskType(map);
  const station = map.station ?? "GRAPHICS";
  const state = getMapDisplayState(map);
  const inspector = getInspectorLabel(map);
  const qa = getQaLabel(map);

  if (filters.map && !mapLabel.includes(filters.map.toLowerCase())) return false;
  if (filters.client && !client.includes(filters.client.toLowerCase())) return false;
  if (filters.batch) {
    const mapBatch = map.batch?.trim() || "—";
    if (mapBatch !== filters.batch) return false;
  }
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
