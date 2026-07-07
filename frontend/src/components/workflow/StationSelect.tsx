import { useState } from "react";
import { api } from "../../api";
import type { MapRecord, WorkflowPhaseTarget } from "../../types";
import { getMapWorkflowPhaseTarget, MAP_STATIONS } from "../../lib/mapDisplay";

interface Props {
  map: MapRecord;
  disabled?: boolean;
  className?: string;
  onUpdated?: () => void;
  onError?: (message: string) => void;
}

export function StationSelect({ map, disabled, className, onUpdated, onError }: Props) {
  const [saving, setSaving] = useState(false);
  const value = getMapWorkflowPhaseTarget(map);

  async function handleChange(next: WorkflowPhaseTarget) {
    if (next === value) return;
    setSaving(true);
    try {
      await api.updateMapStation(map.id, next);
      onUpdated?.();
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      value={value}
      disabled={disabled || saving || map.phase === "CANCELLED"}
      onChange={(e) => handleChange(e.target.value as WorkflowPhaseTarget)}
      className={
        className ??
        "w-full min-w-[110px] text-xs font-medium rounded-md border border-border px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      }
      title="Pipeline station"
    >
      {MAP_STATIONS.map((station) => (
        <option key={station.id} value={station.id}>
          {station.label}
        </option>
      ))}
    </select>
  );
}
