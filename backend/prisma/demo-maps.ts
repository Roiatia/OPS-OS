import {
  PrismaClient,
  MapPhase,
  InspectorStatus,
  SupervisorStatus,
  FieldWorkStatus,
  QaStatus,
  type Prisma,
} from "@prisma/client";

export type DemoMapInput = {
  mapNumber: string;
  jiraTicketId?: string;
  client: string;
  area?: string;
  description?: string;
  phase: MapPhase;
  inspectorStatus?: InspectorStatus | null;
  qaStatus?: QaStatus | null;
  uploadApproved?: boolean;
  assignInspector?: boolean;
  assignQa?: boolean;
  /** Assign to Alex Ben-Ami (supervisor@ops-demo.local) */
  assignSupervisor?: boolean;
  /** Assign to Dana Weiss (supervisor2@ops-demo.local, shift leader) */
  assignSupervisor2?: boolean;
  supervisorStatus?: SupervisorStatus | null;
  fieldWorkStatus?: FieldWorkStatus;
  fieldDate?: string;
  fieldProgressPercent?: number;
  onHubStatusBoard?: boolean;
  mapperName?: string;
  opsManagerComment?: string | null;
  loomDone?: boolean;
  positioning?: boolean;
  releasedToGraphics?: boolean;
};

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Shared FIELD / mapping preset — upload done, ready for hub */
function mappingBase(overrides: Partial<DemoMapInput> = {}): DemoMapInput {
  return {
    mapNumber: "MAP-PLACEHOLDER",
    client: "Client",
    phase: MapPhase.FIELD,
    inspectorStatus: InspectorStatus.DONE,
    uploadApproved: true,
    assignInspector: true,
    fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    fieldDate: todayAt(9, 0),
    ...overrides,
  };
}

