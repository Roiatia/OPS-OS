export type DueDateStatus = "none" | "ok" | "soon" | "overdue";

export function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getDueDateStatus(dueDate: string | null): DueDateStatus {
  if (!dueDate) return "none";

  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (due < today) return "overdue";

  const soon = new Date(today);
  soon.setDate(soon.getDate() + 2);
  if (due <= soon) return "soon";

  return "ok";
}

export const DUE_DATE_CLASS: Record<DueDateStatus, string> = {
  none: "text-slate-400",
  ok: "text-slate-700",
  soon: "text-amber-700 font-medium",
  overdue: "text-red-700 font-semibold",
};
