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
  console.log("\nSeed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
