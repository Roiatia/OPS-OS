import type { MapRecord } from "../../types";

interface Props {
  map: MapRecord;
  disabled?: boolean;
  onChange: () => void;
}

/** QA is auto-assigned when an inspector is set; leaders can override via Change. */
export function QaOverrideCell({ map, disabled, onChange }: Props) {
  if (map.assignedQa) {
    return (
      <div className="min-w-[72px]">
        <p className="text-xs font-medium text-violet-800 truncate">{map.assignedQa.name}</p>
        <p className="text-[10px] text-muted mt-0.5">Auto-assigned</p>
        <button
          type="button"
          disabled={disabled}
          onClick={onChange}
          className="text-[10px] font-medium text-violet-600 hover:text-violet-800 hover:underline disabled:opacity-50 mt-0.5"
        >
          Change
        </button>
      </div>
    );
  }

  if (map.assignedInspector) {
    return (
      <div className="min-w-[72px]">
        <p className="text-xs font-medium text-amber-800">Needs QA</p>
        <p className="text-[10px] text-muted mt-0.5">Not assigned yet</p>
        <button
          type="button"
          disabled={disabled}
          onClick={onChange}
          className="text-[10px] font-medium text-violet-600 hover:text-violet-800 hover:underline disabled:opacity-50 mt-0.5"
        >
          Assign
        </button>
      </div>
    );
  }

  return <span className="text-xs text-muted">Auto on assign</span>;
}
