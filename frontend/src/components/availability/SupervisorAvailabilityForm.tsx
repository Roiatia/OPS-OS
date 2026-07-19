import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { AvailabilitySubmission } from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  DAY_LABELS_FULL,
  FRIDAY,
  FRIDAY_UNSIGNED_END_MINUTES,
  SUNDAY,
  countNightShiftsFromDays,
  defaultSubmissionWeekStart,
  formatWeekRange,
  isoWeekStart,
  validateAvailabilityDays,
  weekStartSunday,
  type AvailabilityDayInput,
} from "../../lib/availabilityRules";
import { holidaysInAvailabilityWeek } from "../../lib/israelHolidays";
import { DayHourDragBar } from "./DayHourDragBar";

type DayChoice = "unset" | "can" | "cant";

type LocalDay = {
  choice: DayChoice;
  allDay: boolean;
  startMinutes: number;
  endMinutes: number;
  hasSecond: boolean;
  startMinutes2: number;
  endMinutes2: number;
  note: string;
};

const DEFAULT_DAY: LocalDay = {
  choice: "unset",
  allDay: false,
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  hasSecond: false,
  startMinutes2: 16 * 60,
  endMinutes2: 20 * 60,
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
      hasSecond: day.startMinutes2 != null && day.endMinutes2 != null,
      startMinutes2: day.startMinutes2 ?? 16 * 60,
      endMinutes2: day.endMinutes2 ?? 20 * 60,
      note: day.note ?? "",
    };
  }
  return week;
}

function toPayload(
  days: LocalDay[],
  fridayContract: boolean,
  sundayOk: boolean
): AvailabilityDayInput[] {
  return AVAILABILITY_DAYS.map((dayOfWeek, idx) => {
    const d = days[idx];
    // Sunday only if sundayOk. Unsigned Friday allowed until 16:00 (validated separately).
    const blocked = dayOfWeek === SUNDAY && !sundayOk;
    const canWork = !blocked && d.choice === "can";
    const allDay = canWork && d.allDay && !(dayOfWeek === FRIDAY && !fridayContract);
    let endMinutes = canWork && !allDay ? d.endMinutes : null;
    let endMinutes2 = canWork && !allDay && d.hasSecond ? d.endMinutes2 : null;
    if (canWork && !allDay && dayOfWeek === FRIDAY && !fridayContract) {
      if (endMinutes != null) endMinutes = Math.min(endMinutes, FRIDAY_UNSIGNED_END_MINUTES);
      if (endMinutes2 != null) endMinutes2 = Math.min(endMinutes2, FRIDAY_UNSIGNED_END_MINUTES);
    }
    return {
      dayOfWeek,
      canWork,
      allDay,
      startMinutes: canWork && !allDay ? d.startMinutes : null,
      endMinutes,
      startMinutes2: canWork && !allDay && d.hasSecond ? d.startMinutes2 : null,
      endMinutes2,
      note: d.note.trim() || null,
    };
  });
}

function localValidationErrors(days: LocalDay[], sundayOk: boolean): string[] {
  const incomplete = days.some((d, idx) => {
    const day = AVAILABILITY_DAYS[idx];
    const blocked = day === SUNDAY && !sundayOk;
    return !blocked && d.choice === "unset";
  });
  if (incomplete) {
    return ["Mark every day with ✓ or ✕."];
  }
  return [];
}

