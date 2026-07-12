import { useAuth } from "../../context/AuthContext";
import { hasOpsManagerRole, hasSupervisorRole } from "../../lib/roles";
import { OpsAvailabilityRoster } from "../availability/OpsAvailabilityRoster";
import { SupervisorAvailabilityForm } from "../availability/SupervisorAvailabilityForm";

export function AvailabilityPanel() {
  const { user } = useAuth();

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
          Review supervisor availability against field map volume from CS. Purple blocks are night
          shifts (from 23:00, 6h+).
        </p>
        <OpsAvailabilityRoster />
      </div>
    );
  }

  return (
    <p className="text-sm text-muted">Availability is for supervisors and OPS managers only.</p>
  );
}
