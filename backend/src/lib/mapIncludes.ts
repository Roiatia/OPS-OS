/**
 * Standard relation shaping for a Map returned to the client.
 * Kept in its own module so both the workflow service and the Prisma client
 * extension (lib/prisma.ts) can reuse it without an import cycle.
 *
 * Two shapes are exported:
 * - `mapDetailIncludes` — the full payload including base64 attachment `data`
 *   and up to 50 events. Used by the single-map detail endpoint and mutation
 *   responses that flow to MapDetailPage (which renders attachments/notes).
 * - `mapListIncludes` — a lighter payload for lists and realtime broadcasts:
 *   attachment metadata only (NO base64 `data`) and events capped to 20. This
 *   keeps large base64 blobs out of every list query and every broadcast.
 */
export const mapDetailIncludes = {
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

/**
 * Lighter shape for list queries + realtime broadcasts. Attachments carry
 * metadata only (the base64 `data` @db.Text field is omitted) and events are
 * capped lower. Assignees, tasks, phaseHistory and notes are small enough to keep.
 */
export const mapListIncludes = {
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
    take: 20,
  },
  phaseHistory: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { enteredAt: "asc" as const },
  },
  attachments: {
    // Metadata only — deliberately omits the base64 `data` field.
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      context: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  notes: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

/**
 * Backwards-compatible alias — existing imports of `mapIncludes` get the full
 * detail shape. New code should import `mapListIncludes` / `mapDetailIncludes`
 * explicitly.
 */
export const mapIncludes = mapDetailIncludes;
