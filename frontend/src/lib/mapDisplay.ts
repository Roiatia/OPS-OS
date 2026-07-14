import type { MapPhase, MapRecord, WorkflowPhaseTarget } from "../types";
import { mapStatusLabel } from "./mapStatus";

/** Editable pipeline stations (spreadsheet column) */
export const MAP_STATIONS: { id: WorkflowPhaseTarget; label: string }[] = [
  { id: "PRE_UPLOAD", label: "Pre-upload" },
  { id: "UPLOADED", label: "Uploaded" },
  { id: "POLISH", label: "Polish" },
  { id: "POLISHED", label: "Polished" },
];

/** Three macro phases shown on the workflow timeline */
export type WorkflowTimelinePhase = "PRE_UPLOAD" | "UPLOADED" | "POLISH";

export type WorkflowPhaseTargetType = WorkflowPhaseTarget;

export const WORKFLOW_PHASE_TARGETS: {
  id: WorkflowPhaseTarget;
  label: string;
  hint: string;
}[] = [
  {
    id: "PRE_UPLOAD",
    label: "Pre-upload",
    hint: "Leader assigns · Inspector prep · QA upload check",
  },
  {
    id: "UPLOADED",
    label: "Uploaded",
    hint: "Live on the client dashboard",
  },
  {
    id: "POLISH",
    label: "Polish",
    hint: "Inspector polish · QA final approval",
  },
  {
    id: "POLISHED",
    label: "Polished",
    hint: "Final approved map",
  },
];

export const WORKFLOW_TIMELINE: {
  id: WorkflowTimelinePhase;
  label: string;
  hint: string;
}[] = [
  {
    id: "PRE_UPLOAD",
    label: "Pre-upload",
    hint: "Leader assigns · Inspector prep · QA upload check",
  },
  {
    id: "UPLOADED",
    label: "Uploaded to dashboard",
    hint: "Live on the client dashboard",
  },
  {
    id: "POLISH",
    label: "Polish",
    hint: "Inspector polish · QA final approval",
  },
];

const TIMELINE_GRANULAR: Record<WorkflowTimelinePhase, MapPhase[]> = {
  PRE_UPLOAD: ["INTAKE", "PREP", "UPLOAD_REVIEW"],
  UPLOADED: ["FIELD"],
  POLISH: ["POLISH", "QA_REVIEW", "APPROVED"],
};

/** Maps a granular map phase to its macro timeline step. */
export function getWorkflowTimelinePhase(phase: MapPhase): WorkflowTimelinePhase {
  if (["INTAKE", "PREP", "UPLOAD_REVIEW"].includes(phase)) return "PRE_UPLOAD";
  if (phase === "FIELD") return "UPLOADED";
  return "POLISH";
}

/** Returns the workflow station target for a map. */
export function getMapWorkflowPhaseTarget(map: MapRecord): WorkflowPhaseTarget {
  if (map.phase === "APPROVED") return "POLISHED";
  return map.workflowPhaseTarget ?? "PRE_UPLOAD";
}

/** Maps a workflow target to its representative granular phase. */
export function granularPhaseForWorkflowTarget(target: WorkflowPhaseTarget): MapPhase {
  switch (target) {
    case "PRE_UPLOAD":
      return "INTAKE";
    case "UPLOADED":
      return "FIELD";
    case "POLISH":
      return "POLISH";
    case "POLISHED":
      return "APPROVED";
  }
}

/** Returns the display label for a workflow phase target. */
export function workflowPhaseTargetLabel(target: WorkflowPhaseTarget): string {
  return MAP_STATIONS.find((t) => t.id === target)?.label ?? target;
}

/** Maps a workflow target to a badge tone key. */
export function stationTone(target: WorkflowPhaseTarget): string {
  switch (target) {
    case "PRE_UPLOAD":
      return "PREP";
    case "UPLOADED":
      return "FIELD";
    case "POLISH":
      return "POLISH";
    case "POLISHED":
      return "APPROVED";
  }
}

/** Returns the timeline label for a map's current phase. */
export function getWorkflowTimelineLabel(phase: MapPhase): string {
  const entry = WORKFLOW_TIMELINE.find((s) => s.id === getWorkflowTimelinePhase(phase));
  return entry?.label ?? phase;
}

/** Index of the active timeline step; 3 means all steps complete (approved). */
export function getWorkflowTimelineIndex(phase: MapPhase): number {
  if (phase === "CANCELLED") return -1;
  if (["INTAKE", "PREP", "UPLOAD_REVIEW"].includes(phase)) return 0;
  if (phase === "FIELD") return 1;
  if (phase === "APPROVED") return 3;
  return 2;
}

export interface TimelineHistoryEntry {
  phase: MapPhase;
  enteredAt: string;
  user: { id: string; name: string };
  note?: string | null;
}

