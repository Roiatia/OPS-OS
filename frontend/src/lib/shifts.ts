import type { TeamMember } from "../types";

export type ShiftId = "morning" | "afternoon" | "night";

export interface ShiftDefinition {
  id: ShiftId;
  label: string;
  hours: string;
  /** Demo users on this shift (matched by email) */
  memberEmails: string[];
}

export const SHIFTS: ShiftDefinition[] = [
  {
    id: "morning",
    label: "Morning",
    hours: "06:00 – 14:00",
    memberEmails: ["inspector@ops-demo.local", "inspector2@ops-demo.local"],
  },
  {
    id: "afternoon",
    label: "Afternoon",
    hours: "14:00 – 22:00",
    memberEmails: ["inspector3@ops-demo.local"],
  },
  {
    id: "night",
    label: "Night",
    hours: "22:00 – 06:00",
    memberEmails: ["inspector4@ops-demo.local"],
  },
];

export function getShiftMembers(team: TeamMember[], shiftId: ShiftId): TeamMember[] {
  const shift = SHIFTS.find((s) => s.id === shiftId);
  if (!shift) return [];
  return team.filter((m) => shift.memberEmails.includes(m.email));
}

export function getShiftInspectors(team: TeamMember[], shiftId: ShiftId) {
  return getShiftMembers(team, shiftId).filter((m) =>
    m.roles.some((r) => r.role === "MAPPING_INSPECTOR")
  );
}

export function getShiftQaMembers(team: TeamMember[], shiftId: ShiftId) {
  return getShiftMembers(team, shiftId).filter((m) =>
    m.roles.some((r) => r.role === "GRAPHIC_QA")
  );
}
