import type { MapPhase } from "../types";
import {
  WORKFLOW_TIMELINE,
  getTimelineHistoryEntry,
  getWorkflowTimelineIndex,
  getWorkflowTimelinePhase,
  type TimelineHistoryEntry,
} from "../lib/mapDisplay";

/** Formats a timeline timestamp for display. */
function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Horizontal or vertical workflow timeline with phase history. */
export function PhaseStepper({
  current,
  phaseHistory,
  variant = "horizontal",
}: {
  current: MapPhase;
  phaseHistory: TimelineHistoryEntry[];
  variant?: "horizontal" | "vertical";
}) {
  const currentIdx = getWorkflowTimelineIndex(current);
  const activeTimelinePhase = getWorkflowTimelinePhase(current);

  if (variant === "vertical") {
    const steps = [...WORKFLOW_TIMELINE];
    const showCancelled = current === "CANCELLED";

    return (
      <ol className="relative space-y-0">
        {steps.map((step, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const active = step.id === activeTimelinePhase && current !== "APPROVED";
          const complete = current === "APPROVED" && i < steps.length;
          const entry = getTimelineHistoryEntry(step.id, phaseHistory);
          const isLast = i === steps.length - 1 && !showCancelled;

          return (
            <li key={step.id} className="relative flex gap-4 pb-8 last:pb-0">
              {!isLast && (
                <span
                  className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${
                    done || complete || active ? "bg-brand-300" : "bg-slate-200"
                  }`}
                />
              )}
              <div
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  active
                    ? "bg-brand-600 text-white ring-4 ring-brand-100"
                    : done || complete
                      ? "bg-brand-100 text-brand-700"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {done || complete ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p
                  className={`text-sm font-semibold ${
                    active
                      ? "text-brand-700"
                      : done || complete
                        ? "text-slate-800"
                        : "text-slate-400"
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted mt-0.5">{step.hint}</p>
                {entry ? (
                  <div className="mt-1">
                    <p className="text-xs text-muted">{formatDate(entry.enteredAt)}</p>
                    <p className="text-xs font-medium text-slate-600">{entry.user.name}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-300 mt-1">Pending</p>
                )}
              </div>
            </li>
          );
        })}
        {showCancelled && (
          <li className="relative flex gap-4">
            <div className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold bg-red-100 text-red-700">
              ✕
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-red-700">Cancelled</p>
              {phaseHistory.find((e) => e.phase === "CANCELLED") && (
                <p className="text-xs text-muted mt-1">
                  {formatDate(phaseHistory.find((e) => e.phase === "CANCELLED")!.enteredAt)}
                </p>
              )}
            </div>
          </li>
        )}
      </ol>
    );
  }

  return (
    <div className="space-y-0">
      <div className="flex items-start gap-1 overflow-x-auto pb-2">
        {WORKFLOW_TIMELINE.map((step, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const active = step.id === activeTimelinePhase && current !== "APPROVED";
          const complete = current === "APPROVED";
          const entry = getTimelineHistoryEntry(step.id, phaseHistory);

          return (
            <div key={step.id} className="flex items-start shrink-0">
              <div className="flex flex-col items-center min-w-[120px] max-w-[160px]">
                <div
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap w-full text-center ${
                    active
                      ? "bg-brand-600 text-white"
                      : done || complete
                        ? "bg-brand-100 text-brand-700"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {step.label}
                </div>
                {entry && (
                  <div className="mt-1.5 text-center px-1">
                    <p className="text-[10px] text-muted leading-tight">{formatDate(entry.enteredAt)}</p>
                    <p className="text-[10px] font-medium text-slate-700 leading-tight truncate w-full">
                      {entry.user.name}
                    </p>
                  </div>
                )}
              </div>
              {i < WORKFLOW_TIMELINE.length - 1 && (
                <div
                  className={`w-4 h-0.5 mt-3 mx-0.5 shrink-0 ${
                    done || complete || active ? "bg-brand-300" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          );
        })}
        {current === "CANCELLED" && (
          <div className="flex items-start shrink-0 ml-1">
            <div className="w-4 h-0.5 mt-3 mx-0.5 shrink-0 bg-red-300" />
            <div className="flex flex-col items-center min-w-[100px]">
              <div className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-800 w-full text-center">
                Cancelled
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