/** Finds the first phase-history entry within a timeline step. */
export function getTimelineHistoryEntry(
  timelinePhase: WorkflowTimelinePhase,
  phaseHistory: TimelineHistoryEntry[]
): TimelineHistoryEntry | undefined {
  const targets = TIMELINE_GRANULAR[timelinePhase];
  return phaseHistory.find((e) => targets.includes(e.phase));
}

/** Maps a timeline phase to a badge tone key. */
export function workflowTimelineTone(timelinePhase: WorkflowTimelinePhase): string {
  switch (timelinePhase) {
    case "PRE_UPLOAD":
      return "PREP";
    case "UPLOADED":
      return "FIELD";
    case "POLISH":
      return "POLISH";
  }
}

/** Short station label for the pipeline table */
export function getMapStation(map: MapRecord): string {
  return workflowPhaseTargetLabel(getMapWorkflowPhaseTarget(map));
}

/** @deprecated Legacy phase-derived station labels */
export const STATION_LABELS: Record<MapPhase, string> = {
  INTAKE: "Pre-upload",
  PREP: "Pre-upload",
  UPLOAD_REVIEW: "Pre-upload",
  FIELD: "Uploaded",
  POLISH: "Polish",
  QA_REVIEW: "Polish",
  APPROVED: "Polished",
  CANCELLED: "Cancelled",
};

/** Only statuses on the map — one shared value for every role. */
export const INSPECTOR_STATES = ["Accepted", "Processing", "Done", "Fix Done"] as const;

export const QA_STATES = ["Fix", "Approved"] as const;

export const WORKFLOW_STATES = [
  "Accepted",
  "Processing",
  "Done",
  "Fix",
  "Fix Done",
  "Approved",
] as const;

export type WorkflowDisplayState = (typeof WORKFLOW_STATES)[number] | "—" | "Cancelled";

/** Single shared status for every role — reads the one `status` field on the map. */
export function getMapDisplayState(map: MapRecord): WorkflowDisplayState {
  const label = mapStatusLabel(map.status);
  if (label === "—") return "—";
  return label as WorkflowDisplayState;
}

/** @deprecated Use getMapDisplayState */
export function getMapState(map: MapRecord): string {
  return getMapDisplayState(map);
}

/** Returns the primary assignee name for a map based on its phase. */
export function getMapAssignee(map: MapRecord): string {
  if (map.phase === "UPLOAD_REVIEW" || map.phase === "QA_REVIEW") {
    return map.assignedQa?.name ?? "—";
  }
  if (map.phase === "INTAKE") return "—";
  if (map.assignedInspector) return map.assignedInspector.name;
  return "—";
}

/** Counts maps assigned to a member as inspector or QA. */
export function countMapsForMember(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) => m.assignedInspector?.id === userId || m.assignedQa?.id === userId
  ).length;
}

export type TaskType = "Upload" | "Polish";

/** Returns Upload or Polish based on the map's current phase. */
export function getTaskType(map: MapRecord): TaskType | null {
  if (["INTAKE", "PREP", "UPLOAD_REVIEW"].includes(map.phase)) return "Upload";
  if (["POLISH", "QA_REVIEW"].includes(map.phase)) return "Polish";
  return null;
}

/** Returns true when a leader may assign an inspector to this map. */
export function canAssignInspector(map: MapRecord): boolean {
  return ["INTAKE", "PREP", "POLISH"].includes(map.phase);
}

