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

export type InspectorStatus = "ACCEPTED" | "PROCESSING" | "DONE";
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
  data: string;
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
  inspectorStatus: InspectorStatus | null;
  qaStatus: QaStatus | null;
  uploadApproved: boolean;
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
