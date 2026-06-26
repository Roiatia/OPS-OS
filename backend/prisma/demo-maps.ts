import {
  PrismaClient,
  MapPhase,
  InspectorStatus,
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
};

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
  {
    mapNumber: "MAP-2024-0101",
    jiraTicketId: "OPS-4601",
    client: "FreshMart",
    area: "Netanya",
    description: "New intake from CS — awaiting assignment",
    phase: MapPhase.INTAKE,
  },
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
  {
    mapNumber: "MAP-2024-0104",
    jiraTicketId: "OPS-4604",
    client: "North Market",
    area: "Haifa",
    description: "Upload approved — supervisors in field",
    phase: MapPhase.FIELD,
    inspectorStatus: InspectorStatus.DONE,
    uploadApproved: true,
    assignInspector: true,
  },
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

  if (!leader || !inspector || !qa) {
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
      qaStatus: demo.qaStatus ?? null,
      uploadApproved: demo.uploadApproved ?? false,
      ...(demo.assignInspector ? { assignedInspector: { connect: { id: inspector.id } } } : {}),
      ...(demo.assignQa ? { assignedQa: { connect: { id: qa.id } } } : {}),
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

  console.log(`  ✓ ${DEMO_MAPS.length} demo maps`);
}
