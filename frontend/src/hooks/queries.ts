import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { MAPS_STALE_TIME, queryKeys } from "../lib/mapsCache";

/**
 * Shared read hooks backed by React Query. A ~30s staleTime means navigating
 * away and back is served from cache instantly and revalidated in the
 * background instead of a cold refetch.
 */

export function useConfigQuery() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useDashboardQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: api.getDashboard,
    staleTime: MAPS_STALE_TIME,
  });
}

export function useMapsQuery() {
  return useQuery({
    queryKey: queryKeys.maps,
    queryFn: api.getMaps,
    staleTime: MAPS_STALE_TIME,
  });
}

export function useHubQuery() {
  return useQuery({
    queryKey: queryKeys.hub,
    queryFn: api.getHub,
    staleTime: MAPS_STALE_TIME,
    // Slow backstop poll — realtime carries most changes.
    refetchInterval: 45_000,
  });
}

export function useHistoryQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.history,
    queryFn: api.getHistoryMaps,
    staleTime: MAPS_STALE_TIME,
    enabled,
  });
}
