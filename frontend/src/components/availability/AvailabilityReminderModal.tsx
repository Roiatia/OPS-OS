interface Props {
  open: boolean;
  weekLabel: string;
  onDismiss: () => void;
  onFill: () => void;
}

export function AvailabilityReminderModal({ open, weekLabel, onDismiss, onFill }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/35"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-amber-200"
        role="alertdialog"
        aria-labelledby="availability-reminder-title"
        aria-describedby="availability-reminder-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Reminder</p>
        <h2 id="availability-reminder-title" className="text-lg font-bold text-slate-900 mt-1">
          Availability not submitted
        </h2>
        <p id="availability-reminder-desc" className="text-sm text-muted mt-2 leading-relaxed">
          Please submit availability for the week of <strong>{weekLabel}</strong>. Every Sunday,
          supervisors and shift leaders should send next week&apos;s hours to OPS. You can still
          fill it late — OPS Manager needs this to plan shifts.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <button
            type="button"
            onClick={onFill}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
          >
            Fill availability
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 border border-border text-sm font-medium rounded-xl hover:bg-slate-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
