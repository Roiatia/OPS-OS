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
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function poolMaps(maps: MapRecord[], onShiftSupervisorIds?: Set<string>): MapRecord[] {
  return maps.filter((m) => {
    if (m.fieldWorkStatus !== "UNCOMPLETED" || m.onHubStatusBoard) return false;
    if (!m.assignedSupervisor) return true;
    // Assigned to someone not on today's Hub → treat as intake so OPS can reassign
    if (onShiftSupervisorIds && !onShiftSupervisorIds.has(m.assignedSupervisor.id)) {
      return true;
    }
    return false;
  });
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
  opsManagerComment?: string | null;
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

export type HubDropExtras = {
  fieldProgressPercent?: number;
  opsManagerComment?: string | null;
  shiftLeaderApproved?: boolean | null;
  returnVisitAt?: string | null;
  fieldDate?: string | null;
};

export function applyHubDropLocally(
  map: MapRecord,
  zone: HubDropZone,
  supervisors: Array<{ id: string; name: string; email: string }>,
  extras?: HubDropExtras
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
  if (extras?.fieldProgressPercent !== undefined) {
    next.fieldProgressPercent = extras.fieldProgressPercent;
  }
  if (extras?.opsManagerComment !== undefined) {
    next.opsManagerComment = extras.opsManagerComment;
  }
  if (extras?.shiftLeaderApproved !== undefined) {
    next.shiftLeaderApproved = extras.shiftLeaderApproved;
  }
  if (extras?.returnVisitAt) {
    next.returnVisitAt = extras.returnVisitAt;
    next.fieldDate = extras.fieldDate ?? extras.returnVisitAt;
    next.onHubStatusBoard = false;
    next.fieldWorkStatus = "UNCOMPLETED";
    next.shiftLeaderApproved = null;
  }

  return next;
}

/** Completed without shift-leader approval — highlight on hub + maps table */
export function needsShiftLeaderReview(map: MapRecord): boolean {
  return map.fieldWorkStatus === "COMPLETED" && map.shiftLeaderApproved === false;
}

export function mapInHubZone(map: MapRecord, zone: HubDropZone): boolean {
  if (zone === "pool") return poolMaps([map]).length > 0;
  if (zone.startsWith("supervisor:")) {
    return supervisorMaps([map], zone.slice("supervisor:".length)).length > 0;
  }
  const status = zone.replace("status:", "") as FieldWorkStatus;
  return statusColumnMaps([map], status).length > 0;
}

/** Search like Updates — match map number, client, area, or supervisor name. */
export function filterHubMaps(maps: MapRecord[], query: string): MapRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return maps;
  return maps.filter((m) => {
    const haystack = [
      m.mapNumber,
      m.client,
      m.area ?? "",
      m.assignedSupervisor?.name ?? "",
      m.assignedInspector?.name ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export const HUB_DRAG_MIME = "application/x-oriient-map-id";
