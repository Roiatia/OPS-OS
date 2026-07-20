import { PrismaClient, RoleName } from "@prisma/client";
import { autoPlanShifts } from "../src/domain/shiftPlanner.js";
import { weekStartSunday } from "../src/domain/availabilityRules.js";

const prisma = new PrismaClient();

function nextWeek() {
  const d = weekStartSunday(new Date());
  d.setDate(d.getDate() + 7);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

async function main() {
  const weekStart = nextWeek();
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const [supervisors, submissions, maps] = await Promise.all([
    prisma.user.findMany({
      where: {
        roles: {
          some: { role: { in: [RoleName.SUPERVISOR, RoleName.SUPERVISOR_SHIFT_LEADER] } },
        },
      },
      include: { roles: true },
    }),
    prisma.availabilitySubmission.findMany({
      where: { weekStart },
      include: { days: true },
    }),
    prisma.map.count({
      where: {
        client: "fake",
        phase: "FIELD",
        fieldDate: { gte: weekStart, lt: weekEnd },
      },
    }),
  ]);

  const byUser = new Map(submissions.map((s) => [s.userId, s]));
  const mapsPerDay: Record<number, number> = { 0: 50, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50 };
  const staff = supervisors.map((sup) => {
    const sub = byUser.get(sup.id);
    const isShiftLeader = (sup.roles.some((r) => r.role === RoleName.SUPERVISOR_SHIFT_LEADER));
    return {
      userId: (sup.id),
      name: (sup.name),
      isShiftLeader,
      submitted: Boolean(sub?.submittedAt),
      fridayContract: (sub?.fridayContract) ?? (sup.fridayContract),
      hagimOk: (sub?.hagimOk) ?? (sup.hagimOk),
      supervisorRating: (sup.supervisorRating),
      days:
        sub?.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          canWork: d.canWork,
          allDay: d.allDay,
          startMinutes: d.startMinutes,
          endMinutes: d.endMinutes,
          isNight: false,
        })) ?? [],
      priorWeekNights: 0,
    };
  });

  console.log({
    staff: staff.length,
    submitted: staff.filter((s) => s.submitted).length,
    maps,
    sl: staff.filter((s) => s.isShiftLeader).length,
    supers: staff.filter((s) => !s.isShiftLeader).length,
  });

  const result = autoPlanShifts({ staff, mapsPerDay, weekStart });
  for (const d of result.dayPlans) {
    console.log(
      d.label,
      "maps",
      d.mapsCount,
      "needed",
      d.staffNeeded,
      "assigned",
      d.assignments.length,
      "ok",
      d.ok,
      d.issues[0] ?? ""
    );
  }
  console.log("warnings", result.warnings.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
