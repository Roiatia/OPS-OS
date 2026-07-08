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

export interface OpsDailyReportPayload {
  reportDate: string;
  shift: {
    members: OpsDailyReportShiftMember[];
    shiftLeaderCount: number;
    hadShiftLeader: boolean;
  };
  field: {
    completed: OpsDailyReportMapItem[];
    incomplete: OpsDailyReportMapItem[];
    cancelled: OpsDailyReportMapItem[];
  };
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
}

export interface OpsDailyReportListItem {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  generatedAt: string;
  fieldCompleted: number;
  fieldIncomplete: number;
  shiftLeaderCount: number;
}

export interface OpsDailyReportDetail extends OpsDailyReportListItem {
  payload: OpsDailyReportPayload;
}
