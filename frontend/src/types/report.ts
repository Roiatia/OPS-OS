export interface OpsDailyReportMapItem {
  mapId: string;
  mapNumber: string;
  client: string;
  supervisorName: string | null;
  reason: string | null;
}

export interface OpsDailyReportMilestone {
  action: string;
  label: string;
  mapNumber: string;
  client: string;
  userName: string;
  at: string;
  note: string | null;
}

export interface OpsDailyReportShiftMember {
  id: string;
  name: string;
  isShiftLeader: boolean;
  shiftStartedAt: string | null;
}

export interface OpsDailyReportTeamMember {
  id: string;
  name: string;
  role: string;
}

export interface OpsDailyReportHubMapsSummary {
  total: number;
  completed: number;
  incomplete: number;
  cancelled: number;
  active: number;
  intake: number;
  /** Full Hub day CSV — prefer downloading via API rather than rendering. */
  csv?: string;
}

export interface OpsDailyReportPayload {
  reportDate: string;
  shift: {
    members: OpsDailyReportShiftMember[];
    shiftLeaderCount: number;
    hadShiftLeader: boolean;
  };
  /** Everyone who worked that day — field ops shift + graphics + OPS managers active in CRM */
  team: {
    field: OpsDailyReportTeamMember[];
    graphics: OpsDailyReportTeamMember[];
    ops: OpsDailyReportTeamMember[];
  };
  field: {
    completed: OpsDailyReportMapItem[];
    incomplete: OpsDailyReportMapItem[];
    cancelled: OpsDailyReportMapItem[];
  };
  /** Hub maps for this report day + downloadable CSV snapshot. */
  hubMaps?: OpsDailyReportHubMapsSummary;
  graphics: {
    milestones: OpsDailyReportMilestone[];
  };
  ops: {
    acceptedToPolish: OpsDailyReportMilestone[];
  };
  pipeline: {
    totalMaps: number;
    newFromCs: number;
    atGraphics: number;
    inField: number;
    readyToAccept: number;
    approved: number;
  };
  alerts: string[];
  /** Free-text OPS Manager note for future recall of this shift day */
  opsManagerNote: string | null;
}

export interface OpsDailyReportListItem {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  generatedAt: string;
  fieldCompleted: number;
  fieldIncomplete: number;
  fieldCancelled: number;
  shiftLeaderCount: number;
}

export interface OpsDailyReportDetail extends OpsDailyReportListItem {
  payload: OpsDailyReportPayload;
}
