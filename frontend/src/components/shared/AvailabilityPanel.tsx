import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { hasOpsManagerRole, hasSupervisorRole } from "../../lib/roles";
import { OpsAvailabilityRoster } from "../availability/OpsAvailabilityRoster";
import { OpsShiftPlanner } from "../availability/OpsShiftPlanner";
import { PublishedSchedulePanel } from "../availability/PublishedSchedulePanel";
import { SupervisorAvailabilityForm } from "../availability/SupervisorAvailabilityForm";

interface Props {
  onAvailabilitySubmitted?: () => void;
}

export function AvailabilityPanel({ onAvailabilitySubmitted }: Props) {
  const { user } = useAuth();
  const [opsTab, setOpsTab] = useState<"plan" | "roster" | "schedule">("plan");
  const [supTab, setSupTab] = useState<"mine" | "schedule">("mine");

  if (hasSupervisorRole(user)) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          {(
            [
              { id: "mine" as const, label: "My availability" },
              { id: "schedule" as const, label: "Week schedule" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSupTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-xl ${
                supTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-border text-muted hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {supTab === "mine" ? (
          <SupervisorAvailabilityForm onSubmitted={onAvailabilitySubmitted} />
        ) : (
          <PublishedSchedulePanel />
        )}
      </div>
    );
  }

  if (hasOpsManagerRole(user)) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "plan" as const, label: "Shift plan" },
              { id: "roster" as const, label: "Availability" },
              { id: "schedule" as const, label: "Published schedule" },
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
        {opsTab === "plan" ? (
          <OpsShiftPlanner />
        ) : opsTab === "roster" ? (
          <OpsAvailabilityRoster />
        ) : (
          <PublishedSchedulePanel />
        )}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted">Availability is for supervisors and OPS managers only.</p>
  );
}
