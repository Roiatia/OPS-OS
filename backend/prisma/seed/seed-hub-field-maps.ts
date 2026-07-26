/**
 * Seed active FIELD maps onto today's hub for the shift-plan demo staff
 * (Eyal, Bashar, Cosmin, Erez, Oren, Rachel).
 *
 * Usage: npx tsx prisma/seed/seed-hub-field-maps.ts
 */
import {
  PrismaClient,
  MapPhase,
  InspectorStatus,
  FieldWorkStatus,
  SupervisorStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

const STAFF = [
  { email: "eyal@ops-demo.local", key: "eyal" as const, name: "Eyal", at: () => todayAt(8, 0) },
  { email: "bashar@ops-demo.local", key: "bashar" as const, name: "Bashar", at: () => todayAt(8, 10) },
  { email: "cosmin@ops-demo.local", key: "cosmin" as const, name: "Cosmin", at: () => todayAt(8, 20) },
  { email: "erez@ops-demo.local", key: "erez" as const, name: "Erez", at: () => todayAt(7, 30) },
  { email: "oren@ops-demo.local", key: "oren" as const, name: "Oren", at: () => todayAt(7, 45) },
  { email: "rachel@ops-demo.local", key: "rachel" as const, name: "Rachel", at: () => todayAt(8, 5) },
];

type StaffKey = (typeof STAFF)[number]["key"];

const FIELD_MAPS: Array<{
  mapNumber: string;
  client: string;
  area: string;
  assign: StaffKey | null;
  progress: number | null;
  onHub?: boolean;
}> = [
  { mapNumber: "HUB-DEMO-01", client: "FreshMart", area: "Netanya", assign: "eyal", progress: 20 },
  { mapNumber: "HUB-DEMO-02", client: "ShopRite", area: "Kfar Saba", assign: null, progress: null },
  { mapNumber: "HUB-DEMO-03", client: "North Market", area: "Haifa", assign: "bashar", progress: 45 },
  { mapNumber: "HUB-DEMO-04", client: "QuickMart", area: "Petah Tikva", assign: null, progress: null },
  { mapNumber: "HUB-DEMO-05", client: "SuperPharm", area: "Jerusalem", assign: "cosmin", progress: 10 },
  { mapNumber: "HUB-DEMO-06", client: "Daily Mart", area: "Rehovot", assign: "eyal", progress: 60, onHub: true },
  { mapNumber: "HUB-DEMO-07", client: "MiniStop", area: "Ra'anana", assign: "erez", progress: 75, onHub: true },
  { mapNumber: "HUB-DEMO-08", client: "Market City", area: "Holon", assign: null, progress: null },
  { mapNumber: "HUB-DEMO-09", client: "Blue Box", area: "Rishon", assign: "oren", progress: 35 },
  { mapNumber: "HUB-DEMO-10", client: "Express Mart", area: "Bat Yam", assign: "rachel", progress: 50, onHub: true },
  { mapNumber: "HUB-DEMO-11", client: "City Fresh", area: "Tel Aviv", assign: "bashar", progress: 15 },
  { mapNumber: "HUB-DEMO-12", client: "Corner Store", area: "Herzliya", assign: "cosmin", progress: 80, onHub: true },
];

async function main() {
  const users = await Promise.all(
    STAFF.map(async (s) => {
      const user = await prisma.user.findUnique({ where: { email: s.email } });
      if (!user) throw new Error(`Missing ${s.email} — run: npm run db:seed-shift-plan`);
      return { ...s, user };
    })
  );

  const ops =
    (await prisma.user.findFirst({
      where: { email: { in: ["magali@ops-demo.local", "natali@ops-demo.local"] } },
    })) ?? users[0]!.user;

  const inspector = await prisma.user.findFirst({
    where: { email: "inspector@ops-demo.local" },
  });

  console.log("Clocking in today's shift…");
  for (const s of users) {
    await prisma.user.update({
      where: { id: s.user.id },
      data: { shiftStartedAt: s.at() },
    });
    console.log(`  ✓ ${s.name} on shift`);
  }

  const assignId = Object.fromEntries(users.map((s) => [s.key, s.user.id])) as Record<
    StaffKey,
    string
  >;

  let created = 0;
  let updated = 0;

  console.log("\nActive FIELD maps…");
  for (let i = 0; i < FIELD_MAPS.length; i++) {
    const m = FIELD_MAPS[i]!;
    const fieldDate = todayAt(8 + (i % 6), (i * 7) % 60);
    const assignedSupervisorId = m.assign ? assignId[m.assign] : null;
    const onHub =
      m.onHub ?? Boolean(m.assign && (m.progress ?? 0) >= 50);

    const data = {
      client: m.client,
      area: m.area,
      description: `Hub demo field map — ${m.client}`,
      phase: MapPhase.FIELD,
      inspectorStatus: InspectorStatus.DONE,
      uploadApproved: true,
      uploadCompletedAt: todayAt(7, 0),
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      fieldDate,
      fieldProgressPercent: m.progress ?? 0,
      onHubStatusBoard: onHub,
      assignedInspectorId: inspector?.id ?? null,
      assignedSupervisorId,
      supervisorStatus: null as SupervisorStatus | null,
      mapperName: assignedSupervisorId ? `Field Team ${String.fromCharCode(65 + (i % 3))}` : null,
      swapBatchId: null,
      swapOfferedAt: null,
      swapOfferedById: null,
      helpAskBatchId: null,
      helpAskAt: null,
      helpAskById: null,
      slCheckStatus: null,
      slCheckRequestedAt: null,
      slCheckClaimedAt: null,
      slCheckNote: null,
      slCheckRequestedById: null,
      slCheckClaimedById: null,
    };

    const existing = await prisma.map.findUnique({ where: { mapNumber: m.mapNumber } });
    if (existing) {
      await prisma.map.update({ where: { id: existing.id }, data });
      updated += 1;
      console.log(
        `  ~ ${m.mapNumber} → ${m.assign ?? "Intake"}${onHub ? " (hub board)" : ""}`
      );
    } else {
      const map = await prisma.map.create({
        data: {
          mapNumber: m.mapNumber,
          jiraTicketId: `OPS-HUB-${String(i + 1).padStart(2, "0")}`,
          ...data,
        },
      });
      await prisma.mapEvent.create({
        data: {
          mapId: map.id,
          userId: ops.id,
          action: "map_created",
          note: `Hub demo map ${m.mapNumber}`,
        },
      });
      created += 1;
      console.log(
        `  + ${m.mapNumber} → ${m.assign ?? "Intake"}${onHub ? " (hub board)" : ""}`
      );
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated.`);
  console.log("Log in as plan-sup-01@ops-demo.local (Eyal) or plan-sl-01@ops-demo.local (Erez) and open Hub.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
