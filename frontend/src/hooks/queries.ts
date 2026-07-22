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

/**
 * Demo users for the login picker. Retries with backoff so the list self-heals
 * across the brief window where the backend is restarting (e.g. `tsx watch`),
 * instead of permanently falling back to the hardcoded list on a single miss.
 */
export function useDemoUsersQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.demoUsers,
    queryFn: api.getDemoUsers,
    staleTime: 60_000,
    enabled,
    retry: 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
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

/**
 * Query keys for the availability / reports panels. These were previously
 * fetched with ad-hoc `useEffect` loaders that refetched on every tab switch;
 * routing them through React Query means re-visiting a tab within `staleTime`
 * is served instantly from cache.
 */
export const availabilityKeys = {
  shiftPlan: (weekStart: string) => ["shiftPlan", weekStart] as const,
  roster: (weekStart: string) => ["availabilityRoster", weekStart] as const,
  myAvailability: (weekStart: string) => ["myAvailability", weekStart] as const,
};

export const reportKeys = {
  list: (query: string) => ["reports", "list", query] as const,
  detail: (id: string) => ["reports", "detail", id] as const,
};

export function useShiftPlanQuery(weekStart: string) {
  return useQuery({
    queryKey: availabilityKeys.shiftPlan(weekStart),
    queryFn: () => api.getShiftPlan(weekStart),
    staleTime: MAPS_STALE_TIME,
  });
}

export function useAvailabilityRosterQuery(weekStart: string) {
  return useQuery({
    queryKey: availabilityKeys.roster(weekStart),
    queryFn: () => api.getAvailabilityRoster(weekStart),
    staleTime: MAPS_STALE_TIME,
  });
}

export function useMyAvailabilityQuery(weekStart: string, enabled = true) {
  return useQuery({
    queryKey: availabilityKeys.myAvailability(weekStart),
    queryFn: () => api.getMyAvailability(weekStart),
    staleTime: MAPS_STALE_TIME,
    enabled,
  });
}

export function useReportsListQuery(query: string) {
  return useQuery({
    queryKey: reportKeys.list(query),
    queryFn: () => api.getReports(query || undefined),
    staleTime: MAPS_STALE_TIME,
  });
}

export function useReportDetailQuery(id: string | null) {
  return useQuery({
    queryKey: reportKeys.detail(id ?? ""),
    queryFn: () => api.getReport(id as string),
    staleTime: MAPS_STALE_TIME,
    enabled: Boolean(id),
  });
}

/** Resolved feature flags for the current user (drives UI gating). */
export function useMyFeaturesQuery(enabled = true) {
  return useQuery({
    queryKey: ["features", "mine"],
    queryFn: api.getMyFeatures,
    staleTime: 60_000,
    enabled,
  });
}
