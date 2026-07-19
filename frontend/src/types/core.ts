export type RoleName =
  | "GRAPHIC_TEAM_LEADER"
  | "MAPPING_INSPECTOR"
  | "GRAPHIC_QA"
  | "SUPERVISOR"
  | "SUPERVISOR_SHIFT_LEADER"
  | "OPS_ADMIN"
  | "OPS_MANAGER_2";

export type MapPhase =
  | "INTAKE"
  | "PREP"
  | "UPLOAD_REVIEW"
  | "FIELD"
  | "POLISH"
  | "QA_REVIEW"
  | "APPROVED"
  | "CANCELLED";

export type InspectorStatus = "ACCEPTED" | "PROCESSING" | "DONE";
export type SupervisorStatus = "ACCEPTED" | "PROCESSING" | "DONE";
export type FieldWorkStatus = "UNCOMPLETED" | "COMPLETED" | "CANCELLED";
export type QaStatus = "FIX" | "FIX_DONE" | "APPROVED";
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
  /** Base64 payload — only present in the detail shape; omitted from list shapes. */
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
  fieldDate: string | null;
  loomDone: boolean;
  positioning: boolean;
  mapperName: string | null;
  opsManagerComment: string | null;
  fieldWorkStatus: FieldWorkStatus;
  fieldProgressPercent: number;
  onHubStatusBoard: boolean;
  /** null = N/A; false = completed without shift-leader approval (highlight) */
  shiftLeaderApproved?: boolean | null;
  returnVisitAt?: string | null;
  slCheckStatus?: "OPEN" | "CLAIMED" | "ACCEPTED" | "NEEDS_CORRECTIONS" | null;
  slCheckRequestedAt?: string | null;
  slCheckClaimedAt?: string | null;
  slCheckNote?: string | null;
  slCheckRequestedBy?: { id: string; name: string } | null;
  slCheckClaimedBy?: { id: string; name: string } | null;
  swapBatchId?: string | null;
  swapOfferedAt?: string | null;
  swapOfferedBy?: { id: string; name: string } | null;
  helpAskBatchId?: string | null;
  helpAskAt?: string | null;
  helpAskBy?: { id: string; name: string } | null;
  phase: MapPhase;
  inspectorStatus: InspectorStatus | null;
  supervisorStatus: SupervisorStatus | null;
  qaStatus: QaStatus | null;
  uploadApproved: boolean;
  uploadCompletedAt: string | null;
  releasedToGraphics: boolean;
  assignedInspector: { id: string; name: string; email: string } | null;
  assignedQa: { id: string; name: string; email: string } | null;
  assignedSupervisor: { id: string; name: string; email: string } | null;
  tasks: Task[];
  events: MapEvent[];
  phaseHistory: PhaseHistoryEntry[];
  attachments: MapAttachment[];
  notes: MapNote[];
  createdAt: string;
  updatedAt: string;
}

export interface HubSupervisor {
  id: string;
  name: string;
  email: string;
  shiftStartedAt: string | null;
  roles: { role: RoleName }[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  shiftStartedAt?: string | null;
  roles: { role: RoleName }[];
}

export const ROLE_LABELS: Record<RoleName, string> = {
  GRAPHIC_TEAM_LEADER: "Graphic Team Leader",
  MAPPING_INSPECTOR: "Mapping Inspector",
  GRAPHIC_QA: "Graphic QA",
  SUPERVISOR: "Supervisor",
  SUPERVISOR_SHIFT_LEADER: "Supervisor Shift Leader",
  OPS_ADMIN: "OPS Manager",
  OPS_MANAGER_2: "OPS Manager 2",
};

export const PHASE_LABELS: Record<MapPhase, string> = {
  INTAKE: "Intake",
  PREP: "Initial Prep",
  UPLOAD_REVIEW: "Upload Approval",
  FIELD: "Field Work",
  POLISH: "Polish",
  QA_REVIEW: "QA Review",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

export const PHASE_ORDER: MapPhase[] = [
  "INTAKE",
  "PREP",
  "UPLOAD_REVIEW",
  "FIELD",
  "POLISH",
  "QA_REVIEW",
  "APPROVED",
];
