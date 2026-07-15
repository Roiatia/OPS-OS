import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord } from "../../types";
import { getTaskType } from "../../lib/mapDisplay";
import { Badge } from "@/components/common/Badge";

interface Props {
  maps: MapRecord[];
  /** Silent/debounced reload — fallback for errors and realtime. */
  onRefresh: () => void;
  /** Patch a single updated map into parent state (mirrors MapHubBoard). */
  onPatch?: (map: MapRecord) => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function InspectorInboxTable({ maps, onRefresh, onPatch }: Props) {
  const patch = (map: MapRecord) => (onPatch ? onPatch(map) : onRefresh());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function accept(map: MapRecord) {
    setError("");
    setLoadingId(map.id);
    try {
      const updated = await api.updateInspectorStatus(map.id, "ACCEPTED");
      patch(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  if (maps.length === 0) {
    return (
      <p className="text-sm text-muted py-6 text-center border border-dashed border-amber-200 rounded-xl bg-amber-50/40">
        No new maps assigned to you.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-amber-200 bg-amber-50/30">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-amber-100/80 text-left text-xs text-amber-900 border-b border-amber-200">
              <th className="px-3 py-2.5 font-semibold">Date</th>
              <th className="px-3 py-2.5 font-semibold">Map</th>
              <th className="px-3 py-2.5 font-semibold">Customer</th>
              <th className="px-3 py-2.5 font-semibold">Task</th>
              <th className="px-3 py-2.5 font-semibold">Due</th>
              <th className="px-3 py-2.5 font-semibold w-28">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {maps.map((map) => {
              const taskType = getTaskType(map);
              return (
                <tr key={map.id} className="bg-white/70 hover:bg-white">
                  <td className="px-3 py-3 text-muted text-xs">{formatDate(map.createdAt)}</td>
                  <td className="px-3 py-3">
                    <Link
                      to={`/app/maps/${map.id}`}
                      className="font-mono font-semibold text-brand-600 hover:underline"
                    >
                      {map.mapNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{map.client}</td>
                  <td className="px-3 py-3">
                    {taskType ? (
                      <Badge label={taskType} tone={taskType === "Upload" ? "PREP" : "POLISH"} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted text-xs">
                    {map.dueDate ? formatDate(map.dueDate) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={loadingId === map.id}
                      onClick={() => accept(map)}
                      className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                    >
                      Accept
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
