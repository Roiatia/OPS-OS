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

/** CSV "Map received" — cell is "v" (or similar) when received, empty otherwise. */
export const MAP_RECEIVED_VALUE = "v";

export type MapReceivedStatus = "received" | "not_received";

export function isMapReceived(raw: string | null | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  if (!v) return false;
  return v === "v" || v === "✓" || v === "yes" || v === "true" || v === "received";
}

export function getMapReceivedStatus(raw: string | null | undefined): MapReceivedStatus {
  return isMapReceived(raw) ? "received" : "not_received";
}

export function getMapReceivedLabel(raw: string | null | undefined): string {
  return isMapReceived(raw) ? "Map received" : "Not received yet";
}

/** Select / cell chrome for Map received column */
export function mapReceivedSelectClass(raw: string | null | undefined): string {
  return isMapReceived(raw)
    ? "bg-emerald-50 text-emerald-900 border-emerald-300"
    : "bg-amber-50 text-amber-950 border-amber-300";
}

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
  // Leaders/OPS may assign QA during prep, polish, field, and review — not only
  // formal review phases. Matches maps-board Assign buttons + backend assignQa.
  return map.phase !== "APPROVED" && map.phase !== "CANCELLED";
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
      m.phase !== "APPROVED" &&
      m.phase !== "CANCELLED"
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

/** Spreadsheet formula errors / blanks are not real assignee names. */
function isUsableCsvName(raw: string | null | undefined): boolean {
  const s = raw?.trim() ?? "";
  if (!s) return false;
  if (/^#ref!/i.test(s) || /^#n\/?a/i.test(s) || /^#value!/i.test(s)) return false;
  return true;
}

export function getInspectorLabel(map: MapRecord): string {
  if (map.assignedInspector?.name) return map.assignedInspector.name;
  if (map.assigneeConflict) return "Please assign";
  if (map.task === "POLISH") {
    return isUsableCsvName(map.graphicsPolishAssignee)
      ? map.graphicsPolishAssignee!
      : "Unassigned";
  }
  if (isUsableCsvName(map.graphicsUploadAssignee)) return map.graphicsUploadAssignee!;
  if (isUsableCsvName(map.graphicsPolishAssignee)) return map.graphicsPolishAssignee!;
  return "Unassigned";
}

export function getQaLabel(map: MapRecord): string {
  if (map.assignedQa?.name) return map.assignedQa.name;
  if (map.assigneeConflict) return "Please assign";
  if (map.task === "POLISH") {
    if (isUsableCsvName(map.polishQaAssignee)) return map.polishQaAssignee!;
    return canAssignQa(map) ? "Needs QA" : "—";
  }
  const csv = map.uploadQaAssignee ?? map.polishQaAssignee;
  if (isUsableCsvName(csv)) return csv!;
  if (!canAssignQa(map)) return "—";
  return "Needs QA";
}

/** Non-date spreadsheet placeholders (must never show as a date cell value). */
export function isCsvDatePlaceholder(raw: string | null | undefined): boolean {
  const s = raw?.trim() ?? "";
  if (!s) return true;
  return /^(done|v|✓|yes|-|--)$/i.test(s) || /^queued\b/i.test(s);
}

/** Prefer typed date; never show Done/done/v placeholders — use "—" instead. */
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
  if (!s || isCsvDatePlaceholder(s)) return "—";
  // Raw must look like a date (digit + letter), not a status word
  if (!/\d/.test(s) || !/[A-Za-z]/.test(s)) return "—";
  return s;
}

export type SpreadsheetDateKind =
  | "schedule"
  | "mapping"
  | "sentToStudio"
  | "receivedFromStudio"
  | "activation";

/** Colored chrome for editable spreadsheet date inputs. */
export function spreadsheetDateFieldClass(
  kind: SpreadsheetDateKind,
  hasValue: boolean
): string {
  if (!hasValue) {
    return "bg-amber-50 border-amber-200 text-amber-950";
  }
  switch (kind) {
    case "schedule":
      return "bg-sky-50 border-sky-300 text-sky-950";
    case "mapping":
      return "bg-indigo-50 border-indigo-300 text-indigo-950";
    case "sentToStudio":
      return "bg-teal-50 border-teal-300 text-teal-950";
    case "receivedFromStudio":
      return "bg-emerald-50 border-emerald-300 text-emerald-950";
    case "activation":
      return "bg-violet-50 border-violet-300 text-violet-950";
  }
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
  mapReceived: string;
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
  mapReceived: "",
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
  if (filters.mapReceived) {
    if (getMapReceivedStatus(map.mapReceived) !== filters.mapReceived) return false;
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
