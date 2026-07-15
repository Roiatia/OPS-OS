import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { AvailabilityRoster, AvailabilityRosterEntry } from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  formatWeekRange,
  isoWeekStart,
  weekStartSunday,
  defaultSubmissionWeekStart,
} from "../../lib/availabilityRules";

type SortKey = "name" | "role" | "status" | "hagim";

function isMondayEvening(now = new Date()): boolean {
  return now.getDay() === 1 && now.getHours() >= 17;
}

function compareRows(a: AvailabilityRosterEntry, b: AvailabilityRosterEntry, sort: SortKey): number {
  const aMissing = !a.submission?.submittedAt;
  const bMissing = !b.submission?.submittedAt;
  if (sort === "status") {
    if (aMissing !== bMissing) return aMissing ? -1 : 1;
    return a.user.name.localeCompare(b.user.name);
  }
  if (sort === "role") {
    if (a.user.isShiftLeader !== b.user.isShiftLeader) return a.user.isShiftLeader ? -1 : 1;
    return a.user.name.localeCompare(b.user.name);
  }
  if (sort === "hagim") {
    const aH = Boolean(a.submission?.fridayContract ?? a.user.fridayContract);
    const bH = Boolean(b.submission?.fridayContract ?? b.user.fridayContract);
    if (aH !== bH) return aH ? -1 : 1;
    return a.user.name.localeCompare(b.user.name);
  }
  return a.user.name.localeCompare(b.user.name);
}

