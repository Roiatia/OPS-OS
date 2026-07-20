import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { MapRecord } from "../../types";
import { Modal } from "@/components/common/Modal";
import { formatFieldDateTime } from "../../lib/opsDisplay";

interface Props {
  maps: MapRecord[];
  open: boolean;
  onClose: () => void;
  onAccepted: () => void;
}

export function ReadyToAcceptModal({ maps, open, onClose, onAccepted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const readyMaps = maps;

  const allSelected = readyMaps.length > 0 && selected.size === readyMaps.length;

  const selectedMaps = useMemo(
    () => readyMaps.filter((m) => selected.has(m.id)),
    [readyMaps, selected]
  );

  if (!open) return null;

  function toggleSelect(mapId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(readyMaps.map((m) => m.id)));
    }
  }

  async function acceptMaps(targets: MapRecord[]) {
    if (targets.length === 0) return;
    setLoading(true);
    setError("");
    try {
      // Fire the accepts in parallel rather than one round-trip at a time.
      await Promise.all(targets.map((map) => api.fieldComplete(map.id)));
      setSelected(new Set());
      onAccepted();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Ready to accept" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Field mapping is complete on these maps. Accept and send them to graphics polish.
        </p>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {readyMaps.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No maps waiting for acceptance.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={loading}
                />
                Select all ({readyMaps.length})
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={loading || selectedMaps.length === 0}
                  onClick={() => void acceptMaps(selectedMaps)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Accept selected ({selectedMaps.length})
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void acceptMaps(readyMaps)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Accept all
                </button>
              </div>
            </div>

            <ul className="max-h-[50vh] overflow-y-auto space-y-2 border border-border rounded-xl divide-y divide-border">
              {readyMaps.map((map) => (
                <li
                  key={map.id}
                  className="flex items-start gap-3 px-3 py-3 bg-white first:rounded-t-xl last:rounded-b-xl"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(map.id)}
                    onChange={() => toggleSelect(map.id)}
                    disabled={loading}
                    className="mt-1"
                    aria-label={`Select ${map.mapNumber}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        to={`/app/maps/${map.id}`}
                        className="font-mono font-semibold text-brand-700 hover:underline"
                      >
                        {map.mapNumber}
                      </Link>
                      <span className="text-sm text-muted">· {map.client}</span>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      Supervisor: {map.assignedSupervisor?.name ?? "—"}
                      {map.fieldDate ? ` · ${formatFieldDateTime(map.fieldDate)}` : ""}
                    </p>
                    {map.opsManagerComment && (
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{map.opsManagerComment}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void acceptMaps([map])}
                    className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Accept
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
