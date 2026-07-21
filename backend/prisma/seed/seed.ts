import { PrismaClient, RoleName } from "@prisma/client";

const prisma = new PrismaClient();

/** Demo graphics-team users */
const DEMO_USERS = [
  {
    email: "leader@ops-demo.local",
    name: "Sarah Cohen",
    roles: [RoleName.GRAPHIC_TEAM_LEADER] as RoleName[],
  },
  {
    email: "inspector@ops-demo.local",
    name: "David Levi",
    roles: [RoleName.MAPPING_INSPECTOR] as RoleName[],
  },
  {
    email: "inspector2@ops-demo.local",
    name: "Yossi Barak",
    roles: [RoleName.MAPPING_INSPECTOR] as RoleName[],
  },
  {
    email: "inspector3@ops-demo.local",
    name: "Noa Mizrahi",
    roles: [RoleName.MAPPING_INSPECTOR] as RoleName[],
  },
  {
    email: "inspector4@ops-demo.local",
    name: "Amir Goldberg",
    roles: [RoleName.MAPPING_INSPECTOR] as RoleName[],
  },
  {
    email: "qa@ops-demo.local",
    name: "Maya Rosen",
    roles: [RoleName.GRAPHIC_QA] as RoleName[],
  },
  {
    email: "qa2@ops-demo.local",
    name: "Rina Shalev",
    roles: [RoleName.GRAPHIC_QA] as RoleName[],
  },
  {
    email: "qa3@ops-demo.local",
    name: "Tomer Avivi",
    roles: [RoleName.GRAPHIC_QA] as RoleName[],
  },
  {
    email: "supervisor@ops-demo.local",
    name: "Alex Ben-Ami",
    roles: [RoleName.SUPERVISOR] as RoleName[],
  },
  {
    email: "supervisor2@ops-demo.local",
    name: "Dana Weiss",
    roles: [RoleName.SUPERVISOR_SHIFT_LEADER] as RoleName[],
  },
  {
    email: "supervisor3@ops-demo.local",
    name: "Noam Katz",
    roles: [RoleName.SUPERVISOR] as RoleName[],
  },
  {
    email: "supervisor4@ops-demo.local",
    name: "Lior Hadad",
    roles: [RoleName.SUPERVISOR] as RoleName[],
  },
  {
    email: "ops@ops-demo.local",
    name: "Rachel Ops",
    roles: [RoleName.OPS_ADMIN] as RoleName[],
  },
  {
    email: "ops2@ops-demo.local",
    name: "Miriam Levy",
    roles: [RoleName.OPS_MANAGER_2] as RoleName[],
  },
  {
    email: "opsmanager@ops-demo.local",
    name: "Noa Ops Manager",
    roles: [RoleName.OPS_MANAGER] as RoleName[],
  },
];

async function seedUsers() {
  console.log("Seeding users...");
  for (const demo of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: { name: demo.name },
      create: { email: demo.email, name: demo.name },
    });

    for (const role of demo.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }

    // Today's shift: Alex + Dana (SL) + Noam. Lior stays off.
    if (
      demo.email === "supervisor@ops-demo.local" ||
      demo.email === "supervisor2@ops-demo.local" ||
      demo.email === "supervisor3@ops-demo.local"
    ) {
      const shiftStart = new Date();
      if (demo.email === "supervisor2@ops-demo.local") shiftStart.setHours(7, 30, 0, 0);
      else if (demo.email === "supervisor3@ops-demo.local") shiftStart.setHours(8, 15, 0, 0);
      else shiftStart.setHours(8, 0, 0, 0);
      await prisma.user.update({
        where: { id: user.id },
        data: { shiftStartedAt: shiftStart },
      });
    }

    if (demo.email === "supervisor4@ops-demo.local") {
      await prisma.user.update({
        where: { id: user.id },
        data: { shiftStartedAt: null },
      });
    }

    console.log(`  ✓ ${demo.name} <${demo.email}> → ${demo.roles.join(", ")}`);
  }
}

async function seedSampleMaps() {
  const count = await prisma.map.count();
  if (count > 0) {
    console.log("Maps already exist — run npm run db:reseed-maps to replace with full demo set.");
    return;
  }

  const { seedDemoMaps } = await import("./demo-maps.js");
  await seedDemoMaps(prisma);
}

async function main() {
  await seedUsers();
  await seedSampleMaps();
  try {
    const { seedDemoReports } = await import("./seed-demo-reports.js");
    await seedDemoReports(prisma);
  } catch (err) {
    console.warn(
      "Demo reports seed skipped:",
      err instanceof Error ? err.message : err
    );
  }
  console.log("\nSeed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
