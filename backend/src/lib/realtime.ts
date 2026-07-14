/**
 * Supabase Realtime broadcast helper.
 *
 * We use Broadcast (not Postgres Changes) so we can keep our custom-JWT auth
 * and role-filtered REST endpoints. The backend just emits a lightweight
 * "something changed" signal; clients react by refetching through the API,
 * which still enforces per-user visibility.
 *
 * Sending goes through Realtime's stateless REST endpoint, so the API server
 * never holds a WebSocket open:
 *   POST {SUPABASE_URL}/realtime/v1/api/broadcast/{topic}/events/{event}
 */

/** Channel/topic every maps view subscribes to. */
export const MAPS_CHANNEL = "ops-maps";
/** Event name emitted whenever any map-related data changes. */
export const MAPS_CHANGED_EVENT = "maps_changed";

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const realtimeEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!realtimeEnabled) {
  console.warn(
    "[realtime] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — realtime broadcasts disabled (clients fall back to polling)."
  );
}

export interface MapsChangedPayload {
  /** The affected map, when the change is scoped to one map. */
  mapId?: string;
  /** Coarse hint about what happened (route path), for debugging/telemetry. */
  source?: string;
}

/**
 * Fire-and-forget broadcast that map data changed. Never throws — realtime is a
 * best-effort enhancement on top of polling, so a failure here must not break
 * the request that triggered it.
 */
export function broadcastMapsChanged(payload: MapsChangedPayload = {}): void {
  if (!realtimeEnabled) return;

  const url = `${SUPABASE_URL}/realtime/v1/api/broadcast/${MAPS_CHANNEL}/events/${MAPS_CHANGED_EVENT}`;

  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ ...payload, at: Date.now() }),
  }).catch((err) => {
    console.error("[realtime] broadcast failed:", (err as Error).message);
  });
}
