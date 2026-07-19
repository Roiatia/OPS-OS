import type { QueryClient } from "@tanstack/react-query";
import type { HubSupervisor, MapRecord, TeamMember } from "../types";
import {
  applyMapUpsert,
  applyMapUpsertReplaceOnly,
  removeMapsById,
} from "./mapsLive";

/**
 * Central React Query keys for the shared map caches. Keeping them in one place
 * lets navigation reuse cached data (instant back/forward) and lets realtime +
 * mutations patch every relevant list from a single source of truth.
 */
export const queryKeys = {
  config: ["config"] as const,
  dashboard: ["dashboard"] as const,
  maps: ["maps"] as const,
  hub: ["hub"] as const,
  history: ["history"] as const,
};

/** Shared staleTime — navigation within this window serves from cache. */
export const MAPS_STALE_TIME = 30_000;

export interface DashboardData {
  maps: MapRecord[];
  team: TeamMember[];
  teamFieldMaps: MapRecord[];
}

export interface HubData {
  maps: MapRecord[];
  supervisors: HubSupervisor[];
}

/** Patch just the `maps` list of the dashboard cache. */
export function patchDashboardMaps(
  qc: QueryClient,
  updater: (maps: MapRecord[]) => MapRecord[]
): void {
  qc.setQueryData<DashboardData>(queryKeys.dashboard, (prev) =>
    prev ? { ...prev, maps: updater(prev.maps) } : prev
  );
}

/**
 * Apply realtime `maps:upsert` rows to every cached list. Active lists
 * (dashboard maps + supervisor field maps) use the scope-aware upsert that
 * signals a reload when an unknown/newly-in-scope map appears; role-filtered
 * lists (inspector/QA `maps`, hub, history) replace-in-place only.
 */
export function realtimeUpsert(qc: QueryClient, incoming: MapRecord[]): void {
  let needDashboardReload = false;

  qc.setQueryData<DashboardData>(queryKeys.dashboard, (prev) => {
    if (!prev) return prev;
    const activeMaps = applyMapUpsert(prev.maps, incoming);
    const fieldMaps = applyMapUpsert(prev.teamFieldMaps, incoming);
    if (activeMaps.needReload || fieldMaps.needReload) needDashboardReload = true;
    return { ...prev, maps: activeMaps.next, teamFieldMaps: fieldMaps.next };
  });

  qc.setQueryData<MapRecord[]>(queryKeys.maps, (prev) =>
    prev ? applyMapUpsertReplaceOnly(prev, incoming) : prev
  );

  qc.setQueryData<HubData>(queryKeys.hub, (prev) =>
    prev ? { ...prev, maps: applyMapUpsertReplaceOnly(prev.maps, incoming) } : prev
  );

  qc.setQueryData<MapRecord[]>(queryKeys.history, (prev) =>
    prev ? applyMapUpsertReplaceOnly(prev, incoming) : prev
  );

  if (needDashboardReload) {
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
  }
}

/** Apply realtime `maps:deleted` ids to every cached list. */
export function realtimeDelete(qc: QueryClient, ids: string[]): void {
  qc.setQueryData<DashboardData>(queryKeys.dashboard, (prev) =>
    prev
      ? {
          ...prev,
          maps: removeMapsById(prev.maps, ids),
          teamFieldMaps: removeMapsById(prev.teamFieldMaps, ids),
        }
      : prev
  );
  qc.setQueryData<MapRecord[]>(queryKeys.maps, (prev) =>
    prev ? removeMapsById(prev, ids) : prev
  );
  qc.setQueryData<HubData>(queryKeys.hub, (prev) =>
    prev ? { ...prev, maps: removeMapsById(prev.maps, ids) } : prev
  );
  qc.setQueryData<MapRecord[]>(queryKeys.history, (prev) =>
    prev ? removeMapsById(prev, ids) : prev
  );
}

/** Coarse realtime `maps:invalidate` — background-revalidate every map list. */
export function realtimeInvalidate(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
  void qc.invalidateQueries({ queryKey: queryKeys.maps });
  void qc.invalidateQueries({ queryKey: queryKeys.hub });
  void qc.invalidateQueries({ queryKey: queryKeys.history });
}
