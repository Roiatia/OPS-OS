import type { Task, TaskStatus } from "@/types";
import { Badge } from "./Badge";

const TASK_STATUSES: TaskStatus[] = [
  "PENDING",
  "ACCEPTED",
  "PROCESSING",
  "DONE",
  "FIX",
  "FIX_DONE",
];

interface Props {
  tasks: Task[];
  mapNumber: string;
  canEdit: boolean;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
}

export function TaskTable({ tasks, mapNumber, canEdit, onStatusChange }: Props) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted py-4 text-center border border-dashed border-border rounded-lg">
        No tasks yet — team leader or QA can add tasks for the inspector.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-muted">
            <th className="px-4 py-3 font-medium">Map #</th>
            <th className="px-4 py-3 font-medium">Task</th>
            <th className="px-4 py-3 font-medium">Assigned to</th>
            <th className="px-4 py-3 font-medium">Phase</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tasks.map((t) => (
            <tr key={t.id} className="bg-card hover:bg-slate-50/50">
              <td className="px-4 py-3 font-mono text-xs">{mapNumber}</td>
              <td className="px-4 py-3">
                <div className="font-medium">{t.title}</div>
                {t.description && <div className="text-muted text-xs mt-0.5">{t.description}</div>}
              </td>
              <td className="px-4 py-3">{t.assignedTo?.name ?? "—"}</td>
              <td className="px-4 py-3">
                <Badge label={t.phase} tone={t.phase} />
              </td>
              <td className="px-4 py-3">
                {canEdit && onStatusChange ? (
                  <select
                    value={t.status}
                    onChange={(e) => onStatusChange(t.id, e.target.value as TaskStatus)}
                    className="text-sm border border-border rounded-lg px-2 py-1 bg-white"
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge label={t.status} tone={t.status} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
