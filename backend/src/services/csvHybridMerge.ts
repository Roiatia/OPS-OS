import { MapTask, Prisma } from "@prisma/client";
import { isPolishStageDone } from "../domain/pipeline.js";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";

/** Fields that can differ between system and CSV and need a manager choice. */
export type CsvConflictField =
  | "batch"
  | "scheduleAt"
  | "mappingAt"
  | "sentToStudioAt"
  | "receivedFromStudioAt"
  | "activationAt";

export type CsvImportConflict = {
  mapId: string;
  mapNumber: string;
  field: CsvConflictField;
  systemValue: string | null;
  csvValue: string | null;
  /** yyyy-mm-dd when field is a date — used to apply the CSV choice */
  csvIsoDate: string | null;
};

export type CsvConflictResolution = {
  mapId: string;
  field: CsvConflictField;
  choice: "system" | "csv";
  csvValue?: string | null;
  csvIsoDate?: string | null;
};

/** CSV row payload used for hybrid merge (subset of import row data). */
export type HybridCsvRow = {
  client: string;
  area: string | null;
  description: string | null;
  task: MapTask;
  batch: string | null;
  building: string | null;
  address: string | null;
  mapReceived: string | null;
  setupStage: string | null;
  mapperSource: string | null;
  mapperName: string | null;
  scheduleDate: string | null;
  scheduleAt: Date | null;
  mappingDate: string | null;
  mappingAt: Date | null;
  postMappingDate: string | null;
  sentToStudio: string | null;
  sentToStudioAt: Date | null;
  receivedFromStudio: string | null;
  receivedFromStudioAt: Date | null;
  graphicsUploadAssignee: string | null;
  uploadQaAssignee: string | null;
  graphicsPolishAssignee: string | null;
  graphicsPolishStatus: string | null;
  polishQaAssignee: string | null;
  conversion: string | null;
  polishStage: string | null;
  activation: string | null;
  activationAt: Date | null;
  remappingDate: string | null;
  dashboardDate: string | null;
  maintDate: string | null;
  commentExternal: string | null;
  commentInternal: string | null;
};

type ExistingMapForMerge = {
  id: string;
  mapNumber: string;
  client: string;
  area: string | null;
  description: string | null;
  task: MapTask;
  batch: string | null;
  building: string | null;
  address: string | null;
  mapReceived: string | null;
  setupStage: string | null;
  mapperSource: string | null;
  mapperName: string | null;
  scheduleDate: string | null;
  scheduleAt: Date | null;
  mappingDate: string | null;
  mappingAt: Date | null;
  postMappingDate: string | null;
  sentToStudio: string | null;
  sentToStudioAt: Date | null;
  receivedFromStudio: string | null;
  receivedFromStudioAt: Date | null;
  graphicsUploadAssignee: string | null;
  uploadQaAssignee: string | null;
  graphicsPolishAssignee: string | null;
  graphicsPolishStatus: string | null;
  polishQaAssignee: string | null;
  conversion: string | null;
  polishStage: string | null;
  activation: string | null;
  activationAt: Date | null;
  remappingDate: string | null;
  dashboardDate: string | null;
  maintDate: string | null;
  commentExternal: string | null;
  commentInternal: string | null;
  uploadCompletedAt: Date | null;
};

function isBlank(v: string | null | undefined): boolean {
  return v == null || !String(v).trim();
}

/** True when Map received cell means received (CSV "v" etc.). */
export function isMapReceivedValue(v: string | null | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "v" || s === "✓" || s === "yes" || s === "true";
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatConflictDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function toIsoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Drop Done/done/v placeholders — these columns should be dates or empty. */
function dateCellOrNull(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || /^(done|v|✓|yes|-|--)$/i.test(s) || /^queued\b/i.test(s)) return null;
  return s;
}

const TASK_RANK: Record<MapTask, number> = {
  [MapTask.UPLOAD]: 0,
  [MapTask.UPLOADED]: 1,
  [MapTask.POLISH]: 2,
};

/** Task only moves forward — maps never un-upload. */
export function mergeTaskForward(existing: MapTask, csvTask: MapTask): MapTask {
  return TASK_RANK[csvTask] > TASK_RANK[existing] ? csvTask : existing;
}

/**
 * Polish: fill empty; forward to Done; never undo Done.
 * Returns undefined when the system value should be kept.
 */
export function mergePolishForward(
  existing: string | null | undefined,
  csv: string | null | undefined
): string | null | undefined {
  const sys = (existing ?? "").trim();
  const incoming = (csv ?? "").trim();
  if (!sys && incoming) return incoming;
  if (isPolishStageDone(sys)) return undefined;
  if (isPolishStageDone(incoming)) return incoming;
  return undefined;
}

