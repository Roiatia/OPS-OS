import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { reportKeys, useReportDetailQuery, useReportsListQuery } from "@/hooks/queries";
import type { OpsDailyReportDetail, OpsDailyReportListItem } from "../../types/report";

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ReportListItem = memo(function ReportListItem({
  report,
  active,
  onSelect,
}: {
  report: OpsDailyReportListItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(report.id)}
      className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
        active
          ? "border-brand-400 bg-brand-50 shadow-sm"
          : "border-border bg-white hover:border-brand-200 hover:bg-brand-50/40"
      }`}
    >
      <p className="text-sm font-semibold text-slate-900">{report.title}</p>
      <p className="text-[11px] text-muted mt-1">
        Generated {formatGeneratedAt(report.generatedAt)}
      </p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
          {report.fieldCompleted} complete
        </span>
        {report.fieldIncomplete > 0 && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
            {report.fieldIncomplete} incomplete
          </span>
        )}
        {(report.fieldCancelled ?? 0) > 0 && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
            {report.fieldCancelled} cancelled
          </span>
        )}
        {report.shiftLeaderCount === 0 && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-950">
            No shift leader
          </span>
        )}
      </div>
    </button>
  );
});

function MapItemsTable({
  title,
  items,
  showReason = false,
  tone = "default",
}: {
  title: string;
  items: { mapId: string; mapNumber: string; client: string; supervisorName: string | null; reason: string | null }[];
  showReason?: boolean;
  tone?: "default" | "warning" | "muted";
}) {
  if (items.length === 0) return null;

  const headerTone =
    tone === "warning"
      ? "text-amber-900"
      : tone === "muted"
        ? "text-slate-600"
        : "text-slate-900";

  return (
    <section className="space-y-2">
      <h3 className={`text-sm font-bold ${headerTone}`}>{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50 text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-semibold">Map</th>
              <th className="px-3 py-2 font-semibold">Client</th>
              <th className="px-3 py-2 font-semibold">Supervisor</th>
              {showReason && <th className="px-3 py-2 font-semibold">Reason</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.mapId} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <Link
                    to={`/app/maps/${item.mapId}`}
                    className="font-mono text-brand-700 hover:underline"
                  >
                    {item.mapNumber}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-700">{item.client}</td>
                <td className="px-3 py-2 text-slate-600">{item.supervisorName ?? "—"}</td>
                {showReason && (
                  <td className="px-3 py-2 text-amber-900 text-xs">{item.reason ?? "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MilestonesList({
  title,
  items,
}: {
  title: string;
  items: { label: string; mapNumber: string; client: string; userName: string; at: string }[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <ul className="space-y-2">
        {items.map((m, i) => (
          <li
            key={`${m.mapNumber}-${m.at}-${i}`}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            <p className="font-medium text-slate-800">{m.label}</p>
            <p className="text-slate-600 mt-0.5">
              <span className="font-mono text-brand-700">{m.mapNumber}</span> · {m.client}
            </p>
            <p className="text-[11px] text-muted mt-1">
              {m.userName} · {new Date(m.at).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamGroup({
  title,
  members,
}: {
  title: string;
  members: { id: string; name: string; role: string }[];
}) {
  if (members.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted uppercase tracking-wide">{title}</p>
      <ul className="space-y-1.5">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded-lg bg-white border border-border px-3 py-2 text-sm"
          >
            <span className="font-medium text-slate-800">{m.name}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {m.role}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportDetail({
  report,
  onUpdated,
}: {
  report: OpsDailyReportDetail;
  onUpdated: (next: OpsDailyReportDetail) => void;
}) {
  const { payload } = report;
  const team = payload.team ?? { field: [], graphics: [], ops: [] };
  const [note, setNote] = useState(payload.opsManagerNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [noteMsg, setNoteMsg] = useState("");

  useEffect(() => {
    setNote(payload.opsManagerNote ?? "");
    setNoteMsg("");
  }, [report.id, payload.opsManagerNote]);

  async function saveNote() {
    setSavingNote(true);
    setNoteMsg("");
    try {
      const updated = await api.updateReportNote(report.id, note.trim() || null);
      onUpdated(updated);
      setNoteMsg("Note saved.");
    } catch (err) {
      setNoteMsg((err as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">End of day</p>
        <h2 className="text-xl font-bold text-slate-900 mt-1">{report.title}</h2>
        <p className="text-sm text-muted mt-1">
          Generated at {formatGeneratedAt(report.generatedAt)}
        </p>
      </div>

      <section className="grid grid-cols-3 gap-3">
        {[
          { label: "Completed", value: payload.field.completed.length, tone: "ok" },
          { label: "Incomplete", value: payload.field.incomplete.length, tone: "warn" },
          { label: "Cancelled", value: payload.field.cancelled.length, tone: "muted" },
        ].map((s) => (
          <div
            key={s.label}
            className={`rounded-xl border p-4 ${
              s.tone === "ok"
                ? "border-emerald-200 bg-emerald-50"
                : s.tone === "warn"
                  ? "border-amber-200 bg-amber-50"
                  : "border-border bg-white"
            }`}
          >
            <div
              className={`text-2xl font-bold ${
                s.tone === "ok"
                  ? "text-emerald-700"
                  : s.tone === "warn"
                    ? "text-amber-800"
                    : "text-slate-700"
              }`}
            >
              {s.value}
            </div>
            <div className="text-sm text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </section>

      {payload.alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2">
          <p className="text-sm font-bold text-amber-950">Alerts</p>
          <ul className="space-y-1">
            {payload.alerts.map((alert) => (
              <li key={alert} className="text-sm text-amber-900">
                {alert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-slate-50/60 p-4 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Teams who worked today</h3>
        <TeamGroup title="Field ops" members={team.field} />
        <TeamGroup title="Graphics" members={team.graphics} />
        <TeamGroup title="OPS" members={team.ops} />
        {team.field.length === 0 && team.graphics.length === 0 && team.ops.length === 0 && (
          <p className="text-sm text-muted">No team activity recorded this day.</p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-900">OPS Manager note</h3>
        <p className="text-xs text-muted">
          Optional summary for this shift — saved with the report so you can recall what happened later.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          className="w-full border border-border rounded-xl px-3 py-2 text-sm"
          placeholder="What happened on this shift…"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveNote()}
            disabled={savingNote}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 disabled:opacity-50"
          >
            {savingNote ? "Saving…" : "Save note"}
          </button>
          {noteMsg && <p className="text-xs text-muted">{noteMsg}</p>}
        </div>
      </section>

      <MapItemsTable title={`Field complete (${payload.field.completed.length})`} items={payload.field.completed} />
      <MapItemsTable
        title={`Field incomplete (${payload.field.incomplete.length})`}
        items={payload.field.incomplete}
        showReason
        tone="warning"
      />
      <MapItemsTable
        title={`Cancelled (${payload.field.cancelled.length})`}
        items={payload.field.cancelled}
        showReason
        tone="muted"
      />
      <MilestonesList title="Accepted to polish" items={payload.ops.acceptedToPolish} />
      <MilestonesList title="Graphics milestones" items={payload.graphics.milestones} />
    </div>
  );
}

export function OpsReportsPanel() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the search term into the query key so keystrokes don't fire a
  // request each; React Query then caches results per search term.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const listQuery = useReportsListQuery(debouncedSearch);
  const reports = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = listQuery.isLoading;

  // Keep a valid selection as the list changes (search/refresh).
  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && reports.some((r) => r.id === prev)) return prev;
      return reports[0]?.id ?? null;
    });
  }, [reports]);

  const detailQuery = useReportDetailQuery(selectedId);
  const selected = detailQuery.data ?? null;
  const detailLoading = detailQuery.isFetching && !detailQuery.data;

  const error = listQuery.error
    ? (listQuery.error as Error).message
    : detailQuery.error
    ? (detailQuery.error as Error).message
    : "";

  const filteredEmpty = useMemo(
    () => !loading && reports.length === 0 && search.trim().length > 0,
    [loading, reports.length, search]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label htmlFor="ops-reports-search" className="sr-only">
            Search reports
          </label>
          <input
            id="ops-reports-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by date, map, client, supervisor, or alert…"
            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
          />
        </div>
        <button
          type="button"
          onClick={() => void listQuery.refetch()}
          className="text-xs font-medium text-brand-700 hover:text-brand-900 px-3 py-2 rounded-lg hover:bg-brand-50 border border-transparent hover:border-brand-100 shrink-0"
        >
          Refresh
        </button>
      </div>

      <p className="text-xs text-muted -mt-1">
        A new report is generated automatically every day at 08:00, covering the previous day
        (including overnight field work).
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading reports…</p>
      ) : filteredEmpty ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-6 py-10 text-center">
          <p className="text-sm text-muted">No reports match &ldquo;{search}&rdquo;</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No reports yet</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            The first report will appear after 08:00, summarizing the previous day’s shift coverage,
            field work,
            and pipeline status.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,320px)_1fr] gap-4 items-start">
          <aside className="space-y-2 lg:sticky lg:top-20 max-h-[calc(100vh-14rem)] overflow-y-auto pr-1">
            {reports.map((report) => (
              <ReportListItem
                key={report.id}
                report={report}
                active={report.id === selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </aside>

          <div className="min-w-0">
            {detailLoading ? (
              <p className="text-muted">Loading report…</p>
            ) : selected ? (
              <ReportDetail
                report={selected}
                onUpdated={(next) => {
                  qc.setQueryData<OpsDailyReportDetail>(reportKeys.detail(next.id), next);
                  qc.setQueryData<OpsDailyReportListItem[]>(
                    reportKeys.list(debouncedSearch),
                    (prev) =>
                      prev?.map((r) =>
                        r.id === next.id
                          ? {
                              ...r,
                              fieldCompleted: next.fieldCompleted,
                              fieldIncomplete: next.fieldIncomplete,
                              fieldCancelled: next.fieldCancelled,
                              summary: next.summary,
                            }
                          : r
                      )
                  );
                }}
              />
            ) : (
              <p className="text-muted">Select a report to view details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