export const DEMO_MAPS: DemoMapInput[] = [
  {
    mapNumber: "MAP-99",
    jiraTicketId: "OPS-4499",
    client: "MegaStore",
    area: "Ramat Gan",
    description: "Full floor remap — polish QA review",
    phase: MapPhase.QA_REVIEW,
    inspectorStatus: InspectorStatus.DONE,
    assignInspector: true,
    assignQa: true,
  },
  mappingBase({
    mapNumber: "MAP-2024-0101",
    jiraTicketId: "OPS-4601",
    client: "FreshMart",
    area: "Netanya",
    description: "Mapping — intake pool on hub (unassigned)",
    fieldDate: todayAt(8, 30),
  }),
  mappingBase({
    mapNumber: "MAP-2024-0112",
    jiraTicketId: "OPS-4612",
    client: "ShopRite",
    area: "Kfar Saba",
    description: "Mapping — intake pool on hub (unassigned)",
    fieldDate: todayAt(9, 15),
  }),
  {
    mapNumber: "MAP-2024-0102",
    jiraTicketId: "OPS-4602",
    client: "CityShop",
    area: "Beer Sheva",
    description: "Initial graphics prep in progress",
    phase: MapPhase.PREP,
    inspectorStatus: InspectorStatus.PROCESSING,
    assignInspector: true,
  },
  {
    mapNumber: "MAP-2024-0103",
    jiraTicketId: "OPS-4603",
    client: "Urban Retail",
    area: "Tel Aviv",
    description: "Prep complete — QA reviewing dashboard upload",
    phase: MapPhase.UPLOAD_REVIEW,
    inspectorStatus: InspectorStatus.DONE,
    assignInspector: true,
    assignQa: true,
  },
  mappingBase({
    mapNumber: "MAP-2024-0104",
    jiraTicketId: "OPS-4604",
    client: "North Market",
    area: "Haifa",
    description: "Mapping — hub intake pool",
    fieldDate: todayAt(10, 0),
  }),
  mappingBase({
    mapNumber: "MAP-2024-0111",
    jiraTicketId: "OPS-4611",
    client: "QuickMart",
    area: "Petah Tikva",
    description: "Mapping — hub intake pool",
    fieldDate: todayAt(11, 30),
  }),
  mappingBase({
    mapNumber: "MAP-2024-0110",
    jiraTicketId: "OPS-4610",
    client: "SuperPharm",
    area: "Jerusalem",
    description: "Mapping — assigned to Alex on shift",
    assignSupervisor: true,
    fieldDate: todayAt(9, 0),
    mapperName: "Field Team A",
    fieldProgressPercent: 25,
  }),
  mappingBase({
    mapNumber: "MAP-2024-0113",
    jiraTicketId: "OPS-4613",
    client: "Daily Mart",
    area: "Rehovot",
    description: "Mapping — assigned to Dana (shift leader)",
    assignSupervisor2: true,
    fieldDate: todayAt(8, 0),
    mapperName: "Field Team B",
    fieldProgressPercent: 50,
  }),
  mappingBase({
    mapNumber: "MAP-2024-0114",
    jiraTicketId: "OPS-4614",
    client: "Grand Market",
    area: "Ashkelon",
    description: "Mapping complete on hub — ready to accept in maps table",
    assignSupervisor: true,
    fieldWorkStatus: FieldWorkStatus.COMPLETED,
    supervisorStatus: SupervisorStatus.DONE,
    onHubStatusBoard: true,
    fieldProgressPercent: 100,
    fieldDate: todayAt(7, 30),
    mapperName: "Field Team A",
  }),
  mappingBase({
    mapNumber: "MAP-2024-0115",
    jiraTicketId: "OPS-4615",
    client: "MiniStop",
    area: "Ra'anana",
    description: "Mapping incomplete on hub — supervisor left a note",
    assignSupervisor: true,
    onHubStatusBoard: true,
    fieldDate: todayAt(10, 45),
    mapperName: "Contractor C",
    opsManagerComment: "Could not finish aisle 4 — need return visit tomorrow",
  }),
  {
    mapNumber: "MAP-2024-0105",
    jiraTicketId: "OPS-4605",
    client: "Corner Store",
    area: "Eilat",
    description: "Post-field polish work",
    phase: MapPhase.POLISH,
    inspectorStatus: InspectorStatus.PROCESSING,
    uploadApproved: true,
    assignInspector: true,
  },
  {
    mapNumber: "MAP-2024-0106",
    jiraTicketId: "OPS-4606",
    client: "Prime Outlet",
    area: "Ashdod",
    description: "Inspector submitted fixes — QA re-review",
    phase: MapPhase.QA_REVIEW,
    inspectorStatus: InspectorStatus.DONE,
    qaStatus: QaStatus.FIX_DONE,
    uploadApproved: true,
    assignInspector: true,
    assignQa: true,
  },
  {
    mapNumber: "MAP-2024-0107",
    jiraTicketId: "OPS-4607",
    client: "GreenGrocer",
    area: "Modi'in",
    description: "QA returned map for fixes",
    phase: MapPhase.POLISH,
    inspectorStatus: InspectorStatus.ACCEPTED,
    qaStatus: QaStatus.FIX,
    uploadApproved: true,
    assignInspector: true,
    assignQa: true,
  },
  {
    mapNumber: "MAP-2024-0108",
    jiraTicketId: "OPS-4608",
    client: "ValueMart",
    area: "Rishon LeZion",
    description: "Workflow complete",
    phase: MapPhase.APPROVED,
    inspectorStatus: InspectorStatus.DONE,
    qaStatus: QaStatus.APPROVED,
    uploadApproved: true,
    assignInspector: true,
    assignQa: true,
  },
  {
    mapNumber: "MAP-2024-0109",
    jiraTicketId: "OPS-4609",
    client: "Lifestyle",
    area: "Herzliya",
    description: "Inspector accepted prep assignment",
    phase: MapPhase.PREP,
    inspectorStatus: InspectorStatus.ACCEPTED,
    assignInspector: true,
  },
];

