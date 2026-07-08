import {
  PrismaClient,
  MapPhase,
  MapStatus,
  WorkflowPhaseTarget,
  type Prisma,
} from "@prisma/client";

export type DemoMapInput = {
  mapNumber: string;
  jiraTicketId?: string;
  client: string;
  area?: string;
  description?: string;
  dueDate?: string;
  phase: MapPhase;
  status?: MapStatus | null;
  uploadApproved?: boolean;
  assignInspector?: boolean;
  assignQa?: boolean;
  inspectorAssignAccepted?: boolean;
  qaAssignAccepted?: boolean;
  releasedToPipeline?: boolean;
  workflowPhaseTarget?: WorkflowPhaseTarget;
};

const NEW_INTAKE_CLIENTS: { client: string; area: string }[] = [
  { client: "FreshMart", area: "Netanya" },
  { client: "SuperPharm", area: "Jerusalem" },
  { client: "Shufersal", area: "Petah Tikva" },
  { client: "Rami Levy", area: "Kiryat Gat" },
  { client: "Victory", area: "Holon" },
  { client: "Tiv Taam", area: "Ra'anana" },
  { client: "MegaStore", area: "Ramat Gan" },
  { client: "CityShop", area: "Beer Sheva" },
  { client: "Urban Retail", area: "Tel Aviv" },
  { client: "North Market", area: "Haifa" },
  { client: "Corner Store", area: "Eilat" },
  { client: "Prime Outlet", area: "Ashdod" },
  { client: "GreenGrocer", area: "Modi'in" },
  { client: "ValueMart", area: "Rishon LeZion" },
  { client: "Lifestyle", area: "Herzliya" },
  { client: "Daily Market", area: "Kfar Saba" },
  { client: "Budget Foods", area: "Nahariya" },
  { client: "Express Mart", area: "Rehovot" },
  { client: "Family Shop", area: "Afula" },
  { client: "QuickStop", area: "Bat Yam" },
  { client: "Market Plus", area: "Yokneam" },
  { client: "Shop & Go", area: "Carmiel" },
  { client: "Elite Retail", area: "Givatayim" },
  { client: "Metro Foods", area: "Ashkelon" },
  { client: "Sunrise Mart", area: "Tiberias" },
];

const NEW_INTAKE_DESCRIPTIONS = [
  "New intake from CS — awaiting assignment",
  "Store expansion layout from Jira ticket",
  "Seasonal refresh — assign inspector and QA",
  "CS urgent request — new floor plan",
  "Remap after fixture change",
  "New branch opening map",
  "Category reset from merchandising",
  "Promo zone update from CS",
  "Back wall refresh — needs graphics",
  "End-cap realignment map",
];

/** Twenty-five fresh INTAKE maps for the leader new-maps box (0115–0139). */
export const NEW_INTAKE_MAPS: DemoMapInput[] = NEW_INTAKE_CLIENTS.map((entry, i) => {
  const num = String(115 + i).padStart(4, "0");
  const year = i >= 20 ? "2026" : "2024";
  const workflowPhaseTarget =
    i % 5 === 1
      ? WorkflowPhaseTarget.UPLOADED
      : i % 5 === 2
        ? WorkflowPhaseTarget.POLISH
        : WorkflowPhaseTarget.PRE_UPLOAD;

  return {
    mapNumber: `MAP-${year}-${num}`,
    jiraTicketId: i >= 20 ? `OPS-6${num}` : `OPS-46${num}`,
    client: entry.client,
    area: entry.area,
    description: NEW_INTAKE_DESCRIPTIONS[i % NEW_INTAKE_DESCRIPTIONS.length],
    phase: MapPhase.INTAKE,
    workflowPhaseTarget,
    ...(i === 3 ? { dueDate: "2026-07-14" } : {}),
    ...(i === 7 ? { assignInspector: true } : {}),
    ...(i === 11 ? { assignInspector: true, assignQa: true } : {}),
  };
});

export const DEMO_MAPS: DemoMapInput[] = [
  {
    mapNumber: "MAP-99",
    jiraTicketId: "OPS-4499",
    client: "MegaStore",
    area: "Ramat Gan",
    description: "Full floor remap — polish QA review",
    phase: MapPhase.QA_REVIEW,
    status: MapStatus.DONE,
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
    mapNumber: "MAP-2024-0110",
    jiraTicketId: "OPS-4610",
    client: "SuperPharm",
    area: "Jerusalem",
    description: "New store layout — assign inspector and QA",
    phase: MapPhase.INTAKE,
  },
  {
    mapNumber: "MAP-2024-0111",
    jiraTicketId: "OPS-4611",
    client: "Shufersal",
    area: "Petah Tikva",
    description: "Seasonal refresh from CS ticket",
    phase: MapPhase.INTAKE,
  },
  {
    mapNumber: "MAP-2024-0112",
    jiraTicketId: "OPS-4612",
    client: "Rami Levy",
    area: "Kiryat Gat",
    description: "Urgent map — due this week",
    phase: MapPhase.INTAKE,
    dueDate: "2026-07-12",
  },
  {
    mapNumber: "MAP-2024-0113",
    jiraTicketId: "OPS-4613",
    client: "Victory",
    area: "Holon",
    description: "Inspector assigned — still needs QA",
    phase: MapPhase.INTAKE,
    assignInspector: true,
  },
  {
    mapNumber: "MAP-2024-0114",
    jiraTicketId: "OPS-4614",
    client: "Tiv Taam",
    area: "Ra'anana",
    description: "Fully assigned — waiting for team to accept",
    phase: MapPhase.INTAKE,
    assignInspector: true,
    assignQa: true,
    inspectorAssignAccepted: false,
    qaAssignAccepted: false,
    releasedToPipeline: true,
  },
  {
    mapNumber: "MAP-2024-0102",
    jiraTicketId: "OPS-4602",
    client: "CityShop",
    area: "Beer Sheva",
    description: "Initial graphics prep in progress",
    phase: MapPhase.PREP,
    status: MapStatus.PROCESSING,
    assignInspector: true,
  },
  {
    mapNumber: "MAP-2024-0103",
    jiraTicketId: "OPS-4603",
    client: "Urban Retail",
    area: "Tel Aviv",
    description: "Prep complete — QA reviewing dashboard upload",
    phase: MapPhase.UPLOAD_REVIEW,
    status: MapStatus.DONE,
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
    status: MapStatus.DONE,
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
    status: MapStatus.PROCESSING,
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
    status: MapStatus.FIX_DONE,
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
    status: MapStatus.FIX,
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
    status: MapStatus.APPROVED,
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
    status: MapStatus.ACCEPTED,
    assignInspector: true,
  },
  ...NEW_INTAKE_MAPS,
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
      ...(demo.dueDate ? { dueDate: new Date(demo.dueDate) } : {}),
      phase: demo.phase,
      status: demo.status ?? null,
      uploadApproved: demo.uploadApproved ?? false,
      inspectorAssignAccepted: demo.inspectorAssignAccepted ?? false,
      qaAssignAccepted: demo.qaAssignAccepted ?? false,
      workflowPhaseTarget: demo.workflowPhaseTarget ?? WorkflowPhaseTarget.PRE_UPLOAD,
      releasedToPipeline:
        demo.releasedToPipeline ?? demo.phase !== MapPhase.INTAKE,
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
