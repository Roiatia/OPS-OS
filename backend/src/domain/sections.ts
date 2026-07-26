/**
 * Catalog of navigation sections tracked via `section_view` usage events.
 *
 * The `id` matches the section id emitted by the frontend dashboards (see the
 * role sidebars). This catalog lets the metrics service render human labels and,
 * crucially, surface catalog sections that have *zero* views in a range so that
 * unused areas of the product stay visible in the admin metrics screen.
 */
export interface SectionDef {
  id: string;
  label: string;
  /** Broad grouping for filtering / display. */
  group: "workspace" | "admin";
}

export const SECTION_CATALOG: SectionDef[] = [
  { id: "hub", label: "Hub", group: "workspace" },
  { id: "updates", label: "Updates", group: "workspace" },
  { id: "maps", label: "Maps", group: "workspace" },
  { id: "team", label: "Team", group: "workspace" },
  { id: "history", label: "History", group: "workspace" },
  { id: "reports", label: "Reports", group: "workspace" },
  { id: "company-dashboard", label: "Company Dashboard", group: "workspace" },
  { id: "availability", label: "Availability", group: "workspace" },
  { id: "confluence", label: "Confluence", group: "workspace" },
  { id: "settings", label: "Settings", group: "workspace" },
  { id: "overview", label: "Admin · Overview", group: "admin" },
  { id: "users", label: "Admin · Users", group: "admin" },
  { id: "features", label: "Admin · Features", group: "admin" },
  { id: "metrics", label: "Admin · Metrics", group: "admin" },
  { id: "audit", label: "Admin · Audit Log", group: "admin" },
];

const SECTION_BY_ID = new Map(SECTION_CATALOG.map((s) => [s.id, s]));

export function sectionLabel(id: string): string {
  return SECTION_BY_ID.get(id)?.label ?? id;
}

export function isKnownSection(id: string): boolean {
  return SECTION_BY_ID.has(id);
}

export function sectionGroup(id: string): "workspace" | "admin" | "other" {
  return SECTION_BY_ID.get(id)?.group ?? "other";
}
