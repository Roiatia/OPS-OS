import { useEffect, useRef } from "react";
import {
  supabase,
  MAPS_CHANNEL,
  MAPS_CHANGED_EVENT,
  type MapsChangedPayload,
} from "./supabase";

interface Options {
  /**
   * When set, only refetch if the change targets this map id. Broadcasts
   * without a mapId (bulk/list operations) always trigger a refetch.
   */
  mapId?: string;
  /** Coalesce rapid-fire changes into a single refetch. */
  debounceMs?: number;
}

/**
 * Subscribe to Supabase Realtime broadcasts and run `onChange` when map data
 * changes elsewhere. No-op when Realtime isn't configured, so callers keep
 * their polling fallback.
 */
export function useMapsRealtime(onChange: () => void, options: Options = {}) {
  const { mapId, debounceMs = 400 } = options;

  // Keep the latest callback without re-subscribing on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onChangeRef.current(), debounceMs);
    };

    const channel = client
      .channel(MAPS_CHANNEL)
      .on(
        "broadcast",
        { event: MAPS_CHANGED_EVENT },
        ({ payload }: { payload: MapsChangedPayload }) => {
          if (mapId && payload?.mapId && payload.mapId !== mapId) return;
          fire();
        }
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [mapId, debounceMs]);
}
