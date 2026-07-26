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

export interface UsageMetrics {
  range: { since: string; until: string; days: number };
  totals: { events: number; activeUsers: number };
  dau: { date: string; users: number }[];
  wau: number;
  sectionUsage: { section: string; views: number }[];
  roleActivity: { role: string; events: number; users: number }[];
  featureAdoption: { key: string; label: string; users: number }[];
  topUsers: { userId: string; name: string; events: number }[];
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
