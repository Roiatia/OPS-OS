import type { MapRecord } from "../../types";
import type { OpsWorkloadAlert } from "../../lib/opsWorkload";
import { mapAssignLightLoadHint, mapLightLoadHint } from "../../lib/opsWorkload";

interface Props {
  map: MapRecord;
  alerts: OpsWorkloadAlert[];
}

export function OpsActionLightLoadNote({ map, alerts }: Props) {
  const hint = mapLightLoadHint(map, alerts) ?? mapAssignLightLoadHint(map, alerts);
  if (!hint) return null;

  return (
    <p className="text-[10px] leading-snug text-amber-700 mt-1 max-w-[140px]" title={hint}>
      {hint}
    </p>
  );
}
