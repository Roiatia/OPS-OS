/**
 * Standard relation shaping for a Map returned to the client.
 * Kept in its own module so both the workflow service and the Prisma client
 * extension (lib/prisma.ts) can reuse it without an import cycle.
 */
export const mapIncludes = {
  assignedInspector: { select: { id: true, name: true, email: true } },
  assignedQa: { select: { id: true, name: true, email: true } },
  assignedSupervisor: { select: { id: true, name: true, email: true } },
  tasks: {
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  events: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
    take: 50,
  },
  phaseHistory: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { enteredAt: "asc" as const },
  },
  attachments: {
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  notes: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};
