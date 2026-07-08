import type { MapStatus, MapRecord } from "../types";

export const MAP_STATUS_LABELS: Record<MapStatus, string> = {
  ACCEPTED: "Accepted",
  PROCESSING: "Processing",
  DONE: "Done",
  FIX: "Fix",
  FIX_DONE: "Fix Done",
  APPROVED: "Approved",
};

export const MAP_STATUS_VALUES: MapStatus[] = [
  "ACCEPTED",
  "PROCESSING",
  "DONE",
  "FIX",
  "FIX_DONE",
  "APPROVED",
];

export function mapStatusLabel(status: MapStatus | null | undefined): string {
  if (!status) return "—";
  return MAP_STATUS_LABELS[status];
}

export function getMapStatusFromRecord(map: MapRecord): MapStatus | null {
  return map.status;
}
