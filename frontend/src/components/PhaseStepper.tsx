import type { MapPhase } from "../types";
import { PHASE_LABELS, PHASE_ORDER } from "../types";

export interface PhaseHistoryEntry {
  phase: MapPhase;
  enteredAt: string;
  user: { id: string; name: string };
  note?: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PhaseStepper({
  current,
  phaseHistory,
  variant = "horizontal",
}: {
  current: MapPhase;
  phaseHistory: PhaseHistoryEntry[];
  variant?: "horizontal" | "vertical";
}) {
  const historyByPhase = new Map<MapPhase, PhaseHistoryEntry>();
  for (const entry of phaseHistory) {
    historyByPhase.set(entry.phase, entry);
  }

  const currentIdx =
    current === "CANCELLED"
      ? -1
      : PHASE_ORDER.indexOf(current as (typeof PHASE_ORDER)[number]);

  if (variant === "vertical") {
    const steps = [...PHASE_ORDER];
    if (current === "CANCELLED") steps.push("CANCELLED" as MapPhase);

    return (
      <ol className="relative space-y-0">
        {steps.map((phase, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const active = phase === current;
          const entry = historyByPhase.get(phase);
          const isLast = i === steps.length - 1;

          return (
            <li key={phase} className="relative flex gap-4 pb-8 last:pb-0">
              {!isLast && (
                <span
                  className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${
                    done || active ? "bg-brand-300" : "bg-slate-200"
                  }`}
                />
              )}
              <div
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  active
                    ? "bg-brand-600 text-white ring-4 ring-brand-100"
                    : done
                      ? "bg-brand-100 text-brand-700"
                      : phase === "CANCELLED"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p
                  className={`text-sm font-semibold ${
                    active
                      ? "text-brand-700"
                      : done
                        ? "text-slate-800"
                        : phase === "CANCELLED"
                          ? "text-red-700"
                          : "text-slate-400"
                  }`}
                >
                  {PHASE_LABELS[phase]}
                </p>
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
      </ol>
    );
  }

  return (
    <div className="space-y-0">
      <div className="flex items-start gap-1 overflow-x-auto pb-2">
        {PHASE_ORDER.map((phase, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const active = phase === current;
          const entry = historyByPhase.get(phase);

          return (
            <div key={phase} className="flex items-start shrink-0">
              <div className="flex flex-col items-center min-w-[100px] max-w-[120px]">
                <div
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap w-full text-center ${
                    active
                      ? "bg-brand-600 text-white"
                      : done
                        ? "bg-brand-100 text-brand-700"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {PHASE_LABELS[phase]}
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
              {i < PHASE_ORDER.length - 1 && (
                <div
                  className={`w-4 h-0.5 mt-3 mx-0.5 shrink-0 ${done || active ? "bg-brand-300" : "bg-slate-200"}`}
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
              {historyByPhase.get("CANCELLED") && (
                <div className="mt-1.5 text-center px-1">
                  <p className="text-[10px] text-muted leading-tight">
                    {formatDate(historyByPhase.get("CANCELLED")!.enteredAt)}
                  </p>
                  <p className="text-[10px] font-medium text-slate-700 leading-tight">
                    {historyByPhase.get("CANCELLED")!.user.name}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
