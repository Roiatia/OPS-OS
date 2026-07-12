import type { RoleName } from "../types";

export interface AvailabilityDay {
  id?: string;
  dayOfWeek: number;
  canWork: boolean;
  allDay: boolean;
  note: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  startTime: string | null;
  endTime: string | null;
  durationHours: number | null;
  isNight: boolean;
}

export interface AvailabilityShift {
  id?: string;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  durationHours: number;
  isNight: boolean;
  note?: string | null;
}

export interface AvailabilitySubmission {
  id: string;
  weekStart: string;
  fridayContract: boolean;
  note: string | null;
  submittedAt: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    roles: RoleName[];
  };
  days: AvailabilityDay[];
  shifts: AvailabilityShift[];
}

export interface AvailabilityRosterEntry {
  user: {
    id: string;
    name: string;
    email: string;
    roles: RoleName[];
    isShiftLeader: boolean;
  };
  submission: AvailabilitySubmission | null;
}

export interface AvailabilityRoster {
  weekStart: string;
  weekEnd: string;
  stats: {
    supervisorsTotal: number;
    submitted: number;
    missing: number;
    mapsScheduled: number;
    totalNightShifts: number;
    suggestedSupervisorsNeeded: number;
  };
  roster: AvailabilityRosterEntry[];
}
