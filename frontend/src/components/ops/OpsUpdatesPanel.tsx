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
  isReadyToAcceptMilestone,
  splitByTeam,
} from "../../lib/activityDisplay";

interface Props {
  updates: OpsActivityMessage[];
  shiftAlerts?: OpsShiftAlert[];
  dismissedUpdates?: OpsActivityMessage[];
  dismissedAlerts?: OpsShiftAlert[];
  dismissedCount?: number;
  isDemoPreview?: boolean;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onRestore?: (id: string) => void;
  onRestoreAll?: () => void;
  onRefresh?: () => void;
}

function ShiftAlertRow({
  alert,
  onDismiss,
  onRestore,
}: {
  alert: OpsShiftAlert;
  onDismiss?: (id: string) => void;
  onRestore?: (id: string) => void;
}) {
  const dismissed = Boolean(onRestore);
  return (
    <li
      className={`rounded-xl border px-3 py-2.5 shadow-sm ring-1 ${
        dismissed
          ? "border-slate-200 bg-slate-50/90 ring-transparent opacity-90"
          : "border-amber-300 bg-amber-50 ring-amber-200/60"
      }`}
      role="alert"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-bold uppercase tracking-wide ${
              dismissed ? "text-slate-500" : "text-amber-800"
            }`}
          >
            Shift alert
          </p>
          <p
            className={`text-sm font-semibold mt-0.5 ${
              dismissed ? "text-slate-700" : "text-amber-950"
            }`}
          >
            {alert.message}
          </p>
          <p
            className={`text-xs mt-1.5 leading-relaxed ${
              dismissed ? "text-slate-600" : "text-amber-900"
            }`}
          >
            {alert.detail}
          </p>
          <p className="text-[11px] text-muted mt-1.5">
            {new Date(alert.createdAt).toLocaleString()}
          </p>
        </div>
        {onRestore ? (
          <button
            type="button"
            onClick={() => onRestore(alert.id)}
            className="text-[11px] font-medium text-brand-700 hover:text-brand-900 shrink-0 px-2 py-1 rounded-md hover:bg-brand-50"
          >
            Restore
          </button>
        ) : onDismiss ? (
          <button
            type="button"
            onClick={() => onDismiss(alert.id)}
            className="text-[11px] font-medium text-amber-700 hover:text-amber-950 shrink-0 px-1"
            aria-label="Dismiss alert"
          >
            ×
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ActivityRow({
  message,
  onDismiss,
  onRestore,
  accent,
  muted = false,
}: {
  message: OpsActivityMessage;
  onDismiss?: (id: string) => void;
  onRestore?: (id: string) => void;
  accent: "graphics" | "ops";
  muted?: boolean;
}) {
  const complete = isCompleteMilestone(message.action);
  const incomplete = isIncompleteMilestone(message.action);
  const reason = getIncompleteReason(message);
  const progress = getIncompleteProgress(message);

  const border = muted
    ? "border-slate-200 bg-slate-50/90"
    : incomplete
    ? "border-amber-200 bg-amber-50/90"
    : complete
      ? accent === "graphics"
        ? "border-violet-200 bg-violet-50/80"
        : "border-emerald-200 bg-emerald-50/80"
      : accent === "graphics"
        ? "border-violet-100 bg-white"
        : "border-brand-100 bg-white";

  const titleColor = muted
    ? "text-slate-600"
    : incomplete
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
          {isReadyToAcceptMilestone(message.action) && (
            <p className="text-xs text-emerald-800 mt-1.5">
              Waiting for OPS acceptance — open Maps → Ready to accept to send to polish.
            </p>
          )}
          <p className="text-[11px] text-muted mt-1.5">
            {message.user.name} · {new Date(message.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (onRestore ? onRestore(message.id) : onDismiss?.(message.id))}
          className={
            onRestore
              ? "text-[11px] font-medium text-brand-700 hover:text-brand-900 shrink-0 px-2 py-1 rounded-md hover:bg-brand-50"
              : "text-[11px] font-medium text-muted hover:text-slate-900 shrink-0 px-1"
          }
          aria-label={onRestore ? "Restore update" : "Dismiss"}
        >
          {onRestore ? "Restore" : "×"}
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
  onRestore,
  emptyLabel,
  muted = false,
}: {
  title: string;
  subtitle: string;
  accent: "graphics" | "ops";
  items: OpsActivityMessage[];
  shiftAlerts?: OpsShiftAlert[];
  onDismiss?: (id: string) => void;
  onRestore?: (id: string) => void;
  emptyLabel: string;
  muted?: boolean;
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
              <ShiftAlertRow
                key={alert.id}
                alert={alert}
                onDismiss={onDismiss}
                onRestore={onRestore}
              />
            ))}
            {items.map((m) => (
              <ActivityRow
                key={m.id}
                message={m}
                onDismiss={onDismiss}
                onRestore={onRestore}
                accent={accent}
                muted={muted}
              />
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
  dismissedUpdates = [],
  dismissedAlerts = [],
  dismissedCount = 0,
  isDemoPreview = false,
  onDismiss,
  onDismissAll,
  onRestore,
  onRestoreAll,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"inbox" | "dismissed">("inbox");

  const inboxUpdates = updates;
  const inboxAlerts = shiftAlerts;
  const archiveUpdates = dismissedUpdates;
  const archiveAlerts = dismissedAlerts;

  const activeUpdates = view === "dismissed" ? archiveUpdates : inboxUpdates;
  const activeAlerts = view === "dismissed" ? archiveAlerts : inboxAlerts;

  const filtered = useMemo(
    () => filterActivityMessages(activeUpdates, search),
    [activeUpdates, search]
  );
  const filteredAlerts = useMemo(
    () => filterShiftAlerts(activeAlerts, search),
    [activeAlerts, search]
  );
  const { graphics, ops } = useMemo(() => splitByTeam(filtered), [filtered]);
  const hasInboxContent = inboxUpdates.length > 0 || inboxAlerts.length > 0;
  const hasArchiveContent = archiveUpdates.length > 0 || archiveAlerts.length > 0;
  const hasFilteredContent = filtered.length > 0 || filteredAlerts.length > 0;

  function handleDismissAll() {
    if (
      !window.confirm(
        "Dismiss all visible updates? You can find them again under the Dismissed tab."
      )
    ) {
      return;
    }
    onDismissAll();
  }

  function handleRestoreAll() {
    if (!onRestoreAll) return;
    if (!window.confirm("Restore all dismissed updates to your inbox?")) return;
    onRestoreAll();
    setView("inbox");
  }

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
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setView("inbox")}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                view === "inbox"
                  ? "bg-brand-600 text-white"
                  : "text-muted hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              Inbox
            </button>
            <button
              type="button"
              onClick={() => setView("dismissed")}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                view === "dismissed"
                  ? "bg-slate-700 text-white"
                  : "text-muted hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              Dismissed{dismissedCount > 0 ? ` (${dismissedCount})` : ""}
            </button>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs font-medium text-brand-700 hover:text-brand-900 px-3 py-2 rounded-lg hover:bg-brand-50 border border-transparent hover:border-brand-100"
            >
              Refresh
            </button>
          )}
          {view === "inbox" && hasInboxContent && (
            <button
              type="button"
              onClick={handleDismissAll}
              className="text-xs font-medium text-muted hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100"
            >
              Dismiss all
            </button>
          )}
          {view === "dismissed" && hasArchiveContent && onRestoreAll && (
            <button
              type="button"
              onClick={handleRestoreAll}
              className="text-xs font-medium text-brand-700 hover:text-brand-900 px-3 py-2 rounded-lg hover:bg-brand-50"
            >
              Restore all
            </button>
          )}
        </div>
      </div>

      {view === "dismissed" && (
        <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Dismissed updates are kept here — nothing is deleted. Use <strong>Restore</strong> to
          bring an item back to your inbox.
        </p>
      )}

      {view === "inbox" && !hasInboxContent ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No updates yet</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            Map stage completions and field complete / incomplete updates from graphics and ops.
            Shift alerts appear here when supervisors are on shift without a shift leader.
          </p>
        </div>
      ) : view === "dismissed" && !hasArchiveContent ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No dismissed updates</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            When you dismiss an update by mistake, it will appear here so you can restore it.
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
            onDismiss={view === "inbox" ? onDismiss : undefined}
            onRestore={view === "dismissed" ? onRestore : undefined}
            muted={view === "dismissed"}
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
            onDismiss={view === "inbox" ? onDismiss : undefined}
            onRestore={view === "dismissed" ? onRestore : undefined}
            muted={view === "dismissed"}
            emptyLabel={search ? "No ops updates match your search." : "No ops updates yet."}
          />
        </div>
      )}
    </div>
  );
}