export async function seedDemoMaps(prisma: PrismaClient) {
  const leader = await prisma.user.findUnique({ where: { email: "leader@ops-demo.local" } });
  const inspector = await prisma.user.findUnique({ where: { email: "inspector@ops-demo.local" } });
  const qa = await prisma.user.findUnique({ where: { email: "qa@ops-demo.local" } });
  const supervisor = await prisma.user.findUnique({ where: { email: "supervisor@ops-demo.local" } });
  const supervisor2 = await prisma.user.findUnique({ where: { email: "supervisor2@ops-demo.local" } });

  if (!leader || !inspector || !qa || !supervisor || !supervisor2) {
    throw new Error("Demo users must exist before seeding maps. Run user seed first.");
  }

  await prisma.mapEvent.deleteMany();
  await prisma.task.deleteMany();
  await prisma.map.deleteMany();

  console.log("Seeding demo maps...");

  for (const demo of DEMO_MAPS) {
    const data: Prisma.MapCreateInput = {
      mapNumber: demo.mapNumber,
      jiraTicketId: demo.jiraTicketId,
      client: demo.client,
      area: demo.area,
      description: demo.description,
      phase: demo.phase,
      inspectorStatus: demo.inspectorStatus ?? null,
      supervisorStatus: demo.supervisorStatus ?? null,
      fieldWorkStatus: demo.fieldWorkStatus ?? undefined,
      fieldProgressPercent: demo.fieldProgressPercent ?? undefined,
      onHubStatusBoard: demo.onHubStatusBoard ?? false,
      mapperName: demo.mapperName ?? null,
      opsManagerComment: demo.opsManagerComment ?? null,
      fieldDate: demo.fieldDate ? new Date(demo.fieldDate) : undefined,
      loomDone: demo.loomDone ?? false,
      releasedToGraphics: demo.releasedToGraphics ?? false,
      qaStatus: demo.qaStatus ?? null,
      uploadApproved: demo.uploadApproved ?? false,
      uploadCompletedAt: demo.uploadApproved ? new Date() : undefined,
      ...(demo.assignInspector ? { assignedInspector: { connect: { id: inspector.id } } } : {}),
      ...(demo.assignQa ? { assignedQa: { connect: { id: qa.id } } } : {}),
      ...(demo.assignSupervisor ? { assignedSupervisor: { connect: { id: supervisor.id } } } : {}),
      ...(demo.assignSupervisor2
        ? { assignedSupervisor: { connect: { id: supervisor2.id } } }
        : {}),
    };

    const map = await prisma.map.create({ data });

    await prisma.mapEvent.create({
      data: {
        mapId: map.id,
        userId: leader.id,
        action: "map_created",
        note: `Demo map ${demo.mapNumber} — ${demo.client}`,
      },
    });
  }

  const map102 = await prisma.map.findUnique({ where: { mapNumber: "MAP-2024-0102" } });
  const map107 = await prisma.map.findUnique({ where: { mapNumber: "MAP-2024-0107" } });

  if (map102) {
    await prisma.task.create({
      data: {
        mapId: map102.id,
        title: "Align fixture layers",
        description: "Match CS brief shelf positions",
        phase: MapPhase.PREP,
        status: "PROCESSING",
        createdById: leader.id,
        assignedToId: inspector.id,
      },
    });
  }

  if (map107) {
    await prisma.task.create({
      data: {
        mapId: map107.id,
        title: "Fix aisle labels per QA notes",
        description: "Sections 3–5 label corrections",
        phase: MapPhase.POLISH,
        status: "FIX",
        createdById: qa.id,
        assignedToId: inspector.id,
      },
    });
  }

  const ops = await prisma.user.findUnique({ where: { email: "ops@ops-demo.local" } });
  if (ops) {
    await seedDemoUpdateEvents(prisma, {
      qa,
      inspector,
      supervisor,
      supervisor2,
      ops,
    });
  }

  const fieldCount = DEMO_MAPS.filter((m) => m.phase === MapPhase.FIELD).length;
  console.log(`  ✓ ${DEMO_MAPS.length} demo maps (${fieldCount} in mapping / FIELD for hub testing)`);
}

