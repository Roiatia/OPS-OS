import type { OpsActivityMessage, OpsShiftAlert } from "../types/activity";

export type ActivityTeam = "graphics" | "ops";

const GRAPHICS_MILESTONES = new Set([
  "upload_approved",
  "qa_approved",
  "fix_done",
  "inspector_done",
]);

export function getActivityTeam(action: string): ActivityTeam {
  if (GRAPHICS_MILESTONES.has(action)) return "graphics";
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

/** @deprecated use getActivityLabel */
export function hubMessageLabel(action: string): string {
  return getActivityLabel(action);
}

/** Reason text for incomplete maps — from event note or map comment */
export function getIncompleteReason(message: OpsActivityMessage): string | null {
  if (message.action !== "hub_uncompleted") return null;
  const fromNote = message.note?.includes("—")
    ? message.note.split("—").slice(1).join("—").trim()
    : null;
  const raw = fromNote || message.map.opsManagerComment?.trim() || null;
  if (!raw) return null;
  // Strip leading "50% done · " so OPS sees the human reason cleanly
  const withoutPct = raw.replace(/^\d{1,3}\s*%\s*done\s*(?:·|-)?\s*/i, "").trim();
  return withoutPct || null;
}

/** Progress % embedded in incomplete notes like "… — 50% done · reason" */
export function getIncompleteProgress(message: OpsActivityMessage): number | null {
  if (message.action !== "hub_uncompleted") return null;
  const hay = `${message.note ?? ""} ${message.map.opsManagerComment ?? ""}`;
  const match = hay.match(/(\d{1,3})\s*%\s*done/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

export function activitySearchHaystack(message: OpsActivityMessage): string {
  return [
    message.map.mapNumber,
    message.map.client,
    message.map.mapperName,
    message.map.opsManagerComment,
    message.map.assignedSupervisor?.name,
    message.user.name,
    message.note,
    getActivityLabel(message.action),
    getIncompleteReason(message),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterActivityMessages(
  messages: OpsActivityMessage[],
  query: string
): OpsActivityMessage[] {
  const q = query.trim().toLowerCase();
  if (!q) return messages;
  return messages.filter((m) => activitySearchHaystack(m).includes(q));
}

export function filterShiftAlerts(alerts: OpsShiftAlert[], query: string): OpsShiftAlert[] {
  const q = query.trim().toLowerCase();
  if (!q) return alerts;
  return alerts.filter((a) =>
    [a.message, a.detail, ...(a.supervisorNames ?? [])].join(" ").toLowerCase().includes(q)
  );
}

export function splitByTeam(messages: OpsActivityMessage[]): {
  graphics: OpsActivityMessage[];
  ops: OpsActivityMessage[];
} {
  const graphics: OpsActivityMessage[] = [];
  const ops: OpsActivityMessage[] = [];
  for (const m of messages) {
    const team = m.team ?? getActivityTeam(m.action);
    if (team === "graphics") graphics.push(m);
    else ops.push(m);
  }
  return { graphics, ops };
}

export function isCompleteMilestone(action: string): boolean {
  return (
    action === "hub_completed" ||
    action === "upload_approved" ||
    action === "qa_approved" ||
    action === "fix_done" ||
    action === "inspector_done" ||
    action === "field_complete"
  );
}

export function isIncompleteMilestone(action: string): boolean {
  return action === "hub_uncompleted";
}
