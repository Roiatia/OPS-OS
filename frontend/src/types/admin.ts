import type { RoleName } from "./core";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  active: boolean;
  createdAt: string;
  roles: RoleName[];
}

export interface AssignableRole {
  role: RoleName;
  label: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  isExperimental: boolean;
  rolloutRoles: RoleName[];
  /** Present in the admin management view: per-user overrides. */
  overrides?: { userId: string; userName: string; enabled: boolean }[];
}

/** The resolved on/off view for the current user (from GET /features/mine). */
export interface ResolvedFeature {
  key: string;
  label: string;
  description: string | null;
  isExperimental: boolean;
  enabled: boolean;
  /** True when the current user has a personal override in effect. */
  overridden: boolean;
}

export interface SectionUsage {
  section: string;
  label: string;
  group: "workspace" | "admin" | "other";
  views: number;
  users: number;
  /** Share of total section views, 0–100. */
  share: number;
  known: boolean;
}

export interface SectionSeries {
  section: string;
  label: string;
  points: { date: string; views: number }[];
}

export interface UsageMetrics {
  range: { since: string; until: string; days: number };
  totals: {
    events: number;
    activeUsers: number;
    sectionViews: number;
    usedSections: number;
    trackedSections: number;
  };
  dau: { date: string; users: number }[];
  dailyEvents: { date: string; events: number }[];
  wau: number;
  sectionUsage: SectionUsage[];
  sectionSeries: SectionSeries[];
  roleActivity: { role: string; events: number; users: number; share: number }[];
  featureAdoption: { key: string; label: string; users: number }[];
  topUsers: { userId: string; name: string; role: string | null; events: number; share: number }[];
  eventBreakdown: { event: string; count: number; share: number }[];
  phaseThroughput: { phase: string; count: number; avgHours: number | null }[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
  map: { id: string; mapNumber: string; client: string } | null;
}
