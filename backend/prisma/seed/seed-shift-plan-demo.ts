/**
 * Small shift-plan demo for checking auto-plan logic.
 * - 3 supervisors + 3 shift leaders (plan-sup-01..03 / plan-sl-01..03 @ops-demo.local)
 * - Removes older plan-* extras and old FAKE maps
 * - 60 FIELD maps for next week: 10/day Sun–Fri (count is even here for clarity;
 *   production can vary day-to-day)
 *
 * Usage: npm run db:seed-shift-plan
 */
import {
  PrismaClient,
  RoleName,
  MapPhase,
  InspectorStatus,
  FieldWorkStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const SUP_NAMES = ["Eyal (Sup)", "Bashar (Sup)", "Cosmin (Sup)"];

const SL_NAMES = ["Erez (SL)", "Oren (SL)", "Rachel (SL)"];

function weekStartSunday(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function nextWeekStart(): Date {
  const d = weekStartSunday(new Date());
  d.setDate(d.getDate() + 7);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function datePlusDays(weekStart: Date, dayOfWeek: number): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + dayOfWeek);
  return d;
}

function israelLocalToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
): Date {
  let utc = Date.UTC(year, monthIndex, day, hour - 3, minute, 0);
  for (let i = 0; i < 4; i++) {
    const d = new Date(utc);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get("year");
    const mo = get("month");
    const da = get("day");
    const h = get("hour");
    const mi = get("minute");
    if (y === year && mo === monthIndex + 1 && da === day && h === hour && mi === minute) {
      return d;
    }
    const wanted = Date.UTC(year, monthIndex, day, hour, minute);
    const got = Date.UTC(y, mo - 1, da, h, mi);
    utc += wanted - got;
  }
  return new Date(utc);
}

/** Mix of Israel start times so hour-fit still matters. */
const IL_STARTS = [
  [8, 0],
  [9, 30],
  [11, 0],
  [12, 30],
  [14, 0],
  [15, 30],
  [16, 0],
  [17, 15],
  [18, 0],
  [19, 30],
] as const;

async function upsertStaff(params: {
  email: string;
  name: string;
  role: RoleName;
  rating: number;
  fridayContract: boolean;
}) {
  const user = await prisma.user.upsert({
    where: { email: params.email },
    update: {
      name: params.name,
      supervisorRating: params.rating,
      fridayContract: params.fridayContract,
      hagimOk: true,
      maxRequestedHours: null,
    },
    create: {
      email: params.email,
      name: params.name,
      supervisorRating: params.rating,
      fridayContract: params.fridayContract,
      hagimOk: true,
      maxRequestedHours: null,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: params.role } },
    update: {},
    create: { userId: user.id, role: params.role },
  });

  await prisma.supervisorClientCapability.upsert({
    where: { userId_client: { userId: user.id, client: "fake" } },
    update: {},
    create: { userId: user.id, client: "fake" },
  });

  return user;
}

/**
 * Varied but readable availability:
 * - Most people offer most days
 * - One SL is scarce on weekdays (good for SL-spread checks)
 * - Some afternoon-only / morning-only for hour filters
 */
function buildDayAvailability(kind: "sup" | "sl", index: number, fridayContract: boolean) {
  return [0, 1, 2, 3, 4, 5].map((dayOfWeek) => {
    // Rachel (SL 3): only Sun + Wed (scarce) — forces smart SL open/close
    if (kind === "sl" && index === 3) {
      if (dayOfWeek === 0 || dayOfWeek === 3) {
        return {
          dayOfWeek,
          canWork: true,
          allDay: false,
          startMinutes: 8 * 60,
          endMinutes: 20 * 60,
        };
      }
      return {
        dayOfWeek,
        canWork: false,
        allDay: false,
        startMinutes: null as number | null,
        endMinutes: null as number | null,
      };
    }

    // Cosmin (Sup 3): mid-week off Tuesday
    if (kind === "sup" && index === 3 && dayOfWeek === 2) {
      return {
        dayOfWeek,
        canWork: false,
        allDay: false,
        startMinutes: null,
        endMinutes: null,
      };
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

    // Sup 2 / SL 2: afternoons 14–22
    if (index === 2) {
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 14 * 60,
        endMinutes: 22 * 60,
      };
    }

    // Sup 3 / SL 3: mornings 8–16
    if (index === 3) {
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 8 * 60,
        endMinutes: 16 * 60,
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

async function seedAvailability(
  userId: string,
  weekStart: Date,
  fridayContract: boolean,
  kind: "sup" | "sl",
  index: number
) {
  const days = buildDayAvailability(kind, index, fridayContract);
  await prisma.availabilitySubmission.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: {
      userId,
      weekStart,
      fridayContract,
      hagimOk: true,
      submittedAt: new Date(),
      days: { create: days },
    },
    update: {
      fridayContract,
      hagimOk: true,
      submittedAt: new Date(),
      days: { deleteMany: {}, create: days },
    },
  });
}

async function deleteExtraPlanUsers() {
  const extras = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "plan-sup-" } },
        { email: { startsWith: "plan-sl-" } },
      ],
    },
    select: { id: true, email: true },
  });

  const keep = new Set([
    ...[1, 2, 3].map((i) => `plan-sup-${String(i).padStart(2, "0")}@ops-demo.local`),
    ...[1, 2, 3].map((i) => `plan-sl-${String(i).padStart(2, "0")}@ops-demo.local`),
  ]);

  const toDelete = extras.filter((u) => !keep.has(u.email));
  if (toDelete.length === 0) {
    console.log("No extra plan-* users to remove.");
    return;
  }

  const ids = toDelete.map((u) => u.id);
  console.log(`Removing ${ids.length} extra plan-* users…`);
  // Cascades / related rows — delete dependents that may block user delete
  await prisma.shiftPlanAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.availabilitySubmission.deleteMany({ where: { userId: { in: ids } } });
  await prisma.supervisorClientCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const u of toDelete) console.log(`  ✗ ${u.email}`);
}

