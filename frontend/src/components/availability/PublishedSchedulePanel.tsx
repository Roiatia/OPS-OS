import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import type { PublishedScheduleView } from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  defaultSubmissionWeekStart,
  formatWeekRange,
  isoWeekStart,
  weekStartSunday,
} from "../../lib/availabilityRules";

export function PublishedSchedulePanel() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<PublishedScheduleView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const schedule = await api.getPublishedSchedule(isoWeekStart(weekStart));
      setData(schedule);
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

  return (
    <div className="space-y-4">
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
            <p className="text-xs text-muted">Published weekly shift schedule</p>
          </div>
          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            →
          </button>
        </div>
        {data?.published && data.publishedAt && (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
            Published {new Date(data.publishedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading schedule…</p>
      ) : !data?.published ? (
        <div className="rounded-xl border border-dashed border-border bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-800">Schedule not published yet</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            OPS will publish next week’s roster after Auto-plan → review → Save &amp; publish. You’ll
            see everyone’s assignments here once that’s done.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {AVAILABILITY_DAYS.map((day, idx) => {
            const label = DAY_LABELS[idx];
            const mapsCount =
              data.mapsPerDay.find((m) => m.dayOfWeek === day)?.count ?? 0;
            const dayAssignments = data.assignments.filter((a) => a.dayOfWeek === day);
            return (
              <div key={day} className="rounded-xl border border-border bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <p className="font-semibold text-slate-900">{label}</p>
                  <p className="text-xs text-muted">
                    {mapsCount} map{mapsCount === 1 ? "" : "s"}
                  </p>
                </div>
                {dayAssignments.length === 0 ? (
                  <p className="text-xs text-muted">No staff assigned.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {dayAssignments.map((a) => {
                      const isMe = a.userId === data.viewerUserId;
                      return (
                        <span
                          key={`${a.dayOfWeek}-${a.userId}`}
                          className={`inline-flex items-center text-xs font-medium rounded-full px-2.5 py-1 ${
                            isMe
                              ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300"
                              : a.isShiftLeader
                                ? "bg-indigo-100 text-indigo-900"
                                : "bg-brand-50 text-brand-800"
                          }`}
                        >
                          {a.isShiftLeader ? "SL" : "Sup"} · {a.userName}
                          {isMe ? " (you)" : ""}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
