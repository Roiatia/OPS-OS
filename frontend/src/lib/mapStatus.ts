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

/** Returns the display label for a map status, or "—" if unset. */
export function mapStatusLabel(status: MapStatus | null | undefined): string {
  if (!status) return "—";
  return MAP_STATUS_LABELS[status];
}

/** Reads the shared status field from a map record. */
export function getMapStatusFromRecord(map: MapRecord): MapStatus | null {
  return map.status;
}
