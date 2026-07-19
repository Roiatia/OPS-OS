import type { RoleName } from "./core";

export interface AvailabilityDay {
  id?: string;
  dayOfWeek: number;
  canWork: boolean;
  allDay: boolean;
  note: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  startMinutes2?: number | null;
  endMinutes2?: number | null;
  startTime: string | null;
  endTime: string | null;
  startTime2?: string | null;
  endTime2?: string | null;
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
  sundayOk: boolean;
  hagimOk: boolean;
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
  nightShifts: {
    thisWeek: number;
    priorWeek: number;
    twoWeekTotal: number;
    twoWeekLimit: number;
  };
}

export interface AvailabilityRosterEntry {
  user: {
    id: string;
    name: string;
    email: string;
    roles: RoleName[];
    isShiftLeader: boolean;
    fridayContract?: boolean;
    hagimOk?: boolean;
  };
  submission: AvailabilitySubmission | null;
}

export interface ShiftCoverageDay {
  dayOfWeek: number;
  label: string;
  supervisors: number;
  shiftLeaders: number;
  staffTotal: number;
  active: boolean;
  ok: boolean;
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
    shiftCoverageOk: boolean;
    shiftCoverageGaps: number;
  };
  shiftCoverageByDay: ShiftCoverageDay[];
  roster: AvailabilityRosterEntry[];
}

export interface ShiftPlanAssignment {
  dayOfWeek: number;
  userId: string;
  userName: string;
  isShiftLeader: boolean;
}

export interface ShiftPlanDay {
  dayOfWeek: number;
  label: string;
  mapsCount: number;
  staffNeeded: number;
  assignments: ShiftPlanAssignment[];
  ok: boolean;
  issues: string[];
  /** TEMPORARY auto-plan logic explainers — remove later */
  logicNotes?: string[];
}

export interface ShiftPlanStaff {
  userId: string;
  name: string;
  isShiftLeader: boolean;
  submitted: boolean;
  fridayContract?: boolean;
  hagimOk?: boolean;
  supervisorRating?: number | null;
  allowedClients?: string[];
  /** How many Sun–Fri days they marked available */
  daysOffered?: number;
  days: {
    dayOfWeek: number;
    canWork: boolean;
    allDay?: boolean;
    startMinutes?: number | null;
    endMinutes?: number | null;
    startMinutes2?: number | null;
    endMinutes2?: number | null;
    hoursLabel?: string;
  }[];
}

export interface ShiftPlanMap {
  id: string;
  mapNumber: string;
  client: string;
  fieldDate?: string | null;
  mapperName?: string | null;
  startMinutes?: number | null;
}

export interface ShiftPlanView {
  weekStart: string;
  weekLabel: string;
  mapsPerDay: { dayOfWeek: number; count: number; maps: ShiftPlanMap[] }[];
  staff: ShiftPlanStaff[];
  assignments: ShiftPlanAssignment[];
  dayPlans: ShiftPlanDay[];
  warnings: string[];
  saved: boolean;
  published: boolean;
  publishedAt: string | null;
}

export interface ShiftPlanSaveResult {
  assignments: ShiftPlanAssignment[];
  dayPlans: ShiftPlanDay[];
  warnings: string[];
  saved: boolean;
  published?: boolean;
  publishedAt?: string | null;
}

export interface PublishedScheduleView {
  weekStart: string;
  weekLabel: string;
  published: boolean;
  publishedAt: string | null;
  mapsPerDay: { dayOfWeek: number; count: number; maps: { id: string; mapNumber: string; client: string }[] }[];
  assignments: ShiftPlanAssignment[];
  dayPlans: ShiftPlanDay[];
  warnings: string[];
  viewerUserId: string;
}

export type ShiftChangeStatus =
  | "PENDING_COUNTERPART"
  | "PENDING_OPS"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED";

export interface ShiftChangeCandidate {
  userId: string;
  name: string;
  email: string;
  isShiftLeader: boolean;
  hoursLabel: string | null;
}

export interface ShiftChangeRequest {
  id: string;
  planId: string;
  weekStart: string;
  dayOfWeek: number;
  status: ShiftChangeStatus;
  note: string | null;
  counterpartAt: string | null;
  opsAt: string | null;
  createdAt: string;
  fromUser: { id: string; name: string; email: string };
  toUser: { id: string; name: string; email: string };
  opsBy: { id: string; name: string; email: string } | null;
}

export interface ShiftChangeList {
  weekStart: string;
  incoming: ShiftChangeRequest[];
  outgoing: ShiftChangeRequest[];
  pendingOps: ShiftChangeRequest[];
}
