import { MapPhase, RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  getActivityLabel,
  isMilestoneEvent,
  MILESTONE_ACTIONS,
  normalizeMilestoneAction,
} from "../lib/activityFeed.js";
import { SUPERVISOR_ROLE_NAMES, userIsShiftLeader } from "../lib/roles.js";

export interface OpsDailyReportMapItem {
  mapId: string;
  mapNumber: string;
  client: string;
  supervisorName: string | null;
  reason: string | null;
}

export interface OpsDailyReportMilestone {
  action: string;
  label: string;
  mapNumber: string;
  client: string;
  userName: string;
  at: string;
  note: string | null;
}

export interface OpsDailyReportShiftMember {
  id: string;
  name: string;
  isShiftLeader: boolean;
  shiftStartedAt: string | null;
}

export interface OpsDailyReportPayload {
  reportDate: string;
  shift: {
    members: OpsDailyReportShiftMember[];
    shiftLeaderCount: number;
    hadShiftLeader: boolean;
  };
  field: {
    completed: OpsDailyReportMapItem[];
    incomplete: OpsDailyReportMapItem[];
    cancelled: OpsDailyReportMapItem[];
  };
  graphics: {
    milestones: OpsDailyReportMilestone[];
  };
  ops: {
    acceptedToPolish: OpsDailyReportMilestone[];
  };
  pipeline: {
    totalMaps: number;
    newFromCs: number;
    atGraphics: number;
    inField: number;
    readyToAccept: number;
    approved: number;
  };
  alerts: string[];
}

export interface OpsDailyReportListItem {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  generatedAt: string;
  fieldCompleted: number;
  fieldIncomplete: number;
  shiftLeaderCount: number;
}

export interface OpsDailyReportDetail extends OpsDailyReportListItem {
  payload: OpsDailyReportPayload;
}

