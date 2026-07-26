/**
 * Small shift-plan demo for checking auto-plan logic.
 * - Ensures Eyal/Bashar/Cosmin + Erez/Oren/Rachel exist with availability
 * - Does NOT wipe other supervisors' availability — fill-availability covers everyone
 * - 60 FIELD tasks for next week + Sun meeting + Mon mapping refresh
 *
 * Usage: npm run db:seed-shift-plan
 * Then:  npm run db:fill-availability   (all Sup/SL, 6 days each)
 */
import {
  PrismaClient,
  RoleName,
  MapPhase,
  InspectorStatus,
  FieldWorkStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const SUP_STAFF = [
  { email: "eyal@ops-demo.local", name: "Eyal" },
  { email: "bashar@ops-demo.local", name: "Bashar" },
  { email: "cosmin@ops-demo.local", name: "Cosmin" },
] as const;

const SL_STAFF = [
  { email: "erez@ops-demo.local", name: "Erez" },
  { email: "oren@ops-demo.local", name: "Oren" },
  { email: "rachel@ops-demo.local", name: "Rachel" },
] as const;

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
  await prisma.supervisorClientCapability.upsert({
    where: { userId_client: { userId: user.id, client: "internal" } },
    update: {},
    create: { userId: user.id, client: "internal" },
  });

  return user;
}

/**
 * Demo staff offer a mix of days (not everyone 6/6) so auto-plan fairness is testable.
 * Hours still vary (morning / afternoon) so day↔night handoffs stay testable.
 */
