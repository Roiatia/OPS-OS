import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const shifts = [
    { email: "plan-sup-01@ops-demo.local", name: "Eyal (Sup)", at: todayAt(8, 0) },
    { email: "plan-sup-02@ops-demo.local", name: "Bashar (Sup)", at: todayAt(8, 10) },
    { email: "plan-sup-03@ops-demo.local", name: "Cosmin (Sup)", at: todayAt(8, 20) },
    { email: "plan-sl-01@ops-demo.local", name: "Erez (SL)", at: todayAt(7, 30) },
    { email: "plan-sl-02@ops-demo.local", name: "Oren (SL)", at: todayAt(7, 45) },
    { email: "plan-sl-03@ops-demo.local", name: "Rachel (SL)", at: todayAt(8, 5) },
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
