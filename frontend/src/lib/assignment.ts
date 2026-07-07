import { countQaWorkload } from "./mapDisplay";
import type { MapPhase, MapRecord, TeamMember } from "../types";

export interface MapAssignment {
  mapId: string;
  inspectorId: string;
}

export interface QaAssignment {
  mapId: string;
  qaId: string;
}

export interface ShufflePreviewRow {
  inspectorId: string;
  inspectorName: string;
  currentActive: number;
  receiving: number;
  totalAfter: number;
}

const ARCHIVED: MapPhase[] = ["APPROVED", "CANCELLED"];

/** All active maps where the user is the assigned inspector. */
export function countInspectorActiveMaps(maps: MapRecord[], userId: string): number {
  return maps.filter(
    (m) =>
      !ARCHIVED.includes(m.phase) &&
      m.assignedInspector?.id === userId
  ).length;
}

/**
 * Balanced distribution: each map goes to the inspector with the fewest total
 * active maps (existing workload + maps already assigned in this batch).
 */
export function buildBalancedInspectorAssignments(
  mapsToAssign: MapRecord[],
  inspectors: Pick<TeamMember, "id" | "name">[],
  allMaps: MapRecord[]
): MapAssignment[] {
  if (inspectors.length === 0 || mapsToAssign.length === 0) return [];

  const workload = new Map<string, number>();
  for (const inspector of inspectors) {
    workload.set(inspector.id, countInspectorActiveMaps(allMaps, inspector.id));
  }

  const assignments: MapAssignment[] = [];
  for (const map of mapsToAssign) {
    const sorted = [...inspectors].sort((a, b) => {
      const diff = (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
    const pick = sorted[0]!;
    const next = (workload.get(pick.id) ?? 0) + 1;
    workload.set(pick.id, next);
    assignments.push({ mapId: map.id, inspectorId: pick.id });
  }

  return assignments;
}

export function buildBalancedQaAssignments(
  mapsToAssign: MapRecord[],
  qaMembers: Pick<TeamMember, "id" | "name">[],
  allMaps: MapRecord[]
): QaAssignment[] {
  if (qaMembers.length === 0 || mapsToAssign.length === 0) return [];

  const workload = new Map<string, number>();
  for (const member of qaMembers) {
    workload.set(member.id, countQaActiveMaps(allMaps, member.id));
  }

  const assignments: QaAssignment[] = [];
  for (const map of mapsToAssign) {
    const sorted = [...qaMembers].sort((a, b) => {
      const diff = (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
    const pick = sorted[0]!;
    workload.set(pick.id, (workload.get(pick.id) ?? 0) + 1);
    assignments.push({ mapId: map.id, qaId: pick.id });
  }

  return assignments;
}

export function summarizeQaShufflePlan(
  plan: QaAssignment[],
  qaMembers: Pick<TeamMember, "id" | "name">[],
  allMaps: MapRecord[]
): ShufflePreviewRow[] {
  const receiving = new Map<string, number>();
  for (const { qaId } of plan) {
    receiving.set(qaId, (receiving.get(qaId) ?? 0) + 1);
  }

  return qaMembers
    .map((member) => {
      const currentActive = countQaActiveMaps(allMaps, member.id);
      const add = receiving.get(member.id) ?? 0;
      return {
        inspectorId: member.id,
        inspectorName: member.name,
        currentActive,
        receiving: add,
        totalAfter: currentActive + add,
      };
    })
    .sort((a, b) => a.totalAfter - b.totalAfter || a.inspectorName.localeCompare(b.inspectorName));
}

export function summarizeShufflePlan(
  plan: MapAssignment[],
  inspectors: Pick<TeamMember, "id" | "name">[],
  allMaps: MapRecord[]
): ShufflePreviewRow[] {
  const receiving = new Map<string, number>();
  for (const { inspectorId } of plan) {
    receiving.set(inspectorId, (receiving.get(inspectorId) ?? 0) + 1);
  }

  return inspectors
    .map((inspector) => {
      const currentActive = countInspectorActiveMaps(allMaps, inspector.id);
      const add = receiving.get(inspector.id) ?? 0;
      return {
        inspectorId: inspector.id,
        inspectorName: inspector.name,
        currentActive,
        receiving: add,
        totalAfter: currentActive + add,
      };
    })
    .sort((a, b) => a.totalAfter - b.totalAfter || a.inspectorName.localeCompare(b.inspectorName));
}

export function pickLeastLoadedInspector(
  inspectorIds: string[],
  allMaps: MapRecord[]
): string | null {
  if (inspectorIds.length === 0) return null;

  let pick = inspectorIds[0]!;
  let min = countInspectorActiveMaps(allMaps, pick);

  for (const id of inspectorIds) {
    const count = countInspectorActiveMaps(allMaps, id);
    if (count < min) {
      min = count;
      pick = id;
    }
  }

  return pick;
}

const IDLE_THRESHOLD = 1;

export interface IdleTeamMember {
  member: TeamMember;
  activeCount: number;
}

/** Inspectors with at most one active map — flagged so leaders can keep everyone busy. */
export function getIdleInspectors(team: TeamMember[], maps: MapRecord[]): IdleTeamMember[] {
  return team
    .filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"))
    .map((member) => ({
      member,
      activeCount: countInspectorActiveMaps(maps, member.id),
    }))
    .filter(({ activeCount }) => activeCount <= IDLE_THRESHOLD)
    .sort((a, b) => a.activeCount - b.activeCount);
}

/** Active maps where the user is the assigned QA reviewer. */
export function countQaActiveMaps(maps: MapRecord[], userId: string): number {
  return countQaWorkload(maps, userId);
}

export function pickLeastLoadedQa(qaIds: string[], allMaps: MapRecord[]): string | null {
  if (qaIds.length === 0) return null;

  let pick = qaIds[0]!;
  let min = countQaActiveMaps(allMaps, pick);

  for (const id of qaIds) {
    const count = countQaActiveMaps(allMaps, id);
    if (count < min) {
      min = count;
      pick = id;
    }
  }

  return pick;
}

/** QA members with at most one active map — flagged so leaders can keep everyone busy. */
export function getIdleQaMembers(team: TeamMember[], maps: MapRecord[]): IdleTeamMember[] {
  return team
    .filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"))
    .map((member) => ({
      member,
      activeCount: countQaActiveMaps(maps, member.id),
    }))
    .filter(({ activeCount }) => activeCount <= IDLE_THRESHOLD)
    .sort((a, b) => a.activeCount - b.activeCount);
}