function buildDayAvailability(_kind: "sup" | "sl", index: number, fridayContract: boolean) {
  // 1-based index from seed loops
  const offerByIndex: Record<number, number[]> = {
    1: [0, 1, 2, 3, 4, 5], // 6
    2: [0, 1, 2, 3, 4], // 5 — no Fri
    3: [0, 2, 4], // 3 — Sun / Wed / Fri
  };
  const offered = new Set(offerByIndex[index] ?? [0, 1, 2, 3]);

  return [0, 1, 2, 3, 4, 5].map((dayOfWeek) => {
    if (!offered.has(dayOfWeek)) {
      return {
        dayOfWeek,
        canWork: false,
        allDay: false,
        startMinutes: null as number | null,
        endMinutes: null as number | null,
      };
    }
    // Afternoon / evening band (good for handoffs after day shift)
    if (index === 2) {
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 14 * 60,
        endMinutes: 24 * 60,
      };
    }
    // Shorter daytime window
    if (index === 3) {
      return {
        dayOfWeek,
        canWork: true,
        allDay: false,
        startMinutes: 8 * 60,
        endMinutes: 18 * 60,
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

  if (extras.length === 0) {
    console.log("No leftover plan-* users to remove.");
    return;
  }

  const ids = extras.map((u) => u.id);
  console.log(`Removing ${ids.length} leftover plan-* users…`);
  await prisma.shiftPlanAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.availabilitySubmission.deleteMany({ where: { userId: { in: ids } } });
  await prisma.supervisorClientCapability.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const u of extras) console.log(`  ✗ ${u.email}`);
}

async function clearOtherAvailabilityForWeek(_weekStart: Date, _keepUserIds: string[]) {
  // Keep every supervisor/SL submission — do not wipe non-demo staff.
  console.log("Keeping availability for all supervisors/SLs (not clearing others).");
}

async function main() {
  const weekStart = nextWeekStart();
  const weekEnd = datePlusDays(weekStart, 7);
  console.log(`Week start (UTC): ${weekStart.toISOString().slice(0, 10)}`);

  await deleteExtraPlanUsers();

  const keepIds: string[] = [];

  console.log("Seeding 3 supervisors…");
  for (let i = 0; i < SUP_STAFF.length; i++) {
    const person = SUP_STAFF[i]!;
    const fridayContract = i === 0;
    const rating = i + 1; // 1..3
    const user = await upsertStaff({
      email: person.email,
      name: person.name,
      role: RoleName.SUPERVISOR,
      rating,
      fridayContract,
    });
    keepIds.push(user.id);
    await seedAvailability(user.id, weekStart, fridayContract, "sup", rating);
    const offeredSup = buildDayAvailability("sup", rating, fridayContract).filter((d) => d.canWork).length;
    console.log(`  ✓ ${person.name} · rating ${rating} · ${offeredSup}/6 days`);
  }

  console.log("Seeding 3 shift leaders…");
  for (let i = 0; i < SL_STAFF.length; i++) {
    const person = SL_STAFF[i]!;
    const fridayContract = (i + 1) % 2 === 0;
    const user = await upsertStaff({
      email: person.email,
      name: person.name,
      role: RoleName.SUPERVISOR_SHIFT_LEADER,
      rating: 5,
      fridayContract,
    });
    keepIds.push(user.id);
    await seedAvailability(user.id, weekStart, fridayContract, "sl", i + 1);
    const offeredSl = buildDayAvailability("sl", i + 1, fridayContract).filter((d) => d.canWork).length;
    console.log(`  ✓ ${person.name} · rating 5 · ${offeredSl}/6 days`);
  }

  await clearOtherAvailabilityForWeek(weekStart, keepIds);

  // Drop any saved draft/published plan for this week so OPS starts clean
  await prisma.shiftPlan.deleteMany({ where: { weekStart } });
  console.log("Cleared shift plan for this week (if any).");

  console.log("Removing all previous FAKE maps…");
  const deletedMaps = await prisma.map.deleteMany({
    where: {
      client: { in: ["fake", "internal"] },
      OR: [
        { mapNumber: { startsWith: "FAKE-" } },
        { mapNumber: { startsWith: "HH-" } },
        { mapNumber: { startsWith: "MTG-" } },
        { mapNumber: { startsWith: "REF-" } },
      ],
    },
  });
  console.log(`  ✗ ${deletedMaps.count} old demo tasks`);

  console.log("Creating FIELD maps + Sunday meeting + Monday mapping refresh…");
  const mapsData = [];
  for (let day = 0; day <= 5; day++) {
    const base = datePlusDays(weekStart, day);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth();
    const da = base.getUTCDate();

    // 10 maps most days; 9 on Sun/Mon so the special event keeps ~10 tasks/day
    const mapCount = day === 0 || day === 1 ? 9 : 10;
    for (let n = 1; n <= mapCount; n++) {
      const seq = day * 10 + n;
      const [hour, minute] = IL_STARTS[n - 1]!;
      const fieldDate = israelLocalToUtc(y, mo, da, hour, minute);
      const mapper = ["Roni", "Tal", "Maya", "Omer", "Lior"][(n - 1) % 5];
      mapsData.push({
        mapNumber: `FAKE-${String(seq).padStart(3, "0")}`,
        client: "fake",
        taskKind: "MAP" as const,
        taskEndMinutes: null as number | null,
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

  // Sunday: company meeting 13:00–15:00 (assignees still stay ≥6h → typically 13–19)
  {
    const base = datePlusDays(weekStart, 0);
    mapsData.push({
      mapNumber: "MTG-SUN",
      client: "internal",
      taskKind: "COMPANY_MEETING" as const,
      taskEndMinutes: 15 * 60,
      area: null,
      description: "Company meeting 13:00–15:00 (stay ≥6h)",
      fieldDate: israelLocalToUtc(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        13,
        0
      ),
      mapperName: null,
      phase: MapPhase.FIELD,
      inspectorStatus: InspectorStatus.DONE,
      uploadApproved: true,
      uploadCompletedAt: new Date(),
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      fieldProgressPercent: 0,
      onHubStatusBoard: false,
    });
  }

  // Monday: mapping refresh 13:00–19:00 (exactly 6h)
  {
    const base = datePlusDays(weekStart, 1);
    mapsData.push({
      mapNumber: "REF-MON",
      client: "internal",
      taskKind: "MAPPING_REFRESH" as const,
      taskEndMinutes: 19 * 60,
      area: null,
      description: "Mapping refresh 13:00–19:00",
      fieldDate: israelLocalToUtc(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        13,
        0
      ),
      mapperName: null,
      phase: MapPhase.FIELD,
      inspectorStatus: InspectorStatus.DONE,
      uploadApproved: true,
      uploadCompletedAt: new Date(),
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      fieldProgressPercent: 0,
      onHubStatusBoard: false,
    });
  }

  await prisma.map.createMany({ data: mapsData, skipDuplicates: true });
  console.log(`  ✓ ${mapsData.length} tasks (maps + Sun meeting + Mon mapping refresh)`);
  console.log("");
  console.log("Done. Scenario:");
  console.log("  • All supervisors/SLs keep availability (run db:fill-availability for full roster)");
  console.log("  • Demo staff offer mixed days (3–6), not everyone full week");
  console.log("  • Sun: company meeting 13–15 (6h stay rule)");
  console.log("  • Mon: mapping refresh 13–19");
  console.log("  1. npm run db:fill-availability");
  console.log("  2. Login magali@ops-demo.local → Availability → Shift plan → Auto-plan");
  console.log("  3. Expect varied offer counts + fair assigned/offered ratios");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
