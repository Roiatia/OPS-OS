/**
 * Fill availability for every supervisor / shift leader for the default
 * submission week (next Sunday–Friday), so OPS roster / planner can be tested.
 *
 * Everyone offers all 6 days (Sun–Fri). Hours vary slightly for day/night coverage.
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

/** All 6 days offered; rotate hour bands so day↔night handoffs still work. */
function daysFor(index: number, fridayContract: boolean) {
  const band = index % 3;
  return [0, 1, 2, 3, 4, 5].map((dayOfWeek) => {
    if (band === 1) {
      // Evening until midnight + early morning (overnight 20→02 can finish 6h); afternoon block too
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 0,
        endMinutes: 8 * 60,
        startMinutes2: 14 * 60,
        endMinutes2: 24 * 60,
      };
    }
    if (band === 2) {
      // Daytime shorter window
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 8 * 60,
        endMinutes: dayOfWeek === 5 && !fridayContract ? 16 * 60 : 18 * 60,
      };
    }
    // Standard day
    return {
      dayOfWeek,
      canWork: true,
      allDay: false,
      startMinutes: 8 * 60,
      endMinutes: dayOfWeek === 5 && !fridayContract ? 16 * 60 : 20 * 60,
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
    const days = daysFor(i, fridayContract);

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
    const offered = days.filter((d) => d.canWork).length;
    console.log(`  ✓ ${user.name} (${role}) · ${offered}/6 days`);
  }

  console.log(`\nDone — ${n} submissions for week of ${weekStart.toISOString().slice(0, 10)}.`);
  console.log("Open OPS → Availability → roster / shift plan — all supervisors should appear.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