function fillEmptyString(
  existing: string | null | undefined,
  csv: string | null | undefined
): string | null | undefined {
  if (!isBlank(existing)) return undefined;
  if (isBlank(csv)) return undefined;
  return csv!.trim();
}

type PendingConflict = Omit<CsvImportConflict, "mapId" | "mapNumber">;

/**
 * Hybrid merge for an existing map:
 * - fill empty cells from CSV
 * - Map received / Task / Polish are process-forward only
 * - phase / pipeline never taken from CSV
 * - date + batch conflicts deferred for UI
 * - deadline follows activation when activation is applied
 */
export function buildHybridUpdate(
  existing: ExistingMapForMerge,
  csv: HybridCsvRow
): { updateData: Prisma.MapUpdateInput; conflicts: CsvImportConflict[] } {
  const updateData: Prisma.MapUpdateInput = {};
  const pending: PendingConflict[] = [];

  const setIf = (key: keyof Prisma.MapUpdateInput, value: unknown) => {
    if (value !== undefined) (updateData as Record<string, unknown>)[key] = value;
  };

  setIf("client", fillEmptyString(existing.client, csv.client));
  setIf("area", fillEmptyString(existing.area, csv.area));
  setIf("description", fillEmptyString(existing.description, csv.description));
  setIf("building", fillEmptyString(existing.building, csv.building));
  setIf("address", fillEmptyString(existing.address, csv.address));
  setIf("setupStage", fillEmptyString(existing.setupStage, csv.setupStage));
  setIf("mapperSource", fillEmptyString(existing.mapperSource, csv.mapperSource));
  setIf("mapperName", fillEmptyString(existing.mapperName, csv.mapperName));
  setIf("postMappingDate", fillEmptyString(existing.postMappingDate, csv.postMappingDate));
  setIf(
    "graphicsUploadAssignee",
    fillEmptyString(existing.graphicsUploadAssignee, csv.graphicsUploadAssignee)
  );
  setIf("uploadQaAssignee", fillEmptyString(existing.uploadQaAssignee, csv.uploadQaAssignee));
  setIf(
    "graphicsPolishAssignee",
    fillEmptyString(existing.graphicsPolishAssignee, csv.graphicsPolishAssignee)
  );
  setIf(
    "graphicsPolishStatus",
    fillEmptyString(existing.graphicsPolishStatus, csv.graphicsPolishStatus)
  );
  setIf("polishQaAssignee", fillEmptyString(existing.polishQaAssignee, csv.polishQaAssignee));
  setIf("conversion", fillEmptyString(existing.conversion, csv.conversion));
  setIf("remappingDate", fillEmptyString(existing.remappingDate, csv.remappingDate));
  setIf("dashboardDate", fillEmptyString(existing.dashboardDate, csv.dashboardDate));
  setIf("maintDate", fillEmptyString(existing.maintDate, csv.maintDate));
  setIf("commentExternal", fillEmptyString(existing.commentExternal, csv.commentExternal));
  setIf("commentInternal", fillEmptyString(existing.commentInternal, csv.commentInternal));

  // Batch — empty fill, or conflict when both set and differ
  const sysBatch = (existing.batch ?? "").trim();
  const csvBatch = (csv.batch ?? "").trim();
  if (!sysBatch && csvBatch) {
    updateData.batch = csvBatch;
  } else if (sysBatch && csvBatch && sysBatch.toLowerCase() !== csvBatch.toLowerCase()) {
    pending.push({
      field: "batch",
      systemValue: sysBatch,
      csvValue: csvBatch,
      csvIsoDate: null,
    });
  }

  // Map received — forward only to "v"
  if (!isMapReceivedValue(existing.mapReceived)) {
    if (isMapReceivedValue(csv.mapReceived)) {
      updateData.mapReceived = "v";
    } else {
      setIf("mapReceived", fillEmptyString(existing.mapReceived, csv.mapReceived));
    }
  }

  // Task — never un-upload
  const nextTask = mergeTaskForward(existing.task, csv.task);
  if (nextTask !== existing.task) updateData.task = nextTask;

  // Polish — forward to Done / fill empty
  setIf("polishStage", mergePolishForward(existing.polishStage, csv.polishStage));

  // Dates — empty→CSV; both set & differ→conflict; system set & CSV empty→keep
  const dateFields: Array<{
    field: Exclude<CsvConflictField, "batch">;
    existingAt: Date | null;
    csvAt: Date | null;
    csvRaw: string | null;
    rawKey: keyof Prisma.MapUpdateInput;
  }> = [
    {
      field: "scheduleAt",
      existingAt: existing.scheduleAt,
      csvAt: csv.scheduleAt,
      csvRaw: csv.scheduleDate,
      rawKey: "scheduleDate",
    },
    {
      field: "mappingAt",
      existingAt: existing.mappingAt,
      csvAt: csv.mappingAt,
      csvRaw: csv.mappingDate,
      rawKey: "mappingDate",
    },
    {
      field: "sentToStudioAt",
      existingAt: existing.sentToStudioAt,
      csvAt: csv.sentToStudioAt,
      csvRaw: csv.sentToStudio,
      rawKey: "sentToStudio",
    },
    {
      field: "receivedFromStudioAt",
      existingAt: existing.receivedFromStudioAt,
      csvAt: csv.receivedFromStudioAt,
      csvRaw: csv.receivedFromStudio,
      rawKey: "receivedFromStudio",
    },
    {
      field: "activationAt",
      existingAt: existing.activationAt,
      csvAt: csv.activationAt,
      csvRaw: csv.activation,
      rawKey: "activation",
    },
  ];

  for (const df of dateFields) {
    if (!df.existingAt && df.csvAt) {
      (updateData as Record<string, unknown>)[df.field] = df.csvAt;
      (updateData as Record<string, unknown>)[df.rawKey] =
        dateCellOrNull(df.csvRaw) ?? formatConflictDate(df.csvAt);

      if (df.field === "mappingAt") {
        // Auto-fill empty mapping → Hub date (conflict path does NOT touch fieldDate)
        updateData.fieldDate = df.csvAt;
        updateData.uploadApproved = true;
        updateData.uploadCompletedAt = existing.uploadCompletedAt ?? new Date();
      }
      if (df.field === "activationAt") {
        // Deadline follows activation
        updateData.dueDate = df.csvAt;
      }
      continue;
    }
    if (df.existingAt && df.csvAt && !sameCalendarDay(df.existingAt, df.csvAt)) {
      pending.push({
        field: df.field,
        systemValue: formatConflictDate(df.existingAt),
        csvValue: formatConflictDate(df.csvAt),
        csvIsoDate: toIsoDateOnly(df.csvAt),
      });
    }
  }

  // phase / pipeline / station / assignments / fieldWorkStatus — never from CSV on existing

  const conflicts: CsvImportConflict[] = pending.map((p) => ({
    mapId: existing.id,
    mapNumber: existing.mapNumber,
    ...p,
  }));

  return { updateData, conflicts };
}

