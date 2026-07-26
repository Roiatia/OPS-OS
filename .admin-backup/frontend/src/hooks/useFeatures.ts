import { useMemo } from "react";
import { useMyFeaturesQuery } from "./queries";
import { toFeatureMap, isFeatureEnabled, type FeatureMap } from "../lib/features";
import type { ResolvedFeature } from "../types";

export interface UseFeaturesResult {
  map: FeatureMap;
  features: ResolvedFeature[];
  loading: boolean;
  /** True when a feature is enabled for the current user (unknown = true). */
  isEnabled: (key: string | undefined) => boolean;
}

/**
 * Resolved feature flags for the current user. While loading, features fail
 * open (treated as enabled) so the UI never flashes hidden then visible.
 */
export function useFeatures(enabled = true): UseFeaturesResult {
  const { data, isLoading } = useMyFeaturesQuery(enabled);
  const map = useMemo(() => toFeatureMap(data), [data]);
  return {
    map,
    features: data ?? [],
    loading: isLoading,
    isEnabled: (key) => isFeatureEnabled(map, key),
  };
}

/** Single-feature convenience wrapper. */
export function useFeature(key: string, enabled = true): boolean {
  const { isEnabled } = useFeatures(enabled);
  return isEnabled(key);
}
