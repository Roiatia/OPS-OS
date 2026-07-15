import type { PrismaClient } from "@prisma/client";
import type { OpsDailyReportPayload } from "../../src/services/dailyReport.js";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function titleFor(date: Date): string {
  return `End of day — ${date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function demoPayload(reportDate: Date, variant: number): OpsDailyReportPayload {
  const dateKey = reportDate.toISOString().slice(0, 10);
  const hadLeader = variant % 3 !== 0;

  const payload: OpsDailyReportPayload = {
    reportDate: dateKey,
    shift: {
      members: [
        {
          id: "demo-alex",
          name: "Alex Ben-Ami",
          isShiftLeader: false,
          shiftStartedAt: new Date(reportDate.getTime() + 8 * 60 * 60 * 1000).toISOString(),
        },
        ...(hadLeader
          ? [
              {
                id: "demo-dana",
                name: "Dana Weiss",
                isShiftLeader: true,
                shiftStartedAt: new Date(reportDate.getTime() + 7.5 * 60 * 60 * 1000).toISOString(),
              },
            ]
          : []),
      ],
      shiftLeaderCount: hadLeader ? 1 : 0,
      hadShiftLeader: hadLeader,
    },
    field: {
      completed: [
        {
          mapId: `demo-complete-${variant}`,
          mapNumber: `MAP-2024-010${variant}`,
          client: variant % 2 === 0 ? "Urban Retail" : "CityShop",
          supervisorName: "Alex Ben-Ami",
          reason: null,
        },
      ],
      incomplete:
        variant % 4 === 0
          ? [
              {
                mapId: `demo-incomplete-${variant}`,
                mapNumber: `MAP-2024-010${variant + 1}`,
                client: "GreenGrocer",
                supervisorName: "Alex Ben-Ami",
                reason: "Store closed early — partial coverage only",
              },
            ]
          : [],
      cancelled: [],
    },
    graphics: {
      milestones: [
        {
          action: "upload_approved",
          label: "Upload stage complete",
          mapNumber: `MAP-2024-010${variant + 2}`,
          client: "MegaStore",
          userName: "Maya Rosen",
          at: new Date(reportDate.getTime() + 14 * 60 * 60 * 1000).toISOString(),
          note: null,
        },
      ],
    },
    ops: {
      acceptedToPolish:
        variant % 2 === 0
          ? [
              {
                action: "field_complete",
                label: "Mapping accepted — sent to polish",
                mapNumber: `MAP-2024-010${variant}`,
                client: variant % 2 === 0 ? "Urban Retail" : "CityShop",
                userName: "Rachel Ops",
                at: new Date(reportDate.getTime() + 16 * 60 * 60 * 1000).toISOString(),
                note: null,
              },
            ]
          : [],
    },
    pipeline: {
      totalMaps: 24 + variant,
      newFromCs: 2,
      atGraphics: 6,
      inField: 8 - (variant % 3),
      readyToAccept: 1 + (variant % 2),
      approved: 4,
    },
    alerts: [],
  };

  if (!hadLeader) {
    payload.alerts.push("No shift leader was on shift today.");
  }
  if (payload.field.incomplete.length > 0) {
    payload.alerts.push(`${payload.field.incomplete.length} map(s) marked incomplete — review reschedule.`);
  }

  return payload;
}

function buildSummary(payload: OpsDailyReportPayload): string {
  return [
    payload.reportDate,
    `${payload.field.completed.length} field complete`,
    `${payload.field.incomplete.length} field incomplete`,
    ...payload.field.completed.map((m) => m.mapNumber),
    ...payload.field.incomplete.map((m) => m.mapNumber),
    ...payload.shift.members.map((m) => m.name),
    ...payload.alerts,
  ].join(" ");
}

export async function seedDemoReports(prisma: PrismaClient) {
  const count = await prisma.opsDailyReport.count();
  if (count > 0) {
    console.log("Daily reports already exist — skipping demo report seed.");
    return;
  }

  console.log("Seeding demo daily reports...");
  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const reportDate = daysAgo(daysBack);
    const payload = demoPayload(reportDate, daysBack);
    const generatedAt = new Date(reportDate);
    generatedAt.setHours(23, 0, 0, 0);

    await prisma.opsDailyReport.create({
      data: {
        reportDate,
        title: titleFor(reportDate),
        summary: buildSummary(payload),
        payload,
        generatedAt,
      },
    });
    console.log(`  ✓ ${payload.reportDate}`);
  }
}
