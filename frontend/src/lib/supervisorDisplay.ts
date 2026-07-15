import type { FieldWorkStatus, MapRecord } from "../types";

export const FIELD_WORK_STATUS_LABELS: Record<FieldWorkStatus, string> = {
  UNCOMPLETED: "Uncompleted",
  COMPLETED: "Complete",
  CANCELLED: "Cancelled",
};

export type SupervisorMapQueue = "all" | "uncompleted" | "completed" | "cancelled";

export function getSupervisorFieldStatus(map: MapRecord): FieldWorkStatus {
  if (map.phase === "CANCELLED" || map.fieldWorkStatus === "CANCELLED") {
    return "CANCELLED";
  }
  if (map.fieldWorkStatus === "COMPLETED" || map.supervisorStatus === "DONE") {
    return "COMPLETED";
  }
  return "UNCOMPLETED";
}

export function matchesSupervisorQueue(map: MapRecord, queue: SupervisorMapQueue): boolean {
  const status = getSupervisorFieldStatus(map);
  switch (queue) {
    case "all":
      return true;
    case "uncompleted":
      return status === "UNCOMPLETED";
    case "completed":
      return status === "COMPLETED";
    case "cancelled":
      return status === "CANCELLED";
    default:
      return true;
  }
}

export function fieldWorkStatusTone(status: FieldWorkStatus): string {
  switch (status) {
    case "COMPLETED":
      return "DONE";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "PROCESSING";
  }
}

export function formatFieldDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatFieldDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toFieldDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function toFieldDateTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
