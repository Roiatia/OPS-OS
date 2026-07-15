import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const shifts = [
    { email: "supervisor@ops-demo.local", name: "Alex Ben-Ami (supervisor)", at: todayAt(8, 0) },
    { email: "supervisor2@ops-demo.local", name: "Dana Weiss (shift leader)", at: todayAt(7, 30) },
    { email: "supervisor3@ops-demo.local", name: "Noam Katz (supervisor)", at: todayAt(8, 15) },
    { email: "supervisor4@ops-demo.local", name: "Lior Hadad (supervisor)", at: todayAt(8, 30) },
  ];

  for (const s of shifts) {
    await prisma.user.update({
      where: { email: s.email },
      data: { shiftStartedAt: s.at },
    });
    console.log(`✓ ${s.name} — on shift since ${s.at.toLocaleTimeString()}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
