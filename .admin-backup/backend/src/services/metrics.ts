import { prisma } from "../lib/prisma.js";
import { ROLE_LABELS } from "../lib/types.js";

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

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  // Totals
  const activeUserSet = new Set<string>();
  const wauSet = new Set<string>();
  const dauMap = new Map<string, Set<string>>();
  const sectionMap = new Map<string, number>();
  const roleEvents = new Map<string, number>();
  const roleUsers = new Map<string, Set<string>>();
  const userEvents = new Map<string, number>();

  for (const e of events) {
    if (e.userId) {
      activeUserSet.add(e.userId);
      userEvents.set(e.userId, (userEvents.get(e.userId) ?? 0) + 1);
      if (e.createdAt >= weekAgo) wauSet.add(e.userId);
      const dk = dayKey(e.createdAt);
      if (!dauMap.has(dk)) dauMap.set(dk, new Set());
      dauMap.get(dk)!.add(e.userId);
    }
    if (e.event === "section_view" && e.section) {
      sectionMap.set(e.section, (sectionMap.get(e.section) ?? 0) + 1);
    }
    if (e.role) {
      roleEvents.set(e.role, (roleEvents.get(e.role) ?? 0) + 1);
      if (e.userId) {
        if (!roleUsers.has(e.role)) roleUsers.set(e.role, new Set());
        roleUsers.get(e.role)!.add(e.userId);
      }
    }
  }

  // Build a continuous DAU series across the range (fill gaps with 0).
  const dau: { date: string; users: number }[] = [];
  for (let t = since.getTime(); t <= until.getTime(); t += DAY_MS) {
    const dk = dayKey(new Date(t));
    dau.push({ date: dk, users: dauMap.get(dk)?.size ?? 0 });
  }

  const sectionUsage = [...sectionMap.entries()]
    .map(([section, views]) => ({ section, views }))
    .sort((a, b) => b.views - a.views);

  const roleActivity = [...roleEvents.entries()]
    .map(([role, count]) => ({
      role: ROLE_LABELS[role] ?? role,
      events: count,
      users: roleUsers.get(role)?.size ?? 0,
    }))
    .sort((a, b) => b.events - a.events);

  // Top users (join names)
  const topUserIds = [...userEvents.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const userRows = await prisma.user.findMany({
    where: { id: { in: topUserIds.map(([id]) => id) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));
  const topUsers = topUserIds.map(([userId, count]) => ({
    userId,
    name: nameById.get(userId) ?? "Unknown",
    events: count,
  }));

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
    totals: { events: events.length, activeUsers: activeUserSet.size },
    dau,
    wau: wauSet.size,
    sectionUsage,
    roleActivity,
    featureAdoption,
    topUsers,
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