/**
 * Apply manager choices for CSV import conflicts (batch + dates).
 * Mapping "use CSV" updates mappingAt only — not Hub fieldDate (per product rule).
 * Activation "use CSV" also sets deadline (dueDate).
 */
export async function resolveCsvImportConflicts(
  resolutions: CsvConflictResolution[],
  user: AuthUser
): Promise<{ applied: number }> {
  let applied = 0;

  for (const r of resolutions) {
    if (r.choice === "system") continue;

    const existing = await prisma.map.findUnique({ where: { id: r.mapId } });
    if (!existing) continue;

    const data: Prisma.MapUpdateInput = {};

    if (r.field === "batch") {
      const v = (r.csvValue ?? "").trim();
      if (!v) continue;
      data.batch = v;
    } else {
      const iso = r.csvIsoDate?.trim();
      if (!iso) continue;
      const d = parseIsoDateOnly(iso);
      if (!d) continue;

      const label = formatConflictDate(d);
      switch (r.field) {
        case "scheduleAt":
          data.scheduleAt = d;
          data.scheduleDate = label;
          break;
        case "mappingAt":
          data.mappingAt = d;
          data.mappingDate = label;
          // Intentionally do NOT set fieldDate on conflict resolve
          break;
        case "sentToStudioAt":
          data.sentToStudioAt = d;
          data.sentToStudio = label;
          break;
        case "receivedFromStudioAt":
          data.receivedFromStudioAt = d;
          data.receivedFromStudio = label;
          break;
        case "activationAt":
          data.activationAt = d;
          data.activation = label;
          data.dueDate = d;
          break;
        default:
          continue;
      }
    }

    await prisma.map.update({ where: { id: r.mapId }, data });
    await prisma.mapEvent.create({
      data: {
        mapId: r.mapId,
        userId: user.id,
        action: "csv_conflict_resolved",
        note: `${r.field} → CSV (${r.csvValue ?? r.csvIsoDate ?? ""})`,
      },
    });
    applied++;
  }

  return { applied };
}
