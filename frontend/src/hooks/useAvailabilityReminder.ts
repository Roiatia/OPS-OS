import { useState } from "react";
import { useMyAvailabilityQuery } from "@/hooks/queries";
import {
  defaultSubmissionWeekStart,
  formatWeekRange,
  isAvailabilityReminderDue,
  isoWeekStart,
} from "@/lib/availabilityRules";

const DISMISSED_KEY = "ops-os-availability-reminder-dismissed";

function loadDismissedWeeks(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveDismissedWeeks(weeks: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...weeks]));
  } catch {
    // ignore
  }
}

export function useAvailabilityReminder(enabled: boolean) {
  const [targetWeek] = useState(() => defaultSubmissionWeekStart());
  const weekStart = isoWeekStart(targetWeek);
  const weekLabel = formatWeekRange(targetWeek);
  const [dismissedWeeks, setDismissedWeeks] = useState(loadDismissedWeeks);
  const [snoozed, setSnoozed] = useState(false);

  // Shares the "my availability" cache with SupervisorAvailabilityForm, so the
  // supervisor dashboard fetches it once and a fresh submission (which writes
  // the cache) immediately clears the reminder.
  const availabilityQuery = useMyAvailabilityQuery(weekStart, enabled);
  const loading = enabled && availabilityQuery.isLoading;
  const missing = enabled && availabilityQuery.data ? !availabilityQuery.data.submittedAt : false;

  const dismissed = dismissedWeeks.has(weekStart);
  const show =
    enabled && !loading && missing && !dismissed && !snoozed && isAvailabilityReminderDue();

  function dismiss() {
    setDismissedWeeks((prev) => {
      const next = new Set(prev);
      next.add(weekStart);
      saveDismissedWeeks(next);
      return next;
    });
  }

  function snooze() {
    setSnoozed(true);
  }

  function unsnooze() {
    setSnoozed(false);
  }

  /** When opening Availability nav — nudge again even if dismissed earlier today */
  function promptNow() {
    setDismissedWeeks((prev) => {
      if (!prev.has(weekStart)) return prev;
      const next = new Set(prev);
      next.delete(weekStart);
      saveDismissedWeeks(next);
      return next;
    });
    setSnoozed(false);
  }

  return {
    show,
    missing,
    weekStart,
    weekLabel,
    dismiss,
    snooze,
    unsnooze,
    promptNow,
    refresh: () => availabilityQuery.refetch(),
  };
}
