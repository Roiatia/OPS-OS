import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { OpsActivityMessage, OpsShiftAlert } from "../../types/activity";
import {
  filterActivityMessages,
  filterShiftAlerts,
  getActivityLabel,
  getIncompleteProgress,
  getIncompleteReason,
  isCompleteMilestone,
  isIncompleteMilestone,
  splitByTeam,
} from "../../lib/activityDisplay";

interface Props {
  updates: OpsActivityMessage[];
  shiftAlerts?: OpsShiftAlert[];
  isDemoPreview?: boolean;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onRefresh?: () => void;
}

function ShiftAlertRow({
  alert,
  onDismiss,
}: {
  alert: OpsShiftAlert;
  onDismiss: (id: string) => void;
}) {
  return (
    <li
      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 shadow-sm ring-1 ring-amber-200/60"
      role="alert"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Shift alert
          </p>
          <p className="text-sm font-semibold text-amber-950 mt-0.5">{alert.message}</p>
          <p className="text-xs text-amber-900 mt-1.5 leading-relaxed">{alert.detail}</p>
          <p className="text-[11px] text-amber-800/80 mt-1.5">
            {new Date(alert.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(alert.id)}
          className="text-[11px] font-medium text-amber-700 hover:text-amber-950 shrink-0 px-1"
          aria-label="Dismiss alert"
        >
          ×
        </button>
      </div>
    </li>
  );
}

function ActivityRow({
  message,
  onDismiss,
  accent,
}: {
  message: OpsActivityMessage;
  onDismiss: (id: string) => void;
  accent: "graphics" | "ops";
}) {
  const complete = isCompleteMilestone(message.action);
  const incomplete = isIncompleteMilestone(message.action);
  const reason = getIncompleteReason(message);
  const progress = getIncompleteProgress(message);

  const border = incomplete
    ? "border-amber-200 bg-amber-50/90"
    : complete
      ? accent === "graphics"
        ? "border-violet-200 bg-violet-50/80"
        : "border-emerald-200 bg-emerald-50/80"
      : accent === "graphics"
        ? "border-violet-100 bg-white"
        : "border-brand-100 bg-white";

  const titleColor = incomplete
    ? "text-amber-900"
    : complete
      ? accent === "graphics"
        ? "text-violet-900"
        : "text-emerald-900"
      : accent === "graphics"
        ? "text-violet-800"
        : "text-brand-800";

  return (
    <li className={`rounded-xl border px-3 py-2.5 shadow-sm ${border}`} role="status">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${titleColor}`}>
            {getActivityLabel(message.action)}
          </p>
          <p className="text-sm text-slate-700 mt-0.5 leading-snug">
            <Link
              to={`/app/maps/${message.map.id}`}
              className="font-mono font-medium text-brand-700 hover:underline"
            >
              {message.map.mapNumber}
            </Link>
            <span className="text-muted"> · {message.map.client}</span>
          </p>
          {incomplete && progress != null && (
            <p className="text-xs font-semibold text-amber-800 mt-1">
              {progress}% done
            </p>
          )}
          {incomplete && reason && (
            <div className="mt-2 rounded-lg bg-white/80 border border-amber-200/80 px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                Why incomplete
              </p>
              <p className="text-xs text-amber-950 mt-0.5 leading-relaxed">{reason}</p>
            </div>
          )}
          {incomplete && !reason && (
            <p className="text-xs text-amber-700 mt-1 italic">No reason provided yet</p>
          )}
          <p className="text-[11px] text-muted mt-1.5">
            {message.user.name} · {new Date(message.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(message.id)}
          className="text-[11px] font-medium text-muted hover:text-slate-900 shrink-0 px-1"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </li>
  );
}

function ActivityColumn({
  title,
  subtitle,
  accent,
  items,
  shiftAlerts = [],
  onDismiss,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  accent: "graphics" | "ops";
  items: OpsActivityMessage[];
  shiftAlerts?: OpsShiftAlert[];
  onDismiss: (id: string) => void;
  emptyLabel: string;
}) {
  const headerBg =
    accent === "graphics" ? "bg-violet-50 border-violet-200" : "bg-brand-50 border-brand-200";
  const headerText = accent === "graphics" ? "text-violet-900" : "text-brand-900";
  const dot = accent === "graphics" ? "bg-violet-500" : "bg-brand-600";
  const itemCount = items.length + shiftAlerts.length;

  return (
    <section className="flex flex-col min-h-0 rounded-2xl border border-border bg-slate-50/50 overflow-hidden">
      <header className={`px-4 py-3 border-b ${headerBg}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <h2 className={`text-sm font-bold ${headerText}`}>{title}</h2>
          <span className="ml-auto text-[11px] font-bold tabular-nums text-muted bg-white/80 px-2 py-0.5 rounded-full">
            {itemCount}
          </span>
        </div>
        <p className="text-[11px] text-muted mt-1">{subtitle}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-3 max-h-[calc(100vh-18rem)]">
        {itemCount === 0 ? (
          <p className="text-xs text-muted text-center py-10 px-4">{emptyLabel}</p>
        ) : (
          <ul className="space-y-2">
            {shiftAlerts.map((alert) => (
              <ShiftAlertRow key={alert.id} alert={alert} onDismiss={onDismiss} />
            ))}
            {items.map((m) => (
              <ActivityRow key={m.id} message={m} onDismiss={onDismiss} accent={accent} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function OpsUpdatesPanel({
  updates,
  shiftAlerts = [],
  isDemoPreview = false,
  onDismiss,
  onDismissAll,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => filterActivityMessages(updates, search),
    [updates, search]
  );
  const filteredAlerts = useMemo(
    () => filterShiftAlerts(shiftAlerts, search),
    [shiftAlerts, search]
  );
  const { graphics, ops } = useMemo(() => splitByTeam(filtered), [filtered]);
  const hasContent = updates.length > 0 || shiftAlerts.length > 0;
  const hasFilteredContent = filtered.length > 0 || filteredAlerts.length > 0;

  return (
    <div className="space-y-4">
      {isDemoPreview && (
        <p className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
          Sample updates for demo — real milestones appear here as maps move through the pipeline.
        </p>
      )}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label htmlFor="ops-updates-search" className="sr-only">
            Search updates
          </label>
          <input
            id="ops-updates-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search map, client, supervisor, or incomplete reason…"
            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs font-medium text-brand-700 hover:text-brand-900 px-3 py-2 rounded-lg hover:bg-brand-50 border border-transparent hover:border-brand-100"
            >
              Refresh
            </button>
          )}
          {hasContent && (
            <button
              type="button"
              onClick={onDismissAll}
              className="text-xs font-medium text-muted hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100"
            >
              Dismiss all
            </button>
          )}
        </div>
      </div>

      {!hasContent ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No updates yet</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            Map stage completions and field complete / incomplete updates from graphics and ops.
            Shift alerts appear here when supervisors are on shift without a shift leader.
          </p>
        </div>
      ) : !hasFilteredContent ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-6 py-10 text-center">
          <p className="text-sm text-muted">No results for &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <ActivityColumn
            title="Graphics"
            subtitle="Upload, polish, and QA stage completions"
            accent="graphics"
            items={graphics}
            onDismiss={onDismiss}
            emptyLabel={
              search ? "No graphics updates match your search." : "No graphics updates yet."
            }
          />
          <ActivityColumn
            title="Ops"
            subtitle="Shift alerts, field mapping complete, incomplete (with reason), accepted to polish"
            accent="ops"
            items={ops}
            shiftAlerts={filteredAlerts}
            onDismiss={onDismiss}
            emptyLabel={search ? "No ops updates match your search." : "No ops updates yet."}
          />
        </div>
      )}
    </div>
  );
}
