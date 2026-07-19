import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import { DEMO_OPS_UPDATES } from "@/lib/demoUpdates";
import type { OpsActivityMessage, OpsShiftAlert } from "@/types/activity";

const DISMISSED_STORAGE_KEY = "ops-os-dismissed-updates";

function loadDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore quota / private mode
  }
}

function withDemoFallback(notes: OpsActivityMessage[]): OpsActivityMessage[] {
  if (notes.length > 0) return notes;
  return DEMO_OPS_UPDATES;
}

export function useOpsUpdates(onActivity?: () => void, pollEnabled = true) {
  const [updates, setUpdates] = useState<OpsActivityMessage[]>([]);
  const [shiftAlerts, setShiftAlerts] = useState<OpsShiftAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissedIds);
  const sinceRef = useRef(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const poll = useCallback(async (fullReload = false) => {
    try {
      const since = fullReload ? undefined : sinceRef.current;
      const { feed, alerts } = await api.getHubNotifications(since);
      setShiftAlerts(alerts);
      if (feed.length > 0 || fullReload) {
        setUpdates((prev) => {
          if (fullReload) {
            return withDemoFallback(feed).slice(0, 120);
          }
          const ids = new Set(prev.map((n) => n.id));
          const merged = [...feed.filter((n) => !ids.has(n.id)), ...prev];
          return merged.slice(0, 120);
        });
        if (!fullReload && feed.length > 0) {
          sinceRef.current = new Date().toISOString();
          onActivityRef.current?.();
        }
      }
    } catch {
      if (fullReload) {
        setUpdates(DEMO_OPS_UPDATES);
        setShiftAlerts([]);
      }
    }
  }, []);

  // Always do one initial load so the sidebar badge is populated, but only run
  // the 15s live poll while the relevant section is open (gated by pollEnabled)
  // to avoid constant background churn on unrelated sections.
  useEffect(() => {
    void poll(true);
  }, [poll]);

  useEffect(() => {
    if (!pollEnabled) return;
    const interval = setInterval(() => poll(false), 15_000);
    return () => clearInterval(interval);
  }, [poll, pollEnabled]);

  const visible = useMemo(
    () => updates.filter((m) => !dismissed.has(m.id)),
    [updates, dismissed]
  );
  const visibleAlerts = useMemo(
    () => shiftAlerts.filter((a) => !dismissed.has(a.id)),
    [shiftAlerts, dismissed]
  );
  const dismissedUpdates = useMemo(
    () => updates.filter((m) => dismissed.has(m.id)),
    [updates, dismissed]
  );
  const dismissedAlerts = useMemo(
    () => shiftAlerts.filter((a) => dismissed.has(a.id)),
    [shiftAlerts, dismissed]
  );
  const dismissedCount = dismissedUpdates.length + dismissedAlerts.length;

  // Stable identities so memoized rows/columns don't re-render when the parent
  // dashboard re-renders for unrelated reasons.
  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissedIds(next);
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const m of visible) next.add(m.id);
      for (const a of visibleAlerts) next.add(a.id);
      saveDismissedIds(next);
      return next;
    });
  }, [visible, visibleAlerts]);

  const restore = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveDismissedIds(next);
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setDismissed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const m of dismissedUpdates) next.delete(m.id);
      for (const a of dismissedAlerts) next.delete(a.id);
      saveDismissedIds(next);
      return next;
    });
  }, [dismissedUpdates, dismissedAlerts]);

  return {
    updates: visible,
    shiftAlerts: visibleAlerts,
    dismissedUpdates,
    dismissedAlerts,
    dismissedCount,
    unreadCount: visible.length + visibleAlerts.length,
    dismiss,
    dismissAll,
    restore,
    restoreAll,
    refresh: () => poll(true),
  };
}

/** @deprecated use useOpsUpdates */
export const useOpsHubMessages = useOpsUpdates;
