import { MapPhase, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NEW_MAPS = [
  {
    mapNumber: "MAP-2026-0135",
    jiraTicketId: "OPS-6135",
    client: "FreshMart",
    area: "Netanya",
    description: "New intake from CS — awaiting assignment",
    dueDate: "2026-07-15",
  },
  {
    mapNumber: "MAP-2026-0136",
    jiraTicketId: "OPS-6136",
    client: "SuperPharm",
    area: "Jerusalem",
    description: "Store expansion layout from Jira ticket",
  },
  {
    mapNumber: "MAP-2026-0137",
    jiraTicketId: "OPS-6137",
    client: "Shufersal",
    area: "Petah Tikva",
    description: "Seasonal refresh — assign inspector",
  },
  {
    mapNumber: "MAP-2026-0138",
    jiraTicketId: "OPS-6138",
    client: "Rami Levy",
    area: "Kiryat Gat",
    description: "CS urgent request — new floor plan",
    dueDate: "2026-07-18",
  },
  {
    mapNumber: "MAP-2026-0139",
    jiraTicketId: "OPS-6139",
    client: "Victory",
    area: "Holon",
    description: "New branch opening map",
  },
];

async function main() {
  const leader = await prisma.user.findUnique({ where: { email: "leader@ops-demo.local" } });
  if (!leader) {
    throw new Error("Leader user not found — run npm run db:seed first");
  }

  let created = 0;
  for (const data of NEW_MAPS) {
    const existing = await prisma.map.findUnique({ where: { mapNumber: data.mapNumber } });
    if (existing) {
      console.log(`  skip ${data.mapNumber} (already exists)`);
      continue;
    }

    const map = await prisma.map.create({
      data: {
        mapNumber: data.mapNumber,
        jiraTicketId: data.jiraTicketId,
        client: data.client,
        area: data.area,
        description: data.description,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        phase: MapPhase.INTAKE,
      },
    });

    await prisma.mapPhaseHistory.create({
      data: {
        mapId: map.id,
        phase: MapPhase.INTAKE,
        userId: leader.id,
        note: "Map created from CS",
      },
    });

    await prisma.mapEvent.create({
      data: {
        mapId: map.id,
        userId: leader.id,
        action: "map_created",
        note: `From Jira ${data.jiraTicketId}`,
      },
    });

    console.log(`  ✓ ${data.mapNumber} — ${data.client}`);
    created++;
  }

  console.log(`\nAdded ${created} new map(s) to the intake box.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
