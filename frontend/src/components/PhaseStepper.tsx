import type { MapPhase } from "../types";
import { PHASE_LABELS, PHASE_ORDER } from "../types";

export function PhaseStepper({ current }: { current: MapPhase }) {
  const idx = PHASE_ORDER.indexOf(current);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {PHASE_ORDER.map((phase, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={phase} className="flex items-center shrink-0">
            <div
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                active
                  ? "bg-brand-600 text-white"
                  : done
                    ? "bg-brand-100 text-brand-700"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {PHASE_LABELS[phase]}
            </div>
            {i < PHASE_ORDER.length - 1 && (
              <div className={`w-4 h-0.5 mx-0.5 ${done ? "bg-brand-300" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