type DemoUsers = {
  qa: { id: string; name: string };
  inspector: { id: string; name: string };
  supervisor: { id: string; name: string };
  supervisor2: { id: string; name: string };
  ops: { id: string; name: string };
};

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** Sample milestone events so OPS Updates is populated for demos */
export async function seedDemoUpdateEvents(prisma: PrismaClient, users: DemoUsers) {
  const byNumber = async (mapNumber: string) =>
    prisma.map.findUnique({ where: { mapNumber } });

  const samples: {
    mapNumber: string;
    userId: string;
    action: string;
    note: string;
    metadata?: string;
    hoursAgo: number;
  }[] = [
    {
      mapNumber: "MAP-2024-0103",
      userId: users.qa.id,
      action: "upload_approved",
      note: "Dashboard upload approved — ready for field mapping",
      hoursAgo: 5,
    },
    {
      mapNumber: "MAP-2024-0102",
      userId: users.inspector.id,
      action: "inspector_status",
      note: "Prep complete — sent to upload review",
      metadata: JSON.stringify({ status: "DONE" }),
      hoursAgo: 6,
    },
    {
      mapNumber: "MAP-2024-0107",
      userId: users.inspector.id,
      action: "fix_done",
      note: "Aisle label fixes completed per QA notes",
      hoursAgo: 4,
    },
    {
      mapNumber: "MAP-99",
      userId: users.qa.id,
      action: "qa_approved",
      note: "Polish approved — ready for activation",
      hoursAgo: 3,
    },
    {
      mapNumber: "MAP-2024-0105",
      userId: users.ops.id,
      action: "field_complete",
      note: "Released to graphics for polish after field work",
      hoursAgo: 8,
    },
    {
      mapNumber: "MAP-2024-0114",
      userId: users.supervisor.id,
      action: "hub_completed",
      note: "MAP-2024-0114 field mapping complete — marked by Alex Ben-Ami",
      hoursAgo: 1.5,
    },
    {
      mapNumber: "MAP-2024-0115",
      userId: users.supervisor.id,
      action: "hub_uncompleted",
      note: "Alex Ben-Ami marked MAP-2024-0115 uncompleted — Could not finish aisle 4 — need return visit tomorrow",
      hoursAgo: 0.75,
    },
    {
      mapNumber: "MAP-2024-0110",
      userId: users.supervisor.id,
      action: "hub_completed",
      note: "MAP-2024-0110 field mapping complete — marked by Alex Ben-Ami",
      hoursAgo: 12,
    },
    {
      mapNumber: "MAP-2024-0113",
      userId: users.supervisor2.id,
      action: "hub_uncompleted",
      note: "Dana Weiss marked MAP-2024-0113 uncompleted — Mapper left early, sections 2–3 remaining",
      hoursAgo: 2,
    },
    {
      mapNumber: "MAP-2024-0104",
      userId: users.ops.id,
      action: "field_complete",
      note: "Accepted yesterday's field work — sent to polish",
      hoursAgo: 20,
    },
  ];

  let count = 0;
  for (const sample of samples) {
    const map = await byNumber(sample.mapNumber);
    if (!map) continue;
    await prisma.mapEvent.create({
      data: {
        mapId: map.id,
        userId: sample.userId,
        action: sample.action,
        note: sample.note,
        metadata: sample.metadata,
        createdAt: hoursAgo(sample.hoursAgo),
      },
    });
    count += 1;
  }
  console.log(`  ✓ ${count} demo update events (graphics + ops milestones)`);
}
