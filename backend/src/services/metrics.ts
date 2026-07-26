import { prisma } from "../lib/prisma.js";
import { ROLE_LABELS } from "../lib/types.js";
import { SECTION_CATALOG, sectionGroup, sectionLabel } from "../domain/sections.js";

export interface SectionUsage {
  section: string;
  label: string;
  group: "workspace" | "admin" | "other";
  views: number;
  users: number;
  /** Share of total section views, 0–100 (1 decimal). */
  share: number;
  /** True when the section id is in the known navigation catalog. */
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
    /** Catalog sections that received at least one view in range. */
    usedSections: number;
    /** Total catalog sections tracked. */
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many top sections get a per-day time series (for sparklines). */
const SERIES_SECTIONS = 6;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export async function getUsageMetrics(days = 30): Promise<UsageMetrics> {
  const clampedDays = Math.min(Math.max(Math.floor(days) || 30, 1), 180);
  const until = new Date();
  const since = new Date(until.getTime() - clampedDays * DAY_MS);
  const weekAgo = new Date(until.getTime() - 7 * DAY_MS);

  const events = await prisma.usageEvent.findMany({
    where: { createdAt: { gte: since } },
    select: { userId: true, event: true, section: true, role: true, createdAt: true },
  });

  const activeUserSet = new Set<string>();
  const wauSet = new Set<string>();
  const dauMap = new Map<string, Set<string>>();
  const dailyEventMap = new Map<string, number>();
  const sectionMap = new Map<string, number>();
  const sectionUserMap = new Map<string, Set<string>>();
  const sectionDayMap = new Map<string, Map<string, number>>();
  const roleEvents = new Map<string, number>();
  const roleUsers = new Map<string, Set<string>>();
  const userEvents = new Map<string, number>();
  const userRole = new Map<string, string>();
  const eventTypeMap = new Map<string, number>();

  let sectionViews = 0;

  for (const e of events) {
    const dk = dayKey(e.createdAt);
    dailyEventMap.set(dk, (dailyEventMap.get(dk) ?? 0) + 1);
    eventTypeMap.set(e.event, (eventTypeMap.get(e.event) ?? 0) + 1);

    if (e.userId) {
      activeUserSet.add(e.userId);
      userEvents.set(e.userId, (userEvents.get(e.userId) ?? 0) + 1);
      if (e.role && !userRole.has(e.userId)) userRole.set(e.userId, e.role);
      if (e.createdAt >= weekAgo) wauSet.add(e.userId);
      if (!dauMap.has(dk)) dauMap.set(dk, new Set());
      dauMap.get(dk)!.add(e.userId);
    }

    if (e.event === "section_view" && e.section) {
      sectionViews += 1;
      sectionMap.set(e.section, (sectionMap.get(e.section) ?? 0) + 1);
      if (e.userId) {
        if (!sectionUserMap.has(e.section)) sectionUserMap.set(e.section, new Set());
        sectionUserMap.get(e.section)!.add(e.userId);
      }
      if (!sectionDayMap.has(e.section)) sectionDayMap.set(e.section, new Map());
      const sd = sectionDayMap.get(e.section)!;
      sd.set(dk, (sd.get(dk) ?? 0) + 1);
    }

    if (e.role) {
      roleEvents.set(e.role, (roleEvents.get(e.role) ?? 0) + 1);
      if (e.userId) {
        if (!roleUsers.has(e.role)) roleUsers.set(e.role, new Set());
        roleUsers.get(e.role)!.add(e.userId);
      }
    }
  }

  // Continuous day series across the range (fill gaps with 0).
  const dau: { date: string; users: number }[] = [];
  const dailyEvents: { date: string; events: number }[] = [];
  for (let t = since.getTime(); t <= until.getTime(); t += DAY_MS) {
    const dk = dayKey(new Date(t));
    dau.push({ date: dk, users: dauMap.get(dk)?.size ?? 0 });
    dailyEvents.push({ date: dk, events: dailyEventMap.get(dk) ?? 0 });
  }

  // Section usage — union of catalog sections (so zeros show up) and any
  // ad-hoc section ids seen in events but not in the catalog.
  const sectionIds = new Set<string>([
    ...SECTION_CATALOG.map((s) => s.id),
    ...sectionMap.keys(),
  ]);
  const sectionUsage: SectionUsage[] = [...sectionIds]
    .map((id) => {
      const views = sectionMap.get(id) ?? 0;
      return {
        section: id,
        label: sectionLabel(id),
        group: sectionGroup(id),
        views,
        users: sectionUserMap.get(id)?.size ?? 0,
        share: pct(views, sectionViews),
        known: SECTION_CATALOG.some((s) => s.id === id),
      };
    })
    .sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));

  const usedSections = SECTION_CATALOG.filter((s) => (sectionMap.get(s.id) ?? 0) > 0).length;

  // Per-day series for the busiest sections (for trend sparklines).
  const sectionSeries: SectionSeries[] = sectionUsage
    .filter((s) => s.views > 0)
    .slice(0, SERIES_SECTIONS)
    .map((s) => {
      const sd = sectionDayMap.get(s.section);
      const points: { date: string; views: number }[] = [];
      for (let t = since.getTime(); t <= until.getTime(); t += DAY_MS) {
        const dk = dayKey(new Date(t));
        points.push({ date: dk, views: sd?.get(dk) ?? 0 });
      }
      return { section: s.section, label: s.label, points };
    });

  const totalRoleEvents = [...roleEvents.values()].reduce((a, b) => a + b, 0);
  const roleActivity = [...roleEvents.entries()]
    .map(([role, count]) => ({
      role: ROLE_LABELS[role] ?? role,
      events: count,
      users: roleUsers.get(role)?.size ?? 0,
      share: pct(count, totalRoleEvents),
    }))
    .sort((a, b) => b.events - a.events);

  const eventBreakdown = [...eventTypeMap.entries()]
    .map(([event, count]) => ({ event, count, share: pct(count, events.length) }))
    .sort((a, b) => b.count - a.count);

  // Top users (join names).
  const topUserIds = [...userEvents.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const userRows = await prisma.user.findMany({
    where: { id: { in: topUserIds.map(([id]) => id) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));
  const topUsers = topUserIds.map(([userId, count]) => {
    const roleKey = userRole.get(userId);
    return {
      userId,
      name: nameById.get(userId) ?? "Unknown",
      role: roleKey ? ROLE_LABELS[roleKey] ?? roleKey : null,
      events: count,
      share: pct(count, events.length),
    };
  });

  // Feature adoption — number of users who have each flag force-enabled.
  const overrides = await prisma.featureFlagOverride.findMany({
    where: { enabled: true },
    include: { flag: true },
  });
  const adoption = new Map<string, { label: string; users: number }>();
  for (const o of overrides) {
    const cur = adoption.get(o.flag.key) ?? { label: o.flag.label, users: 0 };
    cur.users += 1;
    adoption.set(o.flag.key, cur);
  }
  const featureAdoption = [...adoption.entries()]
    .map(([key, v]) => ({ key, label: v.label, users: v.users }))
    .sort((a, b) => b.users - a.users);

  const phaseThroughput = await computePhaseThroughput(since);

  return {
    range: { since: since.toISOString(), until: until.toISOString(), days: clampedDays },
    totals: {
      events: events.length,
      activeUsers: activeUserSet.size,
      sectionViews,
      usedSections,
      trackedSections: SECTION_CATALOG.length,
    },
    dau,
    dailyEvents,
    wau: wauSet.size,
    sectionUsage,
    sectionSeries,
    roleActivity,
    featureAdoption,
    topUsers,
    eventBreakdown,
    phaseThroughput,
  };
}

/** Average time a map spent in each phase, from consecutive phase-history rows. */
async function computePhaseThroughput(
  since: Date
): Promise<{ phase: string; count: number; avgHours: number | null }[]> {
  const history = await prisma.mapPhaseHistory.findMany({
    where: { enteredAt: { gte: since } },
    select: { mapId: true, phase: true, enteredAt: true },
    orderBy: [{ mapId: "asc" }, { enteredAt: "asc" }],
  });

  const totals = new Map<string, { count: number; totalMs: number; durations: number }>();
  for (let i = 0; i < history.length; i++) {
    const cur = history[i];
    const bucket = totals.get(cur.phase) ?? { count: 0, totalMs: 0, durations: 0 };
    bucket.count += 1;
    const next = history[i + 1];
    if (next && next.mapId === cur.mapId) {
      bucket.totalMs += next.enteredAt.getTime() - cur.enteredAt.getTime();
      bucket.durations += 1;
    }
    totals.set(cur.phase, bucket);
  }

  return [...totals.entries()]
    .map(([phase, b]) => ({
      phase,
      count: b.count,
      avgHours: b.durations > 0 ? Math.round((b.totalMs / b.durations / 3_600_000) * 10) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface AuditLogEntry {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
  map: { id: string; mapNumber: string; client: string } | null;
}

export async function getAuditLog(query?: string, limit = 200): Promise<AuditLogEntry[]> {
  const q = query?.trim();
  const events = await prisma.mapEvent.findMany({
    where: q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
            { user: { name: { contains: q, mode: "insensitive" } } },
            { map: { mapNumber: { contains: q, mode: "insensitive" } } },
          ],
        }
      : undefined,
    include: {
      user: { select: { id: true, name: true } },
      map: { select: { id: true, mapNumber: true, client: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });

  return events.map((e) => ({
    id: e.id,
    action: e.action,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
    user: e.user ? { id: e.user.id, name: e.user.name } : null,
    map: e.map ? { id: e.map.id, mapNumber: e.map.mapNumber, client: e.map.client } : null,
  }));
}
