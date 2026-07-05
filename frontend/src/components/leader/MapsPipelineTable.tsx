import { Link } from "react-router-dom";
import type { MapRecord } from "../types";
import { Badge } from "../Badge";
import { getMapAssignee, getMapDisplayState, getMapStation, workflowStateTone } from "../../lib/mapDisplay";
import { Badge } from "../Badge";

interface Props {
  maps: MapRecord[];
}

export function MapsPipelineTable({ maps }: Props) {
  if (maps.length === 0) {
    return (
      <p className="text-sm text-muted py-8 text-center border border-dashed border-border rounded-xl">
        No maps yet. Add a map to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-muted border-b border-border">
            <th className="px-4 py-3 font-medium">Map</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Station</th>
            <th className="px-4 py-3 font-medium">State</th>
            <th className="px-4 py-3 font-medium">Assigned to</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {maps.map((map) => (
            <tr key={map.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-3 font-mono font-medium text-slate-900">{map.mapNumber}</td>
              <td className="px-4 py-3 text-muted">{map.client}</td>
              <td className="px-4 py-3">
                <Badge label={getMapStation(map)} tone={map.phase} />
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const state = getMapDisplayState(map);
                  return state === "—" ? "—" : <Badge label={state} tone={workflowStateTone(state)} />;
                })()}
              </td>
              <td className="px-4 py-3 font-medium">{getMapAssignee(map)}</td>
              <td className="px-4 py-3 text-right">
                <Link
                  to={`/app/maps/${map.id}`}
                  className="text-brand-600 hover:text-brand-700 font-medium"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