export function OpsAvailabilityRoster() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<AvailabilityRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "submitted" | "missing">(() =>
    isMondayEvening() ? "missing" : "all"
  );
  const [sort, setSort] = useState<SortKey>(() => (isMondayEvening() ? "status" : "name"));

  const mondayEvening = isMondayEvening();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const roster = await api.getAvailabilityRoster(isoWeekStart(weekStart));
      setData(roster);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeWeek(delta: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(weekStartSunday(d));
  }

  const missingRows = useMemo(
    () => data?.roster.filter((r) => !r.submission?.submittedAt) ?? [],
    [data]
  );

  const rows = useMemo(() => {
    const filtered =
      data?.roster.filter((r) => {
        if (filter === "submitted") return Boolean(r.submission?.submittedAt);
        if (filter === "missing") return !r.submission?.submittedAt;
        return true;
      }) ?? [];
    return [...filtered].sort((a, b) => compareRows(a, b, sort));
  }, [data, filter, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeWeek(-1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            ←
          </button>
          <div>
            <p className="text-sm font-semibold">Week of {formatWeekRange(weekStart)}</p>
            <p className="text-xs text-muted">Supervisor & shift leader availability</p>
          </div>
          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            →
          </button>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-sm text-brand-600 hover:underline"
        >
          Refresh
        </button>
      </div>

      {data && missingRows.length > 0 && (
        <div
          className={`rounded-2xl border p-4 shadow-sm ${
            mondayEvening
              ? "border-amber-400 bg-amber-50"
              : "border-amber-200 bg-amber-50/70"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {mondayEvening
                  ? "Monday evening — still missing availability"
                  : "Have not submitted availability"}
              </p>
              <p className="text-xs text-amber-800/80 mt-0.5">
                {missingRows.length} supervisor{missingRows.length === 1 ? "" : "s"} / SL for week of{" "}
                {formatWeekRange(weekStart)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilter("missing");
                setSort("status");
              }}
              className="text-xs font-medium text-amber-900 underline"
            >
              Show in table
            </button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {missingRows.map(({ user }) => (
              <li
                key={user.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-amber-200 px-2.5 py-1 text-xs font-medium text-slate-800"
              >
                {user.name}
                <span className="text-muted font-normal">
                  {user.isShiftLeader ? "SL" : "Sup"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {[
            { label: "Submitted", value: `${data.stats.submitted}/${data.stats.supervisorsTotal}` },
            { label: "Missing", value: data.stats.missing, warn: data.stats.missing > 0 },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-2xl border p-4 shadow-sm ${
                s.warn ? "border-amber-300 bg-amber-50" : "border-border bg-white"
              }`}
            >
              <div
                className={`text-2xl font-bold ${
                  s.warn ? "text-amber-700" : "text-brand-600"
                }`}
              >
                {s.value}
              </div>
              <div className="text-sm text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {(["all", "submitted", "missing"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
                filter === f ? "bg-brand-600 text-white" : "bg-white border border-border text-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-slate-800"
          >
            <option value="name">Name</option>
            <option value="role">Role</option>
            <option value="status">Status</option>
            <option value="hagim">Hagim OK</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading roster…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase text-muted">
                <th className="px-3 py-3 font-semibold sticky left-0 bg-slate-50">Supervisor</th>
                <th className="px-3 py-3 font-semibold">Role</th>
                <th className="px-3 py-3 font-semibold">Hagim</th>
                {AVAILABILITY_DAYS.map((_, idx) => (
                  <th key={idx} className="px-2 py-3 font-semibold text-center min-w-[72px]">
                    {DAY_LABELS[idx]}
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ user, submission }) => {
                const hagim = Boolean(
                  submission?.fridayContract ?? user.fridayContract
                );
                return (
                  <tr key={user.id} className="hover:bg-slate-50/50 align-top">
                    <td className="px-3 py-3 font-medium sticky left-0 bg-white">{user.name}</td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {user.isShiftLeader ? "Shift leader" : "Supervisor"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {hagim ? (
                        <span className="text-emerald-700 font-medium">Yes</span>
                      ) : (
                        <span className="text-muted">No</span>
                      )}
                    </td>
                    {AVAILABILITY_DAYS.map((day) => {
                      const dayEntry = submission?.days.find((d) => d.dayOfWeek === day);
                      return (
                        <td key={day} className="px-1 py-2 text-center align-top">
                          {!dayEntry ? (
                            <span className="text-slate-200">—</span>
                          ) : !dayEntry.canWork ? (
                            <div className="space-y-0.5">
                              <span className="inline-block text-[10px] font-bold text-red-600 bg-red-50 rounded px-1.5 py-0.5">
                                ✕
                              </span>
                              {dayEntry.note && (
                                <p
                                  className="text-[9px] text-muted leading-tight px-0.5"
                                  title={dayEntry.note}
                                >
                                  {dayEntry.note}
                                </p>
                              )}
                            </div>
                          ) : dayEntry.allDay ? (
                            <div className="space-y-0.5">
                              <span className="inline-block text-[10px] font-medium text-emerald-800 bg-emerald-50 rounded px-1.5 py-0.5">
                                All day
                              </span>
                              {dayEntry.note && (
                                <p
                                  className="text-[9px] text-muted leading-tight px-0.5"
                                  title={dayEntry.note}
                                >
                                  {dayEntry.note}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <div
                                className={`text-[10px] rounded px-1 py-0.5 leading-tight ${
                                  dayEntry.isNight
                                    ? "bg-indigo-100 text-indigo-900"
                                    : "bg-brand-50 text-brand-800"
                                }`}
                              >
                                {dayEntry.startTime}–{dayEntry.endTime === "00:00" &&
                                (dayEntry.endMinutes ?? 0) === 1440
                                  ? "00:00"
                                  : dayEntry.endTime}
                              </div>
                              {dayEntry.startTime2 && dayEntry.endTime2 && (
                                <div className="text-[10px] rounded px-1 py-0.5 leading-tight bg-slate-100 text-slate-700">
                                  {dayEntry.startTime2}–{dayEntry.endTime2}
                                </div>
                              )}
                              {dayEntry.note && (
                                <p
                                  className="text-[9px] text-muted leading-tight px-0.5"
                                  title={dayEntry.note}
                                >
                                  {dayEntry.note}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3">
                      {submission?.submittedAt ? (
                        <span className="text-xs font-medium text-emerald-700">Submitted</span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">Missing</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
