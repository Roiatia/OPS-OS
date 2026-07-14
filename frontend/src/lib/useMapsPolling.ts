import { useEffect } from "react";
import { realtimeEnabled } from "./supabase";

/**
 * When Realtime is connected, updates arrive via broadcast, so polling is only
 * a slow safety net. Without Realtime, keep the original 15s cadence.
 */
const MAPS_POLL_MS = realtimeEnabled ? 60_000 : 15_000;

/** Keep map lists in sync while the dashboard is open. */
export function useMapsPolling(load: (opts?: { soft?: boolean }) => void) {
  useEffect(() => {
    const id = setInterval(() => load({ soft: true }), MAPS_POLL_MS);
    return () => clearInterval(id);
  }, [load]);
}
