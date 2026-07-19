import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MapRecord } from "@/types";
import {
  realtimeDelete,
  realtimeInvalidate,
  realtimeUpsert,
} from "@/lib/mapsCache";

type Handlers = {
  /** Fully-shaped changed maps — patch them into local state (no refetch). */
  onUpsert?: (maps: MapRecord[]) => void;
  /** Ids of deleted maps — remove them from local state. */
  onDeleted?: (mapIds: string[]) => void;
  /** Coarse signal (bulk/ambiguous change) — refetch. */
  onInvalidate?: () => void;
};

type ServerMessage =
  | { type: "maps:upsert"; maps: MapRecord[] }
  | { type: "maps:deleted"; mapIds: string[] }
  | { type: "maps:invalidate" };

/**
 * Live map updates over WebSocket. Server pushes the exact changed rows
 * (upsert/deleted) so pages patch state without refetching; "invalidate" is a
 * fallback for bulk writes. Reconnects with backoff if the socket drops.
 */
export function useMapsRealtime(handlers: Handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const token = localStorage.getItem("ops_token");
    if (!token) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    function connect() {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/api/ws?token=${encodeURIComponent(token!)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as ServerMessage;
          const h = handlersRef.current;
          if (msg.type === "maps:upsert") {
            if (h.onUpsert) h.onUpsert(msg.maps);
            else h.onInvalidate?.();
          } else if (msg.type === "maps:deleted") {
            if (h.onDeleted) h.onDeleted(msg.mapIds);
            else h.onInvalidate?.();
          } else if (msg.type === "maps:invalidate") {
            h.onInvalidate?.();
          }
        } catch {
          /* ignore malformed payloads */
        }
      };

      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(10_000, 1000 * 2 ** attempt);
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}

/**
 * Single app-level subscriber that routes realtime map events straight into the
 * shared React Query cache: upsert/deleted patch the cached lists in place,
 * invalidate triggers a background revalidate. Mounting this once (in the authed
 * Layout) keeps every page's cached data live without a per-page socket.
 */
export function useRealtimeCacheBridge() {
  const queryClient = useQueryClient();
  useMapsRealtime({
    onUpsert: (maps) => realtimeUpsert(queryClient, maps),
    onDeleted: (ids) => realtimeDelete(queryClient, ids),
    onInvalidate: () => realtimeInvalidate(queryClient),
  });
}
