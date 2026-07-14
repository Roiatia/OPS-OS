interface Props {
  assigned: boolean;
  assigneeName?: string;
  tone: "brand" | "violet";
  disabled?: boolean;
  onClick: () => void;
}

/** Pipeline table cell button for assigning or viewing an assignee. */
export function AssignCellButton({ assigned, assigneeName, tone, disabled, onClick }: Props) {
  const styles =
    tone === "brand"
      ? assigned
        ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
        : "bg-brand-600 text-white border-brand-600 hover:bg-brand-700"
      : assigned
        ? "bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100"
        : "bg-violet-600 text-white border-violet-600 hover:bg-violet-700";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full min-w-[72px] px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${styles}`}
    >
      <span className="block">{assigned ? "Assigned" : "Assign"}</span>
      {assigned && assigneeName && (
        <span className="block text-[10px] font-normal opacity-80 truncate mt-0.5">{assigneeName}</span>
      )}
    </button>
  );
}
