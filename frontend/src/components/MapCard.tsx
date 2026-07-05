import { Link } from "react-router-dom";
import type { MapRecord } from "../types";
import { PHASE_LABELS } from "../types";
import { getMapDisplayState, workflowStateTone } from "../lib/mapDisplay";
import { Badge } from "./Badge";

export function MapCard({ map }: { map: MapRecord }) {
  const state = getMapDisplayState(map);

  return (
    <Link
      to={`/app/maps/${map.id}`}
      className="block bg-card border border-border rounded-xl p-5 hover:border-brand-500 hover:shadow-md transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-lg">{map.mapNumber}</div>
          <div className="text-sm text-muted mt-0.5">
            {map.client}
            {map.area ? ` · ${map.area}` : ""}
          </div>
        </div>
        <Badge label={PHASE_LABELS[map.phase]} tone={map.phase} />
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {map.jiraTicketId && <Badge label={map.jiraTicketId} />}
        {state !== "—" && <Badge label={state} tone={workflowStateTone(state)} />}
        {map.assignedInspector && (
          <span className="text-xs text-muted">Inspector: {map.assignedInspector.name}</span>
        )}
      </div>
    </Link>
  );
}
