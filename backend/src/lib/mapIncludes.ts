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
 *   attachment metadata only (NO base64 `data`) and events capped low (events
 *   aren't rendered from list/board records). This keeps large base64 blobs and
 *   long event tails out of every list query and every broadcast. `notes` are
 *   kept because the active-maps tables render note bodies from list data.
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
 * capped low (not rendered in lists). `notes` are capped to the 3 most recent
 * (the active-maps tables only render a short preview/last-few from list data).
 * `phaseHistory` and `tasks` are deliberately omitted — boards never read them
 * (verified: task filters derive from a computed task-type, not `map.tasks`;
 * `phaseHistory` is only used by the archived HistoryPanel and MapDetailPage,
 * which use `mapHistoryIncludes` / `mapDetailIncludes` respectively). At scale
 * this keeps unbounded relation tails out of every list query and broadcast.
 */
export const mapListIncludes = {
  assignedInspector: { select: { id: true, name: true, email: true } },
  assignedQa: { select: { id: true, name: true, email: true } },
  assignedSupervisor: { select: { id: true, name: true, email: true } },
  events: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
    // Lists/boards + realtime broadcasts don't render per-map events (only the
    // detail page does, via mapDetailIncludes). Keep a small recent slice.
    take: 5,
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
    // Only the 3 most recent — the tables show a preview/last-few, not the full
    // thread (which lives on the detail page). desc+take keeps the query bounded;
    // the tables sort-normalize for display so order stays consistent.
    orderBy: { createdAt: "desc" as const },
    take: 3,
  },
};

/**
 * History/archived-list shape. Same lightweight payload as `mapListIncludes`
 * but re-adds `phaseHistory`, which `HistoryPanel` renders for archived maps.
 * Used by `listHistoryMaps` (the lazily-loaded History tab) so trimming the
 * active list shape stays safe.
 */
export const mapHistoryIncludes = {
  ...mapListIncludes,
  phaseHistory: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { enteredAt: "asc" as const },
  },
};

/**
 * Backwards-compatible alias — existing imports of `mapIncludes` get the full
 * detail shape. New code should import `mapListIncludes` / `mapDetailIncludes`
 * explicitly.
 */
export const mapIncludes = mapDetailIncludes;
