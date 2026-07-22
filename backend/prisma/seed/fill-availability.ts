/**
 * Fill availability for every supervisor / shift leader for the default
 * submission week (next Sunday–Friday), so OPS roster / planner can be tested.
 *
 * Example B — different days + hour bands than the first fill:
 * - Offer mix 2–6 days (scarce Fri / strong mid-week)
 * - Early birds, day shift, late/night people for handoff testing
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

/**
 * Offer patterns (by name-sorted roster index).
 * Fri is intentionally thinner; Thu/Sun have more coverage.
 */
const OFFER_DAYS: number[][] = [
  [0, 1, 2, 3, 4], // 5 — no Fri (Alex)
  [0, 2, 3, 4, 5], // 5 — no Mon (Bashar)
  [1, 2, 3, 4], // 4 — Mon–Thu (Cosmin)
  [0, 1, 2, 3, 4, 5], // 6 — full (Dana)
  [0, 1, 3, 4], // 4 — skip Tue+Fri (Erez)
  [2, 3, 4, 5], // 4 — Tue–Fri (Eyal)
  [0, 1, 2, 5], // 4 — Sun–Tue + Fri (Lior)
  [1, 2, 3, 4, 5], // 5 — no Sun (Noam)
  [3, 4], // 2 — Thu–Fri only (Oren) — scarce early week
  [0, 1, 4, 5], // 4 — Sun Mon Thu Fri (Rachel)
];

/** Hour bands: 0 early, 1 day, 2 late/night(+morning). */
function hoursForDay(
  dayOfWeek: number,
  band: number,
  fridayContract: boolean
): {
  allDay: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  startMinutes2?: number | null;
  endMinutes2?: number | null;
} {
  const friCap = dayOfWeek === 5 && !fridayContract ? 16 * 60 : null;

  if (band === 0) {
    // Early bird — good for 07:00–12:00 maps; leaves mid-afternoon
    return {
      allDay: false,
      startMinutes: 7 * 60,
      endMinutes: friCap ?? 15 * 60,
    };
  }
  if (band === 2) {
    // Late + overnight morning — handoffs past 20:00 / night maps
    return {
      allDay: false,
      startMinutes: 0,
      endMinutes: 8 * 60,
      startMinutes2: 14 * 60,
      endMinutes2: 24 * 60,
    };
  }
  // Standard day — 09:00 until evening (or Shabbat enter)
  return {
    allDay: false,
    startMinutes: 9 * 60,
    endMinutes: friCap ?? 20 * 60,
  };
}

function daysFor(index: number, fridayContract: boolean) {
  const offered = new Set(OFFER_DAYS[index % OFFER_DAYS.length]!);
  // Rotate bands so early / day / late are mixed across the roster
  const band = (index * 2) % 3;
  return [0, 1, 2, 3, 4, 5].map((dayOfWeek) => {
    if (!offered.has(dayOfWeek)) {
      return {
        dayOfWeek,
        canWork: false,
        allDay: false,
        startMinutes: null,
        endMinutes: null,
      };
    }
    return {
      dayOfWeek,
      canWork: true,
      ...hoursForDay(dayOfWeek, band, fridayContract),
    };
  });
}

async function main() {
  const weekStart = nextWeekStartUtc();
  console.log(`Filling availability (example B) for week ${weekStart.toISOString().slice(0, 10)}`);

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
    const band = (i * 2) % 3;
    const bandLabel = band === 0 ? "early" : band === 2 ? "late/night" : "day";

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
    const dayNames = days
      .filter((d) => d.canWork)
      .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"][d.dayOfWeek])
      .join(",");
    console.log(`  ✓ ${user.name} (${role}) · ${offered}/6 · ${bandLabel} · ${dayNames}`);
  }

  console.log(`\nDone — ${n} submissions for week of ${weekStart.toISOString().slice(0, 10)}.`);
  console.log("Reload demo week in Shift plan, then Auto-plan week.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
