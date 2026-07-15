export type ActivityTeam = "graphics" | "ops";

export interface OpsActivityMessage {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  team: ActivityTeam;
  user: { id: string; name: string };
  map: {
    id: string;
    mapNumber: string;
    client: string;
    mapperName: string | null;
    opsManagerComment: string | null;
    assignedInspector: { name: string } | null;
    assignedQa: { name: string } | null;
    assignedSupervisor: { name: string } | null;
  };
}

/** @deprecated use OpsActivityMessage */
export type HubNotification = OpsActivityMessage;

export interface OpsShiftAlert {
  id: string;
  type: "no_shift_leader";
  message: string;
  detail: string;
  createdAt: string;
  supervisorNames: string[];
}
