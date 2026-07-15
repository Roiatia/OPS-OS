import {
  PrismaClient,
  MapPhase,
  InspectorStatus,
  FieldWorkStatus,
  SupervisorStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

const FIELD_MAPS = [
  { mapNumber: "HUB-DEMO-01", client: "FreshMart", area: "Netanya", assign: "alex" as const, progress: 20 },
  { mapNumber: "HUB-DEMO-02", client: "ShopRite", area: "Kfar Saba", assign: null, progress: null },
  { mapNumber: "HUB-DEMO-03", client: "North Market", area: "Haifa", assign: "dana" as const, progress: 45 },
  { mapNumber: "HUB-DEMO-04", client: "QuickMart", area: "Petah Tikva", assign: null, progress: null },
  { mapNumber: "HUB-DEMO-05", client: "SuperPharm", area: "Jerusalem", assign: "noam" as const, progress: 10 },
  { mapNumber: "HUB-DEMO-06", client: "Daily Mart", area: "Rehovot", assign: "alex" as const, progress: 60 },
  { mapNumber: "HUB-DEMO-07", client: "MiniStop", area: "Ra'anana", assign: "dana" as const, progress: 75 },
  { mapNumber: "HUB-DEMO-08", client: "Market City", area: "Holon", assign: null, progress: null },
  { mapNumber: "HUB-DEMO-09", client: "Blue Box", area: "Rishon", assign: "noam" as const, progress: 35 },
  { mapNumber: "HUB-DEMO-10", client: "Express Mart", area: "Bat Yam", assign: null, progress: null },
];

async function main() {
  const [alex, dana, noam, lior, inspector, ops] = await Promise.all([
    prisma.user.findUnique({ where: { email: "supervisor@ops-demo.local" } }),
    prisma.user.findUnique({ where: { email: "supervisor2@ops-demo.local" } }),
    prisma.user.findUnique({ where: { email: "supervisor3@ops-demo.local" } }),
    prisma.user.findUnique({ where: { email: "supervisor4@ops-demo.local" } }),
    prisma.user.findUnique({ where: { email: "inspector@ops-demo.local" } }),
    prisma.user.findUnique({ where: { email: "ops@ops-demo.local" } }),
  ]);

  if (!alex || !dana || !noam || !lior || !inspector || !ops) {
    throw new Error("Demo users missing — run seed first.");
  }

  const shiftAlex = todayAt(8, 0);
  const shiftDana = todayAt(7, 30);
  const shiftNoam = todayAt(8, 15);

  await prisma.user.update({ where: { id: alex.id }, data: { shiftStartedAt: shiftAlex } });
  await prisma.user.update({ where: { id: dana.id }, data: { shiftStartedAt: shiftDana } });
  await prisma.user.update({ where: { id: noam.id }, data: { shiftStartedAt: shiftNoam } });
  await prisma.user.update({ where: { id: lior.id }, data: { shiftStartedAt: null } });

  console.log("Today's shift:");
  console.log("  • Alex (supervisor) — on");
  console.log("  • Dana (shift leader) — on");
  console.log("  • Noam (supervisor) — on");
  console.log("  • Lior — off");

  const assignId = {
    alex: alex.id,
    dana: dana.id,
    noam: noam.id,
  };

  let created = 0;
  let updated = 0;

  for (let i = 0; i < FIELD_MAPS.length; i++) {
    const m = FIELD_MAPS[i];
    const fieldDate = todayAt(8 + (i % 6), (i * 7) % 60);
    const assignedSupervisorId = m.assign ? assignId[m.assign] : null;

    const data = {
      client: m.client,
      area: m.area,
      description: `Hub demo field map — ${m.client}`,
      phase: MapPhase.FIELD,
      inspectorStatus: InspectorStatus.DONE,
      uploadApproved: true,
      uploadCompletedAt: todayAt(7, 0),
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      fieldDate,
      fieldProgressPercent: m.progress ?? undefined,
      onHubStatusBoard: Boolean(m.assign && (m.progress ?? 0) >= 50),
      assignedInspectorId: inspector.id,
      assignedSupervisorId,
      supervisorStatus: null as SupervisorStatus | null,
      mapperName: assignedSupervisorId ? `Field Team ${String.fromCharCode(65 + (i % 3))}` : null,
    };

    const existing = await prisma.map.findUnique({ where: { mapNumber: m.mapNumber } });
    if (existing) {
      await prisma.map.update({ where: { id: existing.id }, data });
      updated += 1;
      console.log(`  ~ ${m.mapNumber} (${m.client})`);
    } else {
      const map = await prisma.map.create({
        data: {
          mapNumber: m.mapNumber,
          jiraTicketId: `OPS-HUB-${String(i + 1).padStart(2, "0")}`,
          ...data,
        },
      });
      await prisma.mapEvent.create({
        data: {
          mapId: map.id,
          userId: ops.id,
          action: "map_created",
          note: `Hub demo map ${m.mapNumber}`,
        },
      });
      created += 1;
      console.log(`  + ${m.mapNumber} (${m.client})`);
    }
  }

  const fieldToday = await prisma.map.count({
    where: {
      phase: MapPhase.FIELD,
      fieldDate: { gte: todayAt(0, 0), lt: new Date(todayAt(0, 0).getTime() + 86400000) },
    },
  });

  console.log(`\nDone: ${created} created, ${updated} updated.`);
  console.log(`FIELD maps with today's fieldDate: ${fieldToday}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
