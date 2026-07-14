import { Link } from "react-router-dom";
import type { MapRecord } from "../types";
import { getMapDisplayState, getWorkflowTimelineLabel, workflowStateTone, workflowTimelineTone, getWorkflowTimelinePhase } from "../lib/mapDisplay";
import { Badge } from "./Badge";

/** Summary card linking to a map's detail page. */
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
        <Badge
          label={getWorkflowTimelineLabel(map.phase)}
          tone={workflowTimelineTone(getWorkflowTimelinePhase(map.phase))}
        />
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
