import type { FieldWorkStatus, MapRecord } from "../types";

export type HubDropZone =
  | "pool"
  | `supervisor:${string}`
  | "status:UNCOMPLETED"
  | "status:COMPLETED"
  | "status:CANCELLED";

const PROGRESS_STEPS = [0, 25, 50, 75, 100];

export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

export function formatShiftStart(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMapTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function poolMaps(maps: MapRecord[]): MapRecord[] {
  return maps.filter(
    (m) =>
      !m.assignedSupervisor &&
      m.fieldWorkStatus === "UNCOMPLETED" &&
      !m.onHubStatusBoard
  );
}

export function supervisorMaps(maps: MapRecord[], supervisorId: string): MapRecord[] {
  return maps.filter((m) => {
    if (m.assignedSupervisor?.id !== supervisorId) return false;
    if (m.fieldWorkStatus === "CANCELLED") return false;
    return !m.onHubStatusBoard;
  });
}

export function statusColumnMaps(maps: MapRecord[], status: FieldWorkStatus): MapRecord[] {
  return maps.filter((m) => m.onHubStatusBoard && m.fieldWorkStatus === status);
}

export function nextProgress(current: number): number {
  const idx = PROGRESS_STEPS.indexOf(current);
  if (idx === -1) return 25;
  return PROGRESS_STEPS[(idx + 1) % PROGRESS_STEPS.length]!;
}

export function hubDropPayload(zone: HubDropZone): {
  assignedSupervisorId?: string | null;
  fieldWorkStatus?: FieldWorkStatus;
  onHubStatusBoard?: boolean;
  fieldProgressPercent?: number;
} {
  if (zone === "pool") {
    return { assignedSupervisorId: null, onHubStatusBoard: false, fieldWorkStatus: "UNCOMPLETED" };
  }
  if (zone.startsWith("supervisor:")) {
    const id = zone.slice("supervisor:".length);
    return {
      assignedSupervisorId: id,
      onHubStatusBoard: false,
      fieldWorkStatus: "UNCOMPLETED",
    };
  }
  if (zone === "status:COMPLETED") {
    return { fieldWorkStatus: "COMPLETED", onHubStatusBoard: true, fieldProgressPercent: 100 };
  }
  if (zone === "status:CANCELLED") {
    return { fieldWorkStatus: "CANCELLED", onHubStatusBoard: true };
  }
  return { fieldWorkStatus: "UNCOMPLETED", onHubStatusBoard: true };
}

export function applyHubDropLocally(
  map: MapRecord,
  zone: HubDropZone,
  supervisors: Array<{ id: string; name: string; email: string }>
): MapRecord {
  const payload = hubDropPayload(zone);
  const next: MapRecord = { ...map };

  if (payload.assignedSupervisorId !== undefined) {
    if (payload.assignedSupervisorId === null) {
      next.assignedSupervisor = null;
    } else {
      const sup = supervisors.find((s) => s.id === payload.assignedSupervisorId);
      next.assignedSupervisor = sup
        ? { id: sup.id, name: sup.name, email: sup.email }
        : map.assignedSupervisor;
    }
  }
  if (payload.fieldWorkStatus !== undefined) next.fieldWorkStatus = payload.fieldWorkStatus;
  if (payload.onHubStatusBoard !== undefined) next.onHubStatusBoard = payload.onHubStatusBoard;
  if (payload.fieldProgressPercent !== undefined) {
    next.fieldProgressPercent = payload.fieldProgressPercent;
  }

  return next;
}

export function mapInHubZone(map: MapRecord, zone: HubDropZone): boolean {
  if (zone === "pool") return poolMaps([map]).length > 0;
  if (zone.startsWith("supervisor:")) {
    return supervisorMaps([map], zone.slice("supervisor:".length)).length > 0;
  }
  const status = zone.replace("status:", "") as FieldWorkStatus;
  return statusColumnMaps([map], status).length > 0;
}

export const HUB_DRAG_MIME = "application/x-oriient-map-id";
