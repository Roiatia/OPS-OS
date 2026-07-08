import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DEMO_OPS_UPDATES } from "./demoUpdates";
import type { OpsActivityMessage, OpsShiftAlert } from "../types/activity";

function withDemoFallback(notes: OpsActivityMessage[]): OpsActivityMessage[] {
  if (notes.length > 0) return notes;
  return DEMO_OPS_UPDATES;
}

export function useOpsUpdates(onActivity?: () => void) {
  const [updates, setUpdates] = useState<OpsActivityMessage[]>([]);
  const [shiftAlerts, setShiftAlerts] = useState<OpsShiftAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    void poll(true);
    const interval = setInterval(() => poll(false), 15_000);
    return () => clearInterval(interval);
  }, [poll]);

  const visible = updates.filter((m) => !dismissed.has(m.id));
  const visibleAlerts = shiftAlerts.filter((a) => !dismissed.has(a.id));

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  function dismissAll() {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const m of visible) next.add(m.id);
      for (const a of visibleAlerts) next.add(a.id);
      return next;
    });
  }

  return {
    updates: visible,
    shiftAlerts: visibleAlerts,
    unreadCount: visible.length + visibleAlerts.length,
    isDemoPreview: visible.some((u) => u.id.startsWith("demo-")),
    dismiss,
    dismissAll,
    refresh: () => poll(true),
  };
}

/** @deprecated use useOpsUpdates */
export const useOpsHubMessages = useOpsUpdates;
