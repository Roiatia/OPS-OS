import type { ResolvedFeature } from "../types";

/**
 * Feature keys known to the frontend. Kept in sync with the backend catalog in
 * `backend/src/domain/features.ts`.
 */
export const FEATURE = {
  updates: "section.updates",
  reports: "section.reports",
  companyDashboard: "section.company_dashboard",
  availability: "section.availability",
  confluence: "section.confluence",
  settings: "section.settings",
  notifications: "setting.notifications",
  autoAssignQa: "setting.auto_assign_qa",
  defaultView: "setting.default_view",
  adminMetrics: "admin.metrics",
} as const;

/**
 * Maps a dashboard nav section id to the feature flag that controls it. Sections
 * absent from this map are always visible.
 */
export const SECTION_FEATURE: Record<string, string> = {
  updates: FEATURE.updates,
  reports: FEATURE.reports,
  "company-dashboard": FEATURE.companyDashboard,
  availability: FEATURE.availability,
  confluence: FEATURE.confluence,
  settings: FEATURE.settings,
};

export type FeatureMap = Map<string, boolean>;

export function toFeatureMap(features: ResolvedFeature[] | undefined): FeatureMap {
  return new Map((features ?? []).map((f) => [f.key, f.enabled]));
}

/** Whether a feature is enabled. Unknown keys default to `true` (fail open). */
export function isFeatureEnabled(map: FeatureMap, key: string | undefined): boolean {
  if (!key) return true;
  return map.get(key) ?? true;
}

/** Whether a nav section should be shown given the resolved feature map. */
export function isSectionVisible(map: FeatureMap, sectionId: string): boolean {
  return isFeatureEnabled(map, SECTION_FEATURE[sectionId]);
}

/** Filter a list of nav items (each with an `id`) by feature visibility. */
export function filterVisibleSections<T extends { id: string }>(
  items: readonly T[],
  map: FeatureMap
): T[] {
  return items.filter((item) => isSectionVisible(map, item.id));
}
