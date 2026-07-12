export type RoleName =
  | "GRAPHIC_TEAM_LEADER"
  | "MAPPING_INSPECTOR"
  | "GRAPHIC_QA"
  | "OPS_ADMIN";

export type MapPhase =
  | "INTAKE"
  | "PREP"
  | "UPLOAD_REVIEW"
  | "FIELD"
  | "POLISH"
  | "QA_REVIEW"
  | "APPROVED"
  | "CANCELLED";

export type WorkflowPhaseTarget = "PRE_UPLOAD" | "UPLOADED" | "POLISH" | "POLISHED";

export type MapStatus =
  | "ACCEPTED"
  | "PROCESSING"
  | "DONE"
  | "FIX"
  | "FIX_DONE"
  | "APPROVED";

export type TaskStatus = "PENDING" | "ACCEPTED" | "PROCESSING" | "DONE" | "FIX" | "FIX_DONE";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: RoleName[];
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  phase: MapPhase;
  assignedTo: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
}

export interface MapEvent {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  user: { id: string; name: string };
}

export interface PhaseHistoryEntry {
  id: string;
  phase: MapPhase;
  enteredAt: string;
  note: string | null;
  user: { id: string; name: string };
}

export interface MapAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  /** Omitted on list endpoints to keep payloads small. */
  data?: string;
  context: string;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

export interface MapNote {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string };
}

export interface MapRecord {
  id: string;
  mapNumber: string;
  jiraTicketId: string | null;
  client: string;
  area: string | null;
  description: string | null;
  dueDate: string | null;
  phase: MapPhase;
  status: MapStatus | null;
  inspectorAssignAccepted: boolean;
  qaAssignAccepted: boolean;
  releasedToPipeline: boolean;
  workflowPhaseTarget: WorkflowPhaseTarget;
  uploadApproved: boolean;
  /** Spreadsheet fields — stored from CSV import; not shown in table UI yet */
  batch?: string | null;
  building?: string | null;
  address?: string | null;
  mapReceived?: string | null;
  setupStage?: string | null;
  mapperSource?: string | null;
  mapperName?: string | null;
  scheduleDate?: string | null;
  mappingDate?: string | null;
  postMappingDate?: string | null;
  sentToStudio?: string | null;
  receivedFromStudio?: string | null;
  graphicsPolishAssignee?: string | null;
  graphicsPolishStatus?: string | null;
  polishQaAssignee?: string | null;
  conversion?: string | null;
  polishStage?: string | null;
  activation?: string | null;
  remappingDate?: string | null;
  dashboardDate?: string | null;
  maintDate?: string | null;
  commentExternal?: string | null;
  commentInternal?: string | null;
  assignedInspector: { id: string; name: string; email: string } | null;
  assignedQa: { id: string; name: string; email: string } | null;
  tasks: Task[];
  events: MapEvent[];
  phaseHistory: PhaseHistoryEntry[];
  attachments: MapAttachment[];
  notes: MapNote[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  roles: { role: RoleName }[];
}

export const ROLE_LABELS: Record<RoleName, string> = {
  GRAPHIC_TEAM_LEADER: "Graphic Team Leader",
  MAPPING_INSPECTOR: "Mapping Inspector",
  GRAPHIC_QA: "Graphic QA",
  OPS_ADMIN: "OPS Admin",
};

export const PHASE_LABELS: Record<MapPhase, string> = {
  INTAKE: "Pre-upload · Awaiting assign",
  PREP: "Pre-upload · Inspector",
  UPLOAD_REVIEW: "Pre-upload · QA",
  FIELD: "Uploaded to dashboard",
  POLISH: "Polish · Inspector",
  QA_REVIEW: "Polish · QA",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

/** @deprecated Timeline UI uses WORKFLOW_TIMELINE in mapDisplay.ts */
export const PHASE_ORDER: MapPhase[] = [
  "INTAKE",
  "PREP",
  "UPLOAD_REVIEW",
  "FIELD",
  "POLISH",
  "QA_REVIEW",
  "APPROVED",
];
