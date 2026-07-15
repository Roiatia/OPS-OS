import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { hasOpsManagerRole, hasSupervisorRole } from "../../lib/roles";
import { OpsAvailabilityRoster } from "../availability/OpsAvailabilityRoster";
import { OpsShiftPlanner } from "../availability/OpsShiftPlanner";
import { SupervisorAvailabilityForm } from "../availability/SupervisorAvailabilityForm";

export function AvailabilityPanel() {
  const { user } = useAuth();
  const [opsTab, setOpsTab] = useState<"roster" | "plan">("plan");

  if (hasSupervisorRole(user)) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted max-w-2xl">
          Mark each day with ✓ or ✕, add your hours when available, and leave a note for OPS if needed.
        </p>
        <SupervisorAvailabilityForm />
      </div>
    );
  }

  if (hasOpsManagerRole(user)) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted max-w-2xl">
          Review availability and plan weekly shifts based on field maps from CS (about one week ahead).
        </p>
        <div className="flex gap-2">
          {(
            [
              { id: "plan" as const, label: "Shift plan" },
              { id: "roster" as const, label: "Availability" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setOpsTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-xl ${
                opsTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-border text-muted hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {opsTab === "plan" ? <OpsShiftPlanner /> : <OpsAvailabilityRoster />}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted">Availability is for supervisors and OPS managers only.</p>
  );
}
