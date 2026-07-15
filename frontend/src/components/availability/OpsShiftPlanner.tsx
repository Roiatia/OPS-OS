import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { ShiftPlanAssignment, ShiftPlanView } from "../../types/availability";
import {
  AVAILABILITY_DAYS,
  DAY_LABELS,
  defaultSubmissionWeekStart,
  formatWeekRange,
  isoWeekStart,
  weekStartSunday,
} from "../../lib/availabilityRules";

export function OpsShiftPlanner() {
  const [weekStart, setWeekStart] = useState(() => defaultSubmissionWeekStart());
  const [data, setData] = useState<ShiftPlanView | null>(null);
  const [assignments, setAssignments] = useState<ShiftPlanAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const plan = await api.getShiftPlan(isoWeekStart(weekStart));
      setData(plan);
      setAssignments(plan.assignments);
      setWarnings(plan.warnings);
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

  const mapsByDay = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of data?.mapsPerDay ?? []) {
      map.set(entry.dayOfWeek, entry.count);
    }
    return map;
  }, [data]);

  function availableStaff(dayOfWeek: number, isShiftLeader: boolean) {
    return (data?.staff ?? []).filter((s) => {
      if (s.isShiftLeader !== isShiftLeader) return false;
      const day = s.days.find((d) => d.dayOfWeek === dayOfWeek);
      return Boolean(day?.canWork);
    });
  }

  function addAssignment(dayOfWeek: number, userId: string) {
    const person = data?.staff.find((s) => s.userId === userId);
    if (!person) return;
    if (assignments.some((a) => a.dayOfWeek === dayOfWeek && a.userId === userId)) return;
    setAssignments((prev) => [
      ...prev,
      {
        dayOfWeek,
        userId: person.userId,
        userName: person.name,
        isShiftLeader: person.isShiftLeader,
      },
    ]);
    setSuccess("");
  }

  function removeAssignment(dayOfWeek: number, userId: string) {
    setAssignments((prev) =>
      prev.filter((a) => !(a.dayOfWeek === dayOfWeek && a.userId === userId))
    );
    setSuccess("");
  }

  async function handleAuto() {
    setAutoRunning(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.autoGenerateShiftPlan(isoWeekStart(weekStart));
      setAssignments(result.assignments);
      setWarnings(result.warnings);
      if (result.dayPlans) {
        setData((prev) => (prev ? { ...prev, dayPlans: result.dayPlans } : prev));
      }
      setSuccess("Auto-plan generated — review and save.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAutoRunning(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.saveShiftPlan({
        weekStart: isoWeekStart(weekStart),
        assignments,
      });
      setWarnings(result.warnings);
      if (result.dayPlans && data) {
        setData({ ...data, dayPlans: result.dayPlans, saved: true });
      }
      setSuccess("Shift plan saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dayPlans = data?.dayPlans ?? [];

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
            <p className="text-xs text-muted">Plan supervisors &amp; shift leaders vs field maps</p>
          </div>
          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-slate-50"
          >
            →
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleAuto()}
            disabled={autoRunning || loading}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-brand-300 text-brand-700 bg-brand-50 hover:bg-brand-100 disabled:opacity-50"
          >
            {autoRunning ? "Planning…" : "Auto-plan"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 list-disc pl-5 space-y-1">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
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

      {loading ? (
        <p className="text-muted">Loading shift plan…</p>
      ) : (
        <div className="space-y-4">
          {AVAILABILITY_DAYS.map((day, idx) => {
            const label = DAY_LABELS[idx];
            const mapsCount = mapsByDay.get(day) ?? 0;
            const dayPlan = dayPlans.find((d) => d.dayOfWeek === day);
            const dayAssignments = assignments.filter((a) => a.dayOfWeek === day);
            const mapsList = data?.mapsPerDay.find((m) => m.dayOfWeek === day)?.maps ?? [];
            const slPool = availableStaff(day, true);
            const supPool = availableStaff(day, false);

            return (
              <div
                key={day}
                className={`rounded-xl border p-4 ${
                  dayPlan && !dayPlan.ok && mapsCount > 0
                    ? "border-amber-300 bg-amber-50/40"
                    : "border-border bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold text-slate-900">{label}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {mapsCount} field map{mapsCount === 1 ? "" : "s"}
                      {dayPlan && mapsCount > 0
                        ? ` · staff needed ~${dayPlan.staffNeeded} (1 SL + supervisors)`
                        : ""}
                    </p>
                  </div>
                  {mapsCount > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) addAssignment(day, e.target.value);
                          e.target.value = "";
                        }}
                      >
                        <option value="">+ Shift leader</option>
                        {slPool.map((s) => (
                          <option key={s.userId} value={s.userId}>
                            {s.name}
                            {!s.submitted ? " (no availability)" : ""}
                          </option>
                        ))}
                      </select>
                      <select
                        className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) addAssignment(day, e.target.value);
                          e.target.value = "";
                        }}
                      >
                        <option value="">+ Supervisor</option>
                        {supPool.map((s) => (
                          <option key={s.userId} value={s.userId}>
                            {s.name}
                            {!s.submitted ? " (no availability)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {mapsList.length > 0 && (
                  <p className="text-[11px] text-muted mb-2">
                    Maps: {mapsList.map((m) => m.mapNumber).join(", ")}
                  </p>
                )}

                {dayAssignments.length === 0 ? (
                  <p className="text-xs text-muted">
                    {mapsCount === 0 ? "No maps scheduled." : "No staff assigned yet."}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {dayAssignments.map((a) => (
                      <span
                        key={`${a.dayOfWeek}-${a.userId}`}
                        className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${
                          a.isShiftLeader
                            ? "bg-indigo-100 text-indigo-900"
                            : "bg-brand-50 text-brand-800"
                        }`}
                      >
                        {a.isShiftLeader ? "SL" : "Sup"} · {a.userName}
                        <button
                          type="button"
                          onClick={() => removeAssignment(a.dayOfWeek, a.userId)}
                          className="text-slate-500 hover:text-slate-800 ml-0.5"
                          aria-label={`Remove ${a.userName}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
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
