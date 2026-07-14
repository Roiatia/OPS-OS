import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client used ONLY for Realtime broadcast subscriptions.
 *
 * The app still fetches all data through the authenticated REST API (which
 * enforces role-based visibility). Realtime is a lightweight "something
 * changed, refetch now" signal, so the anon key is all we need here.
 *
 * If the env vars are not configured, this is `null` and views fall back to
 * their existing polling behaviour.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 5 } },
      })
    : null;

export const realtimeEnabled = supabase !== null;

/** Channel + event names must match the backend (see backend/src/lib/realtime.ts). */
export const MAPS_CHANNEL = "ops-maps";
export const MAPS_CHANGED_EVENT = "maps_changed";

export interface MapsChangedPayload {
  mapId?: string;
  source?: string;
  at?: number;
}
