import type { MapRecord, TeamMember, RoleName } from "../../types";

/**
 * Build a valid MapRecord with sensible defaults so each test only sets the
 * few fields it cares about. Defaults describe a brand-new, unassigned map.
 */
export function makeMap(overrides: Partial<MapRecord> = {}): MapRecord {
  const base: MapRecord = {
    id: "map-1",
    mapNumber: "MAP-2024-0001",
    jiraTicketId: null,
    client: "Acme",
    area: null,
    description: null,
    dueDate: null,
    fieldDate: null,
    loomDone: false,
    positioning: false,
    mapperName: null,
    opsManagerComment: null,
    fieldWorkStatus: "UNCOMPLETED",
    fieldProgressPercent: 0,
    onHubStatusBoard: false,
    shiftLeaderApproved: null,
    returnVisitAt: null,
    phase: "INTAKE",
    inspectorStatus: null,
    supervisorStatus: null,
    qaStatus: null,
    uploadApproved: false,
    uploadCompletedAt: null,
    releasedToGraphics: false,
    assignedInspector: null,
    assignedQa: null,
    assignedSupervisor: null,
    tasks: [],
    events: [],
    phaseHistory: [],
    attachments: [],
    notes: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

/** Minimal person relation for the assigned* fields. */
export function makePerson(id: string, name = id, email = `${id}@test.local`) {
  return { id, name, email };
}

/** Build a TeamMember with the given roles. */
export function makeTeamMember(
  id: string,
  roles: RoleName[],
  name = id
): TeamMember {
  return {
    id,
    name,
    email: `${id}@test.local`,
    roles: roles.map((role) => ({ role })),
  };
}
