import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Add demo milestone events without wiping maps (safe for quick demo refresh) */
async function main() {
  const { seedDemoUpdateEvents } = await import("./demo-maps.js");

  const qa = await prisma.user.findUnique({ where: { email: "qa@ops-demo.local" } });
  const inspector = await prisma.user.findUnique({ where: { email: "inspector@ops-demo.local" } });
  const supervisor = await prisma.user.findUnique({ where: { email: "supervisor@ops-demo.local" } });
  const supervisor2 = await prisma.user.findUnique({ where: { email: "supervisor2@ops-demo.local" } });
  const ops = await prisma.user.findUnique({ where: { email: "ops@ops-demo.local" } });

  if (!qa || !inspector || !supervisor || !supervisor2 || !ops) {
    throw new Error("Demo users missing — run npm run db:seed first");
  }

  const milestoneActions = [
    "upload_approved",
    "qa_approved",
    "fix_done",
    "field_complete",
    "hub_completed",
    "hub_uncompleted",
    "hub_cancelled",
    "inspector_status",
  ];

  await prisma.mapEvent.deleteMany({
    where: { action: { in: milestoneActions } },
  });

  await seedDemoUpdateEvents(prisma, { qa, inspector, supervisor, supervisor2, ops });
  console.log("\nDemo updates reseed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
