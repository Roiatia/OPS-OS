import { useEffect } from "react";

const MAPS_POLL_MS = 15_000;

/** Keep map lists in sync while the dashboard is open. */
export function useMapsPolling(load: (opts?: { soft?: boolean }) => void) {
  useEffect(() => {
    const id = setInterval(() => load({ soft: true }), MAPS_POLL_MS);
    return () => clearInterval(id);
  }, [load]);
}
