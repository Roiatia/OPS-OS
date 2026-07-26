/**
 * Catalog of known feature flags. Code is the source of truth for a flag's
 * metadata (label, description, experimental status); the database stores the
 * admin-controlled state (enabled, per-role rollout, per-user overrides).
 *
 * `key` is the stable identifier the frontend checks. Section keys map to
 * dashboard nav sections so admins can hide capabilities per role.
 */
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  isExperimental: boolean;
  /** Enabled state seeded the first time the flag is created in the DB. */
  defaultEnabled: boolean;
}

export const FEATURE_CATALOG: FeatureDef[] = [
  {
    key: "section.updates",
    label: "Ops Updates feed",
    description: "Live activity + alerts feed in the Ops dashboard.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "section.reports",
    label: "Daily Reports",
    description: "Auto-generated end-of-day operations reports.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "section.company_dashboard",
    label: "Company Dashboard",
    description: "Client-facing map dashboard rollup.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "section.availability",
    label: "Availability & Scheduling",
    description: "Shift availability forms and the weekly shift planner.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "section.confluence",
    label: "Confluence",
    description: "Embedded Confluence knowledge base (early preview).",
    isExperimental: true,
    defaultEnabled: false,
  },
  {
    key: "section.settings",
    label: "Settings",
    description: "Workspace preferences (notifications, auto-assign QA, default views).",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "setting.notifications",
    label: "Notifications preference",
    description: "Show and honor the email notifications toggle in Settings.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "setting.auto_assign_qa",
    label: "Auto-assign QA preference",
    description: "Show and honor the auto-assign QA toggle in Settings.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "setting.default_view",
    label: "Default view preference",
    description: "Show and honor the default Maps view toggle in Settings.",
    isExperimental: false,
    defaultEnabled: true,
  },
  {
    key: "admin.metrics",
    label: "Advanced usage metrics",
    description: "Deeper adoption analytics on the admin metrics page.",
    isExperimental: true,
    defaultEnabled: true,
  },
];

export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);

export function getFeatureDef(key: string): FeatureDef | undefined {
  return FEATURE_CATALOG.find((f) => f.key === key);
}
