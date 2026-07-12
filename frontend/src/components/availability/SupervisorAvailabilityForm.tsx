import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { AvailabilitySubmission } from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  DAY_LABELS_FULL,
  defaultSubmissionWeekStart,
  formatWeekRange,
  isoWeekStart,
  timeToMinutes,
  validateAvailabilityDays,
  weekStartSunday,
  type AvailabilityDayInput,
} from "../../lib/availabilityRules";

type DayChoice = "unset" | "can" | "cant";

type LocalDay = {
  choice: DayChoice;
  allDay: boolean;
  startMinutes: number;
  endMinutes: number;
  note: string;
};

const DEFAULT_DAY: LocalDay = {
  choice: "unset",
  allDay: false,
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  note: "",
};

function emptyWeek(): LocalDay[] {
  return AVAILABILITY_DAYS.map(() => ({ ...DEFAULT_DAY }));
}

function daysFromSubmission(data: AvailabilitySubmission): LocalDay[] {
  const week = emptyWeek();
  for (const day of data.days) {
    if (day.dayOfWeek === 6) continue;
    const idx = AVAILABILITY_DAYS.indexOf(day.dayOfWeek as (typeof AVAILABILITY_DAYS)[number]);
    if (idx < 0) continue;
    week[idx] = {
      choice: day.canWork ? "can" : "cant",
      allDay: day.allDay,
      startMinutes: day.startMinutes ?? 9 * 60,
      endMinutes: day.endMinutes ?? 17 * 60,
      note: day.note ?? "",
    };
  }
  return week;
}

function toPayload(days: LocalDay[], fridayContract: boolean): AvailabilityDayInput[] {
  return AVAILABILITY_DAYS.map((dayOfWeek, idx) => {
    const d = days[idx];
    const blocked =
      (fridayContract && dayOfWeek === 0) || (!fridayContract && dayOfWeek === 5);
    const canWork = !blocked && d.choice === "can";
    return {
      dayOfWeek,
      canWork,
      allDay: canWork && d.allDay,
      startMinutes: canWork && !d.allDay ? d.startMinutes : null,
      endMinutes: canWork && !d.allDay ? d.endMinutes : null,
      note: d.note.trim() || null,
    };
  });
}

function localValidationErrors(days: LocalDay[], fridayContract: boolean): string[] {
  const incomplete = days.some((d, idx) => {
    const day = AVAILABILITY_DAYS[idx];
    const blocked =
      (fridayContract && day === 0) || (!fridayContract && day === 5);
    return !blocked && d.choice === "unset";
  });
  if (incomplete) {
    return ["Mark every day with ✓ or ✕."];
  }
  return [];
}