async function clearOtherAvailabilityForWeek(weekStart: Date, keepUserIds: string[]) {
  const removed = await prisma.availabilitySubmission.deleteMany({
    where: {
      weekStart,
      userId: { notIn: keepUserIds },
    },
  });
  console.log(
    `Cleared ${removed.count} availability submission(s) for other staff this week (so only the 10 demo people are offered).`
  );
}

async function main() {
  const weekStart = nextWeekStart();
  const weekEnd = datePlusDays(weekStart, 7);
  console.log(`Week start (UTC): ${weekStart.toISOString().slice(0, 10)}`);

  await deleteExtraPlanUsers();

  const keepIds: string[] = [];

  console.log("Seeding 3 supervisors…");
  for (let i = 1; i <= 3; i++) {
    const email = `plan-sup-${String(i).padStart(2, "0")}@ops-demo.local`;
    const fridayContract = i === 1;
    const user = await upsertStaff({
      email,
      name: SUP_NAMES[i - 1]!,
      role: RoleName.SUPERVISOR,
      rating: i, // 1..3
      fridayContract,
    });
    keepIds.push(user.id);
    await seedAvailability(user.id, weekStart, fridayContract, "sup", i);
    console.log(`  ✓ ${SUP_NAMES[i - 1]} · rating ${i}`);
  }

  console.log("Seeding 3 shift leaders…");
  for (let i = 1; i <= 3; i++) {
    const email = `plan-sl-${String(i).padStart(2, "0")}@ops-demo.local`;
    const fridayContract = i % 2 === 0;
    const user = await upsertStaff({
      email,
      name: SL_NAMES[i - 1]!,
      role: RoleName.SUPERVISOR_SHIFT_LEADER,
      rating: 5,
      fridayContract,
    });
    keepIds.push(user.id);
    await seedAvailability(user.id, weekStart, fridayContract, "sl", i);
    console.log(`  ✓ ${SL_NAMES[i - 1]} · rating 5`);
  }

  await clearOtherAvailabilityForWeek(weekStart, keepIds);

  // Drop any saved draft/published plan for this week so OPS starts clean
  await prisma.shiftPlan.deleteMany({ where: { weekStart } });
  console.log("Cleared shift plan for this week (if any).");

  console.log("Removing all previous FAKE maps…");
  const deletedMaps = await prisma.map.deleteMany({
    where: {
      client: "fake",
      mapNumber: { startsWith: "FAKE-" },
    },
  });
  console.log(`  ✗ ${deletedMaps.count} old FAKE maps`);

  console.log("Creating 60 FIELD maps (10/day Sun–Fri)…");
  const mapsData = [];
  for (let day = 0; day <= 5; day++) {
    const base = datePlusDays(weekStart, day);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth();
    const da = base.getUTCDate();
    for (let n = 1; n <= 10; n++) {
      const seq = day * 10 + n;
      const [hour, minute] = IL_STARTS[n - 1]!;
      const fieldDate = israelLocalToUtc(y, mo, da, hour, minute);
      const mapper = ["Roni", "Tal", "Maya", "Omer", "Lior"][(n - 1) % 5];
      mapsData.push({
        mapNumber: `FAKE-${String(seq).padStart(3, "0")}`,
        client: "fake",
        area: `Area ${n}`,
        description: `Shift-plan demo map (day ${day}, ${hour}:${String(minute).padStart(2, "0")} IL)`,
        fieldDate,
        mapperName: mapper,
        phase: MapPhase.FIELD,
        inspectorStatus: InspectorStatus.DONE,
        uploadApproved: true,
        uploadCompletedAt: new Date(),
        fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
        fieldProgressPercent: 0,
        onHubStatusBoard: false,
      });
    }
  }

  await prisma.map.createMany({ data: mapsData, skipDuplicates: true });
  console.log(`  ✓ ${mapsData.length} maps (10 × 6 days)`);
  console.log("");
  console.log("Done. Scenario:");
  console.log("  • 3 Sup + 3 SL only (for availability this week)");
  console.log("  • 60 maps next week · 10/day (mix of Israel start times)");
  console.log("  1. Login ops@ops-demo.local → Availability → Shift plan → Auto-plan");
  console.log("  2. Expect ~2 people/day at ~5 maps each (max 9), SL open/close spread");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
