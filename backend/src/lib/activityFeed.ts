/** Activity feed item team — graphics (left) vs ops (right) in OPS manager Updates */
export type ActivityTeam = "graphics" | "ops";

/** Only milestones OPS manager cares about — not assignments or progress ticks */
export const MILESTONE_ACTIONS = [
  "upload_approved",
  "qa_approved",
  "fix_done",
  "field_complete",
  "hub_completed",
  "hub_uncompleted",
  "hub_cancelled",
] as const;

export type MilestoneAction = (typeof MILESTONE_ACTIONS)[number];

const GRAPHICS_MILESTONES = new Set<string>([
  "upload_approved",
  "qa_approved",
  "fix_done",
]);

const OPS_MILESTONES = new Set<string>([
  "field_complete",
  "hub_completed",
  "hub_uncompleted",
  "hub_cancelled",
]);

export function getActivityTeam(action: string): ActivityTeam {
  if (GRAPHICS_MILESTONES.has(action)) return "graphics";
  if (action === "inspector_done") return "graphics";
  return "ops";
}

export const ACTIVITY_LABELS: Record<string, string> = {
  upload_approved: "Upload stage complete",
  qa_approved: "Polish stage complete",
  fix_done: "Polish fixes complete",
  inspector_done: "Graphics work complete",
  field_complete: "Mapping accepted — sent to polish",
  hub_completed: "Field mapping complete",
  hub_uncompleted: "Field mapping incomplete",
  hub_cancelled: "Map cancelled",
};

export function getActivityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action.replace(/_/g, " ");
}

export function isMilestoneEvent(action: string, metadata: string | null): boolean {
  if ((MILESTONE_ACTIONS as readonly string[]).includes(action)) return true;
  if (action === "inspector_status" && metadata) {
    try {
      const parsed = JSON.parse(metadata) as { status?: string };
      return parsed.status === "DONE";
    } catch {
      return false;
    }
  }
  return false;
}

export function normalizeMilestoneAction(action: string, metadata: string | null): string {
  if (action === "inspector_status") return "inspector_done";
  return action;
}
