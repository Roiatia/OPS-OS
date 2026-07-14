import { useEffect, useRef } from "react";
import type { MapRecord } from "../types";

type Handlers = {
  onUpsert?: (maps: MapRecord[]) => void;
  onDeleted?: (mapIds: string[]) => void;
  onInvalidate?: () => void;
};

type ServerMessage =
  | { type: "maps:upsert"; maps: MapRecord[] }
  | { type: "maps:deleted"; mapIds: string[] }
  | { type: "maps:invalidate" };

/**
 * Live map updates over WebSocket. Replaces interval polling.
 * Reconnects with backoff if the socket drops.
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
          if (msg.type === "maps:upsert") h.onUpsert?.(msg.maps);
          else if (msg.type === "maps:deleted") h.onDeleted?.(msg.mapIds);
          else if (msg.type === "maps:invalidate") h.onInvalidate?.();
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
