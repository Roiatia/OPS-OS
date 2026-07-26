import { PrismaClient, RoleName } from "@prisma/client";

const prisma = new PrismaClient();

/** Contract caps on shift-plan days per week. */
const MAX_SHIFTS_PER_WEEK: Record<string, number> = {
  "millie@ops-demo.local": 3,
};

/** Real ops roster + placeholder QA/inspectors (real QA/inspectors later). */
const DEMO_USERS: { email: string; name: string; roles: RoleName[] }[] = [
  { email: "eitan@ops-demo.local", name: "Eitan", roles: [RoleName.GRAPHIC_TEAM_LEADER] },
  { email: "magali@ops-demo.local", name: "Magali", roles: [RoleName.OPS_ADMIN] },
  { email: "natali@ops-demo.local", name: "Natali", roles: [RoleName.OPS_MANAGER_2] },

  // Shift leaders
  { email: "zach@ops-demo.local", name: "Zach", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "sean@ops-demo.local", name: "Sean", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "rachel@ops-demo.local", name: "Rachel", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "tom@ops-demo.local", name: "Tom", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "erez@ops-demo.local", name: "Erez", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "talia@ops-demo.local", name: "Talia", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "oren@ops-demo.local", name: "Oren", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },
  { email: "aviad@ops-demo.local", name: "Aviad", roles: [RoleName.SUPERVISOR_SHIFT_LEADER] },

  // Supervisors
  { email: "igor@ops-demo.local", name: "Igor", roles: [RoleName.SUPERVISOR] },
  { email: "noam@ops-demo.local", name: "Noam", roles: [RoleName.SUPERVISOR] },
  { email: "ron@ops-demo.local", name: "Ron", roles: [RoleName.SUPERVISOR] },
  { email: "noam-a@ops-demo.local", name: "Noam A", roles: [RoleName.SUPERVISOR] },
  { email: "bashar@ops-demo.local", name: "Bashar", roles: [RoleName.SUPERVISOR] },
  { email: "george@ops-demo.local", name: "George", roles: [RoleName.SUPERVISOR] },
  { email: "omer@ops-demo.local", name: "Omer", roles: [RoleName.SUPERVISOR] },
  { email: "noam-bs@ops-demo.local", name: "Noam BS", roles: [RoleName.SUPERVISOR] },
  { email: "rivka@ops-demo.local", name: "Rivka", roles: [RoleName.SUPERVISOR] },
  { email: "elodie@ops-demo.local", name: "Elodie", roles: [RoleName.SUPERVISOR] },
  { email: "millie@ops-demo.local", name: "Millie", roles: [RoleName.SUPERVISOR] },
  { email: "roi@ops-demo.local", name: "Roi", roles: [RoleName.SUPERVISOR] },
  { email: "bashar-m@ops-demo.local", name: "Bashar M", roles: [RoleName.SUPERVISOR] },
  { email: "tomer@ops-demo.local", name: "Tomer", roles: [RoleName.SUPERVISOR] },
  { email: "eyal@ops-demo.local", name: "Eyal", roles: [RoleName.SUPERVISOR] },
  { email: "cosmin@ops-demo.local", name: "Cosmin", roles: [RoleName.SUPERVISOR] },
  { email: "sinai@ops-demo.local", name: "Sinai", roles: [RoleName.SUPERVISOR] },
  { email: "tal@ops-demo.local", name: "Tal", roles: [RoleName.SUPERVISOR] },
  { email: "chen@ops-demo.local", name: "Chen", roles: [RoleName.SUPERVISOR] },
  { email: "roni@ops-demo.local", name: "Roni", roles: [RoleName.SUPERVISOR] },
  { email: "lior@ops-demo.local", name: "Lior", roles: [RoleName.SUPERVISOR] },
  { email: "yaron@ops-demo.local", name: "Yaron", roles: [RoleName.SUPERVISOR] },
  { email: "kristina@ops-demo.local", name: "Kristina", roles: [RoleName.SUPERVISOR] },

  // Placeholder inspectors / QA — keep until real names arrive
  { email: "inspector@ops-demo.local", name: "David Levi", roles: [RoleName.MAPPING_INSPECTOR] },
  { email: "inspector2@ops-demo.local", name: "Yossi Barak", roles: [RoleName.MAPPING_INSPECTOR] },
  { email: "inspector3@ops-demo.local", name: "Noa Mizrahi", roles: [RoleName.MAPPING_INSPECTOR] },
  { email: "inspector4@ops-demo.local", name: "Amir Goldberg", roles: [RoleName.MAPPING_INSPECTOR] },
  { email: "qa@ops-demo.local", name: "Maya Rosen", roles: [RoleName.GRAPHIC_QA] },
  { email: "qa2@ops-demo.local", name: "Rina Shalev", roles: [RoleName.GRAPHIC_QA] },
  { email: "qa3@ops-demo.local", name: "Tomer Avivi", roles: [RoleName.GRAPHIC_QA] },
];

async function seedUsers() {
  console.log("Seeding users...");
  for (const demo of DEMO_USERS) {
    const maxShiftsPerWeek = MAX_SHIFTS_PER_WEEK[demo.email] ?? null;
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: { name: demo.name, maxShiftsPerWeek },
      create: { email: demo.email, name: demo.name, maxShiftsPerWeek },
    });

    // Keep demo roles exact — remove stale roles (e.g. admin left as OPS_ADMIN
    // before SUPER_ADMIN existed) then ensure the intended set is present.
    await prisma.userRole.deleteMany({
      where: {
        userId: user.id,
        role: { notIn: demo.roles },
      },
    });
    for (const role of demo.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }

    // Sample on-shift people for hub demos
    if (
      demo.email === "igor@ops-demo.local" ||
      demo.email === "zach@ops-demo.local" ||
      demo.email === "noam@ops-demo.local"
    ) {
      const shiftStart = new Date();
      if (demo.email === "zach@ops-demo.local") shiftStart.setHours(7, 30, 0, 0);
      else if (demo.email === "noam@ops-demo.local") shiftStart.setHours(8, 15, 0, 0);
      else shiftStart.setHours(8, 0, 0, 0);
      await prisma.user.update({
        where: { id: user.id },
        data: { shiftStartedAt: shiftStart },
      });
    }

    if (demo.email === "lior@ops-demo.local") {
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
