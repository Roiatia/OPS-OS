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
};

export function getMapStation(map: MapRecord): string {
  return STATION_LABELS[map.phase];
}

export function getMapState(map: MapRecord): string {
  const { phase, inspectorStatus, qaStatus } = map;

  if (phase === "INTAKE") return "Awaiting assignment";
  if (phase === "APPROVED") return "Approved";

  if (qaStatus === "FIX") return "Fix required";
  if (qaStatus === "FIX_DONE") return "Fix submitted — under examination";

  if (phase === "UPLOAD_REVIEW" || (phase === "QA_REVIEW" && !qaStatus)) {
    return "Under examination";
  }

  if (phase === "FIELD") return "In field";
  if (phase === "PREP" || phase === "POLISH") {
    if (inspectorStatus === "ACCEPTED") return "Accepted";
    if (inspectorStatus === "PROCESSING") return "In progress";
    if (inspectorStatus === "DONE") return "Submitted for review";
    return "Not started";
  }

  if (qaStatus === "APPROVED") return "Approved";

  return "—";
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
