import type { MapRecord } from "../../types";
import { Badge } from "../Badge";
import { FIELD_WORK_STATUS_LABELS, fieldWorkStatusTone, formatFieldDate, getSupervisorFieldStatus } from "../../lib/supervisorDisplay";
import { Link } from "react-router-dom";

interface Props {
  maps: MapRecord[];
}

export function SupervisorHistoryPanel({ maps }: Props) {
  const archived = maps.filter((m) => {
    const status = getSupervisorFieldStatus(m);
    return status === "COMPLETED" || status === "CANCELLED";
  });

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">History</h2>
        <p className="text-sm text-muted mt-0.5">
          Completed and cancelled field maps
        </p>
      </div>

      {archived.length === 0 ? (
        <p className="text-sm text-muted py-10 text-center border border-dashed border-border rounded-xl">
          No completed or cancelled maps yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Map</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Mapper</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Loom</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {archived.map((map) => {
                const status = getSupervisorFieldStatus(map);
                return (
                  <tr key={map.id} className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <Link to={`/app/maps/${map.id}`} className="font-medium text-brand-700 hover:underline">
                        {map.mapNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{map.client}</td>
                    <td className="px-4 py-3">{map.mapperName ?? "—"}</td>
                    <td className="px-4 py-3">{formatFieldDate(map.fieldDate)}</td>
                    <td className="px-4 py-3">{map.loomDone ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">
                      <Badge label={FIELD_WORK_STATUS_LABELS[status]} tone={fieldWorkStatusTone(status)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