const GRAPHICS_PHASES: MapPhase[] = [
  MapPhase.PREP,
  MapPhase.UPLOAD_REVIEW,
  MapPhase.POLISH,
  MapPhase.QA_REVIEW,
];

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatReportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatReportTitle(date: Date): string {
  return `End of day — ${date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function buildSummary(payload: OpsDailyReportPayload): string {
  const parts = [
    payload.reportDate,
    `${payload.field.completed.length} field complete`,
    `${payload.field.incomplete.length} field incomplete`,
    `${payload.graphics.milestones.length} graphics milestones`,
    `${payload.ops.acceptedToPolish.length} accepted to polish`,
    `${payload.shift.members.length} on shift`,
    ...payload.field.completed.map((m) => m.mapNumber),
    ...payload.field.incomplete.map((m) => m.mapNumber),
    ...payload.graphics.milestones.map((m) => m.mapNumber),
    ...payload.shift.members.map((m) => m.name),
    ...payload.alerts,
  ];
  return parts.filter(Boolean).join(" ");
}

function toListItem(
  row: {
    id: string;
    reportDate: Date;
    title: string;
    summary: string;
    generatedAt: Date;
    payload: unknown;
  }
): OpsDailyReportListItem {
  const payload = row.payload as OpsDailyReportPayload;
  return {
    id: row.id,
    reportDate: formatReportDate(row.reportDate),
    title: row.title,
    summary: row.summary,
    generatedAt: row.generatedAt.toISOString(),
    fieldCompleted: payload.field.completed.length,
    fieldIncomplete: payload.field.incomplete.length,
    shiftLeaderCount: payload.shift.shiftLeaderCount,
  };
}

function incompleteReason(note: string | null, opsComment: string | null): string | null {
  if (note?.includes("—")) {
    const fromNote = note.split("—").slice(1).join("—").trim();
    if (fromNote) return fromNote;
  }
  return opsComment?.trim() || note?.trim() || null;
}

export async function buildDailyReportPayload(reportDate: Date): Promise<OpsDailyReportPayload> {
  const dayStart = startOfDay(reportDate);
  const dayEnd = endOfDay(reportDate);
  const dateKey = formatReportDate(reportDate);

  const [onShift, events, maps] = await Promise.all([
    prisma.user.findMany({
      where: {
        roles: { some: { role: { in: [...SUPERVISOR_ROLE_NAMES] } } },
        shiftStartedAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        name: true,
        shiftStartedAt: true,
        roles: { select: { role: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.mapEvent.findMany({
      where: { createdAt: { gte: dayStart, lte: dayEnd } },
      include: {
        user: { select: { name: true } },
        map: {
          select: {
            id: true,
            mapNumber: true,
            client: true,
            opsManagerComment: true,
            assignedSupervisor: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.map.findMany({
      select: {
        phase: true,
        uploadApproved: true,
        uploadCompletedAt: true,
        fieldWorkStatus: true,
        supervisorStatus: true,
      },
    }),
  ]);

  const shiftMembers: OpsDailyReportShiftMember[] = onShift.map((u) => ({
    id: u.id,
    name: u.name,
    isShiftLeader: userIsShiftLeader(u),
    shiftStartedAt: u.shiftStartedAt?.toISOString() ?? null,
  }));
  const shiftLeaderCount = shiftMembers.filter((m) => m.isShiftLeader).length;

  const completed: OpsDailyReportMapItem[] = [];
  const incomplete: OpsDailyReportMapItem[] = [];
  const cancelled: OpsDailyReportMapItem[] = [];
  const graphicsMilestones: OpsDailyReportMilestone[] = [];
  const acceptedToPolish: OpsDailyReportMilestone[] = [];
  const seenField = new Set<string>();

  for (const event of events) {
    if (!isMilestoneEvent(event.action, event.metadata)) continue;
    const action = normalizeMilestoneAction(event.action, event.metadata);
    const label = getActivityLabel(action);

    if (action === "hub_completed" || action === "hub_uncompleted" || action === "hub_cancelled") {
      const key = `${action}:${event.mapId}`;
      if (seenField.has(key)) continue;
      seenField.add(key);

      const item: OpsDailyReportMapItem = {
        mapId: event.map.id,
        mapNumber: event.map.mapNumber,
        client: event.map.client,
        supervisorName: event.map.assignedSupervisor?.name ?? null,
        reason:
          action === "hub_uncompleted"
            ? incompleteReason(event.note, event.map.opsManagerComment)
            : null,
      };

      if (action === "hub_completed") completed.push(item);
      else if (action === "hub_uncompleted") incomplete.push(item);
      else cancelled.push(item);
      continue;
    }

    if (
      (MILESTONE_ACTIONS as readonly string[]).includes(action) ||
      action === "inspector_done"
    ) {
      const milestone: OpsDailyReportMilestone = {
        action,
        label,
        mapNumber: event.map.mapNumber,
        client: event.map.client,
        userName: event.user.name,
        at: event.createdAt.toISOString(),
        note: event.note,
      };

      if (action === "field_complete") {
        acceptedToPolish.push(milestone);
      } else if (
        action !== "hub_completed" &&
        action !== "hub_uncompleted" &&
        action !== "hub_cancelled"
      ) {
        graphicsMilestones.push(milestone);
      }
    }
  }

  const alerts: string[] = [];
  if (shiftMembers.length > 0 && shiftLeaderCount === 0) {
    alerts.push("No shift leader was on shift today.");
  }
  if (incomplete.length > 0) {
    alerts.push(`${incomplete.length} map(s) marked incomplete — review reschedule.`);
  }

  const pipeline = {
    totalMaps: maps.length,
    newFromCs: maps.filter((m) => m.phase === MapPhase.INTAKE).length,
    atGraphics: maps.filter((m) => GRAPHICS_PHASES.includes(m.phase)).length,
    inField: maps.filter(
      (m) =>
        m.phase === MapPhase.FIELD &&
        !(m.fieldWorkStatus === "COMPLETED" || m.supervisorStatus === "DONE")
    ).length,
    readyToAccept: maps.filter(
      (m) =>
        m.phase === MapPhase.FIELD &&
        (m.fieldWorkStatus === "COMPLETED" || m.supervisorStatus === "DONE")
    ).length,
    approved: maps.filter((m) => m.phase === MapPhase.APPROVED).length,
  };

  return {
    reportDate: dateKey,
    shift: {
      members: shiftMembers,
      shiftLeaderCount,
      hadShiftLeader: shiftLeaderCount > 0,
    },
    field: { completed, incomplete, cancelled },
    graphics: { milestones: graphicsMilestones },
    ops: { acceptedToPolish },
    pipeline,
    alerts,
  };
}

export async function generateDailyReport(reportDate: Date) {
  const day = startOfDay(reportDate);
  const payload = await buildDailyReportPayload(day);
  const title = formatReportTitle(day);
  const summary = buildSummary(payload);

  return prisma.opsDailyReport.upsert({
    where: { reportDate: day },
    update: {
      title,
      summary,
      payload,
      generatedAt: new Date(),
    },
    create: {
      reportDate: day,
      title,
      summary,
      payload,
    },
  });
}

export async function listOpsDailyReports(query?: string): Promise<OpsDailyReportListItem[]> {
  const rows = await prisma.opsDailyReport.findMany({
    orderBy: { reportDate: "desc" },
  });

  const q = query?.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.summary.toLowerCase().includes(q) ||
          formatReportDate(r.reportDate).includes(q)
      )
    : rows;

  return filtered.map(toListItem);
}

export async function getOpsDailyReport(id: string): Promise<OpsDailyReportDetail | null> {
  const row = await prisma.opsDailyReport.findUnique({ where: { id } });
  if (!row) return null;
  return {
    ...toListItem(row),
    payload: row.payload as OpsDailyReportPayload,
  };
}

export async function ensureDailyReportForDate(reportDate: Date): Promise<boolean> {
  const day = startOfDay(reportDate);
  const existing = await prisma.opsDailyReport.findUnique({ where: { reportDate: day } });
  if (existing) return false;
  await generateDailyReport(day);
  return true;
}

/** After 23:00 local time — generates today's end-of-day report once per day */
export async function runDailyReportSchedulerTick(now = new Date()): Promise<void> {
  if (now.getHours() < 23) return;
  await ensureDailyReportForDate(now);
}

/** On server start after 23:00 — catch up if today's report was missed */
export async function catchUpDailyReportIfNeeded(now = new Date()): Promise<void> {
  if (now.getHours() < 23) return;
  await ensureDailyReportForDate(now);
}
