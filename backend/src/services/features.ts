import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { FEATURE_CATALOG, getFeatureDef } from "../domain/features.js";
import { userHasSuperAdminRole } from "../domain/roles.js";
import type { AuthUser } from "../lib/types.js";
import { hasAdminFeatureTables } from "../lib/schemaCapabilities.js";

export interface FeatureFlagView {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  isExperimental: boolean;
  rolloutRoles: RoleName[];
  overrides: { userId: string; userName: string; enabled: boolean }[];
}

export interface ResolvedFeature {
  key: string;
  label: string;
  description: string | null;
  isExperimental: boolean;
  enabled: boolean;
  overridden: boolean;
}

const MIGRATION_HINT =
  "Admin feature tables are missing — apply migration 20260722161000_admin_features_metrics";

function catalogFallback(user: AuthUser): ResolvedFeature[] {
  const isAdmin = userHasSuperAdminRole(user);
  return FEATURE_CATALOG.map((def) => ({
    key: def.key,
    label: def.label,
    description: def.description,
    isExperimental: def.isExperimental,
    enabled: isAdmin ? true : def.defaultEnabled,
    overridden: false,
  }));
}

/**
 * Ensure every catalog flag exists in the DB. Metadata (label/description/
 * experimental) is refreshed from code; admin-owned state (enabled, rollout) is
 * preserved once a row exists.
 */
export async function ensureCatalog(): Promise<void> {
  if (!(await hasAdminFeatureTables())) {
    throw new Error(MIGRATION_HINT);
  }
  for (const def of FEATURE_CATALOG) {
    await prisma.featureFlag.upsert({
      where: { key: def.key },
      update: {
        label: def.label,
        description: def.description,
        isExperimental: def.isExperimental,
      },
      create: {
        key: def.key,
        label: def.label,
        description: def.description,
        isExperimental: def.isExperimental,
        enabled: def.defaultEnabled,
        rolloutRoles: [],
      },
    });
  }
}

/** Full admin view of all flags with their per-user overrides. */
export async function listFlags(): Promise<FeatureFlagView[]> {
  await ensureCatalog();
  const flags = await prisma.featureFlag.findMany({
    orderBy: { label: "asc" },
    include: { overrides: { include: { user: true } } },
  });
  return flags.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    description: f.description,
    enabled: f.enabled,
    isExperimental: f.isExperimental,
    rolloutRoles: f.rolloutRoles,
    overrides: f.overrides.map((o) => ({
      userId: o.userId,
      userName: o.user.name,
      enabled: o.enabled,
    })),
  }));
}

/** Resolve whether a flag is on for a specific user (override > rollout > enabled). */
function resolveEnabled(
  flag: { enabled: boolean; rolloutRoles: RoleName[] },
  userRoles: RoleName[],
  override: boolean | undefined
): boolean {
  if (typeof override === "boolean") return override;
  if (!flag.enabled) return false;
  if (flag.rolloutRoles.length === 0) return true;
  return userRoles.some((r) => flag.rolloutRoles.includes(r));
}

/** The current user's resolved feature set (used by the frontend to gate UI). */
export async function resolveForUser(user: AuthUser): Promise<ResolvedFeature[]> {
  if (!(await hasAdminFeatureTables())) {
    return catalogFallback(user);
  }
  await ensureCatalog();
  const flags = await prisma.featureFlag.findMany({
    include: { overrides: { where: { userId: user.id } } },
  });
  const isAdmin = userHasSuperAdminRole(user);
  return flags.map((f) => {
    const override = f.overrides[0]?.enabled;
    // A personal override always wins (lets an admin opt out too). Absent an
    // override, super admin sees every feature (all-access); everyone else
    // resolves against the master switch + role rollout.
    const enabled =
      typeof override === "boolean"
        ? override
        : isAdmin
          ? true
          : resolveEnabled(f, user.roles, override);
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      isExperimental: f.isExperimental,
      enabled,
      overridden: typeof override === "boolean",
    };
  });
}

export async function updateFlag(
  key: string,
  data: {
    enabled?: boolean;
    isExperimental?: boolean;
    rolloutRoles?: RoleName[];
    label?: string;
    description?: string | null;
  }
): Promise<FeatureFlagView | null> {
  if (!getFeatureDef(key)) return null;
  await ensureCatalog();
  await prisma.featureFlag.update({
    where: { key },
    data: {
      ...(typeof data.enabled === "boolean" ? { enabled: data.enabled } : {}),
      ...(typeof data.isExperimental === "boolean"
        ? { isExperimental: data.isExperimental }
        : {}),
      ...(data.rolloutRoles ? { rolloutRoles: data.rolloutRoles } : {}),
      ...(data.label ? { label: data.label } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
  const [view] = (await listFlags()).filter((f) => f.key === key);
  return view ?? null;
}

/** Set (or clear when `enabled` is null) a per-user override for a flag.
 * When `experimentalOnly` is set, non-experimental flags are rejected so a
 * regular user cannot re-enable an admin-disabled capability for themselves. */
export async function setOverride(
  key: string,
  userId: string,
  enabled: boolean | null,
  experimentalOnly = false
): Promise<void> {
  if (!(await hasAdminFeatureTables())) {
    throw new Error(MIGRATION_HINT);
  }
  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) throw new Error("Unknown feature");
  if (experimentalOnly && !flag.isExperimental) {
    throw new Error("Only experimental features can be toggled for yourself");
  }
  if (enabled === null) {
    await prisma.featureFlagOverride.deleteMany({ where: { flagId: flag.id, userId } });
    return;
  }
  await prisma.featureFlagOverride.upsert({
    where: { flagId_userId: { flagId: flag.id, userId } },
    update: { enabled },
    create: { flagId: flag.id, userId, enabled },
  });
}
