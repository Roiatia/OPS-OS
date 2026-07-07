import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { HubNotification } from "../../types";

function labelForAction(action: string): string {
  switch (action) {
    case "hub_completed":
      return "Field mapping complete";
    case "hub_cancelled":
      return "Map cancelled";
    case "hub_uncompleted":
      return "Marked uncompleted";
    case "hub_progress":
      return "Progress updated";
    case "hub_reassigned":
      return "Supervisor reassigned";
    default:
      return "Hub update";
  }
}

interface Props {
  onActivity?: () => void;
}

export function OpsHubAlertsBar({ onActivity }: Props) {
  const [alerts, setAlerts] = useState<HubNotification[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const sinceRef = useRef(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const poll = useCallback(async () => {
    try {
      const notes = await api.getHubNotifications(sinceRef.current);
      if (notes.length > 0) {
        setAlerts((prev) => {
          const ids = new Set(prev.map((n) => n.id));
          const merged = [...notes.filter((n) => !ids.has(n.id)), ...prev];
          return merged.slice(0, 20);
        });
        sinceRef.current = new Date().toISOString();
        onActivity?.();
      }
    } catch {
      /* ignore poll errors */
    }
  }, [onActivity]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, [poll]);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  const completions = visible.filter((a) => a.action === "hub_completed");
  const others = visible.filter((a) => a.action !== "hub_completed");

  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  return (
    <div className="space-y-2">
      {completions.map((n) => (
        <div
          key={n.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm"
          role="status"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900">
              {labelForAction(n.action)}
            </p>
            <p className="text-sm text-emerald-800 mt-0.5">
              <Link to={`/app/maps/${n.map.id}`} className="font-mono font-medium hover:underline">
                {n.map.mapNumber}
              </Link>
              {" · "}
              {n.map.client}
              {" — "}
              {n.user.name}
            </p>
            <p className="text-xs text-emerald-700/80 mt-1">
              Updated in the Maps table as Complete. Ready for OPS to accept &amp; send to polish.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className="text-xs font-medium text-emerald-800 hover:text-emerald-950 shrink-0"
          >
            Dismiss
          </button>
        </div>
      ))}

      {others.slice(0, 3).map((n) => (
        <div
          key={n.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/80 px-3 py-2 text-sm"
        >
          <span className="text-slate-700">
            <span className="font-medium text-brand-800">{labelForAction(n.action)}</span>
            {" · "}
            {n.map.mapNumber} ({n.user.name})
          </span>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className="text-xs text-muted hover:text-slate-900 shrink-0"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