/** Returns true when a leader may assign QA to this map. */
export function canAssignQa(map: MapRecord): boolean {
  if (["INTAKE", "UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase)) return true;
  // Prep maps saved without QA — leader can still assign from the pipeline table
  if (map.phase === "PREP" && !map.assignedQa) return true;
  return false;
}

/** Show assign/reassign control for inspector column in the pipeline table. */
export function showInspectorAssignControl(map: MapRecord): boolean {
  if (!isPipelineMapForLeader(map)) return false;
  if (map.assignedInspector) return canAssignInspector(map);
  return ["INTAKE", "PREP", "POLISH"].includes(map.phase);
}

/** Show assign/reassign control for QA column in the pipeline table. */
export function showQaAssignControl(map: MapRecord): boolean {
  if (!isPipelineMapForLeader(map)) return false;
  if (map.assignedQa) return canAssignQa(map);
  return showQaManualAssignFallback(map);
}

/** Rare fallback when auto-assign did not run (e.g. prep map saved without QA). */
export function showQaManualAssignFallback(map: MapRecord): boolean {
  return map.phase === "PREP" && !map.assignedQa;
}

/** Returns true when the assign modal can be opened for this map. */
export function canOpenAssignModal(map: MapRecord): boolean {
  return canAssignInspector(map) || canAssignQa(map);
}

/** Returns true when intake assignments await inspector or QA acceptance. */
export function isAwaitingTeamAcceptance(map: MapRecord): boolean {
  return (
    map.phase === "INTAKE" &&
    !!map.assignedInspector &&
    !!map.assignedQa &&
    (map.inspectorAssignAccepted !== true || map.qaAssignAccepted !== true)
  );
}

/** INTAKE maps the leader has not yet released — shown in NewMapsPanel only. */
export function isNewMapForLeader(map: MapRecord): boolean {
  return map.phase === "INTAKE" && map.releasedToPipeline !== true;
}

/**
 * Pipeline table rows: already past intake, OR intake maps the leader
 * "saved to pipeline" (releasedToPipeline) so they leave the new-maps box.
 */
export function isPipelineMapForLeader(map: MapRecord): boolean {
  return map.phase !== "INTAKE" || map.releasedToPipeline === true;
}

/** Returns true when the map lacks inspector assignment on intake. */
export function needsInspectorAssignment(map: MapRecord): boolean {
  return map.phase === "INTAKE" && !map.assignedInspector;
}

/** Returns true when the map still needs a QA assignee. */
export function needsQaAssignment(map: MapRecord): boolean {
  if (map.phase === "INTAKE") return !map.assignedQa;
  return canAssignQa(map) && !map.assignedQa;
}

/** Counts active prep/polish maps assigned to an inspector. */
export function countInspectorWorkload(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) =>
      m.assignedInspector?.id === userId &&
      ["PREP", "POLISH"].includes(m.phase)
  ).length;
}

/** Counts active QA-review maps assigned to a QA member. */
export function countQaWorkload(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) =>
      m.assignedQa?.id === userId &&
      (m.phase === "INTAKE" ||
        ["UPLOAD_REVIEW", "QA_REVIEW"].includes(m.phase) ||
        m.status === "FIX" ||
        m.status === "FIX_DONE")
  ).length;
}

export type AssignmentQueue =
  | "all"
  | "unassigned"
  | "needs_qa"
  | "in_progress"
  | "in_qa";

/**
 * AssignmentBoard queue tabs — filters released/pipeline maps only.
 * "needs_qa" / "unassigned" use the same helpers as the sidebar badges.
 */
export function matchesQueue(map: MapRecord, queue: AssignmentQueue): boolean {
  switch (queue) {
    case "all":
      return true;
    case "unassigned":
      return needsInspectorAssignment(map);
    case "needs_qa":
      return needsQaAssignment(map);
    case "in_progress":
      // Inspector-owned execution (prep polish) + client dashboard (FIELD)
      return ["PREP", "POLISH", "FIELD"].includes(map.phase);
    case "in_qa":
      return ["UPLOAD_REVIEW", "QA_REVIEW"].includes(map.phase);
    default:
      return true;
  }
}

/** Returns the inspector column label for a map. */
export function getInspectorLabel(map: MapRecord): string {
  return map.assignedInspector?.name ?? "Unassigned";
}

/** Returns the QA column label for a map. */
export function getQaLabel(map: MapRecord): string {
  if (map.phase === "INTAKE") {
    return map.assignedQa?.name ?? "Unassigned";
  }
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

/** Returns true when a map matches all active column filters. */
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

/** Leaders may delete any map except approved (kept as permanent record). */
export function canDeleteMap(map: MapRecord): boolean {
  return map.phase !== "APPROVED";
}

/** Builds the confirmation message for bulk map deletion. */
export function getBulkDeleteConfirmMessage(count: number): string {
  return `Permanently delete ${count} map${count !== 1 ? "s" : ""}? This cannot be undone.`;
}

/** Builds a context-aware confirmation message for deleting one map. */
export function getDeleteConfirmMessage(map: MapRecord): string {
  if (map.phase === "CANCELLED") {
    return `Permanently delete ${map.mapNumber}? This cannot be undone.`;
  }
  if (map.phase === "INTAKE" && map.releasedToPipeline !== true) {
    return `Delete ${map.mapNumber}? It has not been saved to the pipeline yet.`;
  }
  if (map.phase === "INTAKE") {
    return `Permanently delete ${map.mapNumber}? Team assignments will be removed.`;
  }
  return `Permanently delete ${map.mapNumber}? All tasks and history for this map will be removed. Consider cancelling instead if you want to keep a record.`;
}

/** Maps a display state string to a badge tone key. */
export function workflowStateTone(state: WorkflowDisplayState): string {
  switch (state) {
    case "Accepted":
      return "ACCEPTED";
    case "Processing":
      return "PROCESSING";
    case "Done":
      return "DONE";
    case "Fix":
      return "FIX";
    case "Fix Done":
      return "FIX_DONE";
    case "Approved":
      return "APPROVED";
    case "Cancelled":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}
