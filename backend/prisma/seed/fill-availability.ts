/**
 * Fill availability for every supervisor / shift leader for the default
 * submission week (next Sunday–Friday), so OPS roster / planner can be tested.
 *
 * Usage: npm run db:fill-availability
 */
import { PrismaClient, RoleName } from "@prisma/client";

const prisma = new PrismaClient();

function weekStartSunday(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function nextWeekStartUtc(): Date {
  const d = weekStartSunday(new Date());
  d.setDate(d.getDate() + 7);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function daysFor(index: number, fridayContract: boolean, isSl: boolean) {
  return [0, 1, 2, 3, 4, 5].map((dayOfWeek) => {
    // Vary who is off so coverage gaps are visible
    const offPattern = (index + dayOfWeek) % 7;
    if (offPattern === 0 && !isSl) {
      return { dayOfWeek, canWork: false, allDay: false, startMinutes: null, endMinutes: null };
    }
    if (dayOfWeek === 5 && !fridayContract) {
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 8 * 60,
        endMinutes: 16 * 60,
      };
    }
    if (isSl && dayOfWeek === index % 6) {
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 14 * 60,
        endMinutes: 22 * 60,
      };
    }
    return {
      dayOfWeek,
      canWork: true,
      allDay: false,
      startMinutes: 8 * 60,
      endMinutes: 20 * 60,
    };
  });
}

async function main() {
  const weekStart = nextWeekStartUtc();
  console.log(`Filling availability for week ${weekStart.toISOString().slice(0, 10)}`);

  const staff = await prisma.user.findMany({
    where: {
      roles: {
        some: {
          role: { in: [RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER] },
        },
      },
    },
    include: { roles: true },
    orderBy: { name: "asc" },
  });

  if (staff.length === 0) {
    throw new Error("No supervisors found — run npm run db:seed-shift-plan first");
  }

  let n = 0;
  for (let i = 0; i < staff.length; i++) {
    const user = staff[i]!;
    const isSl = user.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER);
    const fridayContract = user.fridayContract || i % 3 === 0;
    const days = daysFor(i, fridayContract, isSl);

    await prisma.availabilitySubmission.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      create: {
        userId: user.id,
        weekStart,
        fridayContract,
        sundayOk: true,
        hagimOk: true,
        submittedAt: new Date(),
        days: { create: days },
      },
      update: {
        fridayContract,
        sundayOk: true,
        hagimOk: true,
        submittedAt: new Date(),
        days: { deleteMany: {}, create: days },
      },
    });

    n += 1;
    const role = isSl ? "SL" : "Sup";
    console.log(`  ✓ ${user.name} (${role})`);
  }

  console.log(`\nDone — ${n} submissions for week of ${weekStart.toISOString().slice(0, 10)}.`);
  console.log("Open OPS → Availability → roster / shift plan to check.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
