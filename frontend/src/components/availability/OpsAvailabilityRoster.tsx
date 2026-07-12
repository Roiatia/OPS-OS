import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import type { AvailabilityRoster } from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  formatWeekRange,
  isoWeekStart,
  weekStartSunday,
  defaultSubmissionWeekStart,
} from "../../lib/availabilityRules";

export function OpsAvailabilityRoster() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<AvailabilityRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "submitted" | "missing">("all");

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

  const rows =
    data?.roster.filter((r) => {
      if (filter === "submitted") return Boolean(r.submission?.submittedAt);
      if (filter === "missing") return !r.submission?.submittedAt;
      return true;
    }) ?? [];

  const coverageOk =
    data &&
    data.stats.submitted >= data.stats.suggestedSupervisorsNeeded;

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

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Submitted", value: `${data.stats.submitted}/${data.stats.supervisorsTotal}` },
              { label: "Missing", value: data.stats.missing, warn: data.stats.missing > 0 },
              { label: "Maps (field)", value: data.stats.mapsScheduled },
              { label: "Suggested staff", value: data.stats.suggestedSupervisorsNeeded },
              { label: "Night shifts", value: data.stats.totalNightShifts },
              {
                label: "Coverage",
                value: coverageOk ? "OK" : "Low",
                warn: !coverageOk,
                ok: coverageOk,
              },
            ].map((s) => (
              <div
                key={s.label}
                className={`rounded-2xl border p-4 shadow-sm ${
                  s.warn
                    ? "border-amber-300 bg-amber-50"
                    : s.ok
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-border bg-white"
                }`}
              >
                <div
                  className={`text-2xl font-bold ${
                    s.warn ? "text-amber-700" : s.ok ? "text-emerald-700" : "text-brand-600"
                  }`}
                >
                  {s.value}
                </div>
                <div className="text-sm text-muted">{s.label}</div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted">
            Suggested staff ≈ 1 supervisor per 3 field maps from CS this week. Adjust assignments
            on the Hub once shifts are confirmed.
          </p>
        </>
      )}

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

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading roster…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase text-muted">
                <th className="px-3 py-3 font-semibold sticky left-0 bg-slate-50">Supervisor</th>
                <th className="px-3 py-3 font-semibold">Role</th>
                {AVAILABILITY_DAYS.map((_, idx) => (
                  <th key={idx} className="px-2 py-3 font-semibold text-center min-w-[72px]">
                    {DAY_LABELS[idx]}
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ user, submission }) => (
                <tr key={user.id} className="hover:bg-slate-50/50 align-top">
                  <td className="px-3 py-3 font-medium sticky left-0 bg-white">{user.name}</td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {user.isShiftLeader ? "Shift leader" : "Supervisor"}
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
                              <p className="text-[9px] text-muted leading-tight px-0.5" title={dayEntry.note}>
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
                              <p className="text-[9px] text-muted leading-tight px-0.5" title={dayEntry.note}>
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
                              {dayEntry.startTime}–{dayEntry.endTime}
                            </div>
                            {dayEntry.note && (
                              <p className="text-[9px] text-muted leading-tight px-0.5" title={dayEntry.note}>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