export function SupervisorAvailabilityForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [fridayContract, setFridayContract] = useState(false);
  const [sundayOk, setSundayOk] = useState(true);
  const [priorWeekNightShifts, setPriorWeekNightShifts] = useState(0);
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
      setSundayOk(data.sundayOk ?? !data.fridayContract);
      setPriorWeekNightShifts(data.nightShifts?.priorWeek ?? 0);
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

  const payloadDays = useMemo(
    () => toPayload(days, fridayContract, sundayOk),
    [days, fridayContract, sundayOk]
  );
  const validationErrors = useMemo(() => {
    const local = localValidationErrors(days, sundayOk);
    if (local.length > 0) return local;
    return validateAvailabilityDays(payloadDays, fridayContract, priorWeekNightShifts, {
      sundayOk,
      weekStart,
    });
  }, [days, fridayContract, sundayOk, payloadDays, priorWeekNightShifts, weekStart]);

  const weekHolidays = useMemo(() => holidaysInAvailabilityWeek(weekStart), [weekStart]);

  useEffect(() => {
    if (sundayOk) return;
    setDays((prev) =>
      prev.map((d, idx) => {
        const day = AVAILABILITY_DAYS[idx];
        return day === SUNDAY ? { ...d, choice: "cant" as const } : d;
      })
    );
  }, [sundayOk]);

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
        sundayOk,
        days: payloadDays,
      });
      setSubmittedAt(saved.submittedAt);
      setSuccess("Availability submitted.");
      onSubmitted?.();
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

      <div className="space-y-3">
        <label className="flex items-start gap-3 rounded-xl border border-border bg-white p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={fridayContract}
            onChange={(e) => {
              const on = e.target.checked;
              setFridayContract(on);
              // Without Friday form, Sunday is the normal option — keep it on.
              if (!on) setSundayOk(true);
            }}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-semibold text-slate-900">
              I signed the Friday work form (ששי + חגים)
            </span>
            <span className="block text-xs text-muted mt-0.5">
              Full Friday after Shabbat enter, and hagim. Tap Sunday below too if you can also work Sundays.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-border bg-white p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={sundayOk}
            onChange={(e) => setSundayOk(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-semibold text-slate-900">I can work Sunday</span>
            <span className="block text-xs text-muted mt-0.5">
              Without the Friday form you work Sunday (not hagim). Tap both Friday + Sunday if you can do shishi, hagim, and Sunday.
            </span>
          </span>
        </label>
      </div>

      <p className="text-xs text-muted">
        Drag hours from 00:00 → 00:00. Without the Friday form you may work Friday only until
        16:00 (Shabbat enter) — Thursday night into Friday morning is fine. Saturday is always
        off. Night shifts (from 23:00, 6h+): max 7 per 2 weeks — prior week: {priorWeekNightShifts},
        this week: {countNightShiftsFromDays(payloadDays)}. Shift length 6–12 hours; at least
        8 hours rest between shifts.
      </p>

      {weekHolidays.length > 0 && (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Hagim this week:{" "}
          {weekHolidays.map((h) => `${DAY_LABELS[h.dayOfWeek]} (${h.name})`).join(", ")}. Only
          supervisors who signed the Friday form can mark those days available.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
        {AVAILABILITY_DAYS.map((day, idx) => {
          const label = DAY_LABELS[idx];
          const dayState = days[idx];
          const blocked = day === SUNDAY && !sundayOk;
          const fridayCap = !fridayContract && day === FRIDAY;
          const holiday = weekHolidays.find((h) => h.dayOfWeek === day);
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
                  {holiday && (
                    <p className="text-[11px] font-medium text-amber-800 mt-0.5">חג · {holiday.name}</p>
                  )}
                  {fridayCap && (
                    <p className="text-[11px] font-medium text-violet-800 mt-0.5">
                      Until 16:00 without form
                    </p>
                  )}
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

              {blocked && <p className="text-xs text-muted">Not available — Friday form signed</p>}

              {!blocked && choice === "can" && (
                <div className="space-y-3">
                  {!fridayCap && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dayState.allDay}
                        onChange={(e) => updateDay(idx, { allDay: e.target.checked })}
                        className="rounded border-border"
                      />
                      <span className="text-xs font-medium text-slate-700">All day</span>
                    </label>
                  )}
                  {(!dayState.allDay || fridayCap) && (
                    <div className="space-y-3">
                      <DayHourDragBar
                        startMinutes={dayState.startMinutes}
                        endMinutes={
                          fridayCap
                            ? Math.min(dayState.endMinutes, FRIDAY_UNSIGNED_END_MINUTES)
                            : dayState.endMinutes
                        }
                        maxEndHour={fridayCap ? 16 : 24}
                        onChange={(startMinutes, endMinutes) =>
                          updateDay(idx, {
                            startMinutes,
                            endMinutes: fridayCap
                              ? Math.min(endMinutes, FRIDAY_UNSIGNED_END_MINUTES)
                              : endMinutes,
                            allDay: fridayCap ? false : dayState.allDay,
                          })
                        }
                      />
                      {dayState.hasSecond ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-slate-600">
                              Second block
                            </span>
                            <button
                              type="button"
                              onClick={() => updateDay(idx, { hasSecond: false })}
                              className="text-[11px] text-muted hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                          <DayHourDragBar
                            startMinutes={dayState.startMinutes2}
                            endMinutes={
                              fridayCap
                                ? Math.min(dayState.endMinutes2, FRIDAY_UNSIGNED_END_MINUTES)
                                : dayState.endMinutes2
                            }
                            maxEndHour={fridayCap ? 16 : 24}
                            onChange={(startMinutes2, endMinutes2) =>
                              updateDay(idx, {
                                startMinutes2,
                                endMinutes2: fridayCap
                                  ? Math.min(endMinutes2, FRIDAY_UNSIGNED_END_MINUTES)
                                  : endMinutes2,
                              })
                            }
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            updateDay(idx, {
                              hasSecond: true,
                              startMinutes2: Math.min(dayState.endMinutes + 60, 20 * 60),
                              endMinutes2: Math.min(dayState.endMinutes + 60 + 4 * 60, 24 * 60),
                            })
                          }
                          className="text-[11px] font-medium text-brand-600 hover:underline"
                        >
                          + Add second time block (e.g. after a break)
                        </button>
                      )}
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