function minutesToInput(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function SupervisorAvailabilityForm() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [fridayContract, setFridayContract] = useState(false);
  const [days, setDays] = useState<LocalDay[]>(emptyWeek);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data: AvailabilitySubmission = await api.getMyAvailability(isoWeekStart(weekStart));
      setFridayContract(data.fridayContract);
      setSubmittedAt(data.submittedAt);
      setDays(daysFromSubmission(data));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const payloadDays = useMemo(() => toPayload(days, fridayContract), [days, fridayContract]);
  const validationErrors = useMemo(() => {
    const local = localValidationErrors(days, fridayContract);
    if (local.length > 0) return local;
    return validateAvailabilityDays(payloadDays, fridayContract);
  }, [days, fridayContract, payloadDays]);

  useEffect(() => {
    setDays((prev) =>
      prev.map((d, idx) => {
        const day = AVAILABILITY_DAYS[idx];
        const blocked =
          (fridayContract && day === 0) || (!fridayContract && day === 5);
        return blocked ? { ...d, choice: "cant" as const } : d;
      })
    );
  }, [fridayContract]);

  function changeWeek(delta: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(weekStartSunday(d));
  }

  function updateDay(day: number, patch: Partial<LocalDay>) {
    setDays((prev) => prev.map((d, i) => (i === day ? { ...d, ...patch } : d)));
  }

  function setDayChoice(idx: number, choice: "can" | "cant") {
    updateDay(idx, { choice, allDay: choice === "can" ? days[idx].allDay : false });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validationErrors.length > 0) {
      setError(validationErrors.join(" "));
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await api.saveMyAvailability({
        weekStart: isoWeekStart(weekStart),
        fridayContract,
        days: payloadDays,
      });
      setSubmittedAt(saved.submittedAt);
      setSuccess("Availability submitted.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-muted">Loading availability…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
            <p className="text-sm font-semibold text-slate-900">Week of {formatWeekRange(weekStart)}</p>
            <p className="text-xs text-muted">Submit every Sunday for the upcoming week</p>
          </div>
          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            →
          </button>
        </div>
        {submittedAt && (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
            Submitted {new Date(submittedAt).toLocaleString()}
          </span>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-border bg-white p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={fridayContract}
          onChange={(e) => setFridayContract(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="text-sm font-semibold text-slate-900">I signed the Friday contract</span>
        </span>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
        {AVAILABILITY_DAYS.map((day, idx) => {
          const label = DAY_LABELS[idx];
          const dayState = days[idx];
          const blocked =
            (fridayContract && day === 0) || (!fridayContract && day === 5);
          const choice = blocked ? "cant" : dayState.choice;

          return (
            <div
              key={day}
              className={`rounded-xl border p-4 flex flex-col gap-3 ${
                blocked ? "border-slate-200 bg-slate-50" : "border-border bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">{label}</p>
                  <p className="text-[11px] text-muted">{DAY_LABELS_FULL[idx]}</p>
                </div>
                {!blocked && (
                  <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
                    <button
                      type="button"
                      onClick={() => setDayChoice(idx, "can")}
                      aria-label={`Can work ${label}`}
                      className={`px-2.5 py-1.5 text-sm font-bold transition-colors ${
                        choice === "can"
                          ? "bg-emerald-600 text-white"
                          : "bg-white text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayChoice(idx, "cant")}
                      aria-label={`Cannot work ${label}`}
                      className={`px-2.5 py-1.5 text-sm font-bold border-l border-border transition-colors ${
                        choice === "cant"
                          ? "bg-red-500 text-white"
                          : "bg-white text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {blocked && (
                <p className="text-xs text-muted">Not available this week</p>
              )}

              {!blocked && choice === "can" && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dayState.allDay}
                      onChange={(e) => updateDay(idx, { allDay: e.target.checked })}
                      className="rounded border-border"
                    />
                    <span className="text-xs font-medium text-slate-700">All day</span>
                  </label>
                  {!dayState.allDay && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={minutesToInput(dayState.startMinutes)}
                        onChange={(e) =>
                          updateDay(idx, { startMinutes: timeToMinutes(e.target.value) })
                        }
                        className="flex-1 text-sm border border-border rounded-lg px-2 py-1.5"
                      />
                      <span className="text-muted text-sm">–</span>
                      <input
                        type="time"
                        value={minutesToInput(dayState.endMinutes)}
                        onChange={(e) =>
                          updateDay(idx, { endMinutes: timeToMinutes(e.target.value) })
                        }
                        className="flex-1 text-sm border border-border rounded-lg px-2 py-1.5"
                      />
                    </div>
                  )}
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted">Note for OPS</span>
                    <textarea
                      value={dayState.note}
                      onChange={(e) => updateDay(idx, { note: e.target.value })}
                      rows={2}
                      className="mt-1 w-full border border-border rounded-lg px-2 py-1.5 text-xs"
                      placeholder="Optional"
                    />
                  </label>
                </div>
              )}

              {!blocked && choice === "cant" && (
                <label className="block">
                  <span className="text-[11px] font-medium text-muted">Note for OPS</span>
                  <textarea
                    value={dayState.note}
                    onChange={(e) => updateDay(idx, { note: e.target.value })}
                    rows={2}
                    className="mt-1 w-full border border-border rounded-lg px-2 py-1.5 text-xs"
                    placeholder="Optional"
                  />
                </label>
              )}

              {!blocked && choice === "unset" && (
                <p className="text-xs text-muted">Choose ✓ or ✕</p>
              )}
            </div>
          );
        })}
      </div>

      {validationErrors.length > 0 && (
        <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 list-disc pl-5 space-y-1">
          {validationErrors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || validationErrors.length > 0}
        className="px-6 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "Submitting…" : "Submit availability"}
      </button>
    </form>
  );
}
