import { parse } from "csv-parse/sync";
import { FieldWorkStatus, MapPhase, MapTask, MapStation } from "@prisma/client";
import {
  applyPolishActivationPhase,
  isActivationDatePast,
  isPolishStageDone,
} from "../domain/pipeline.js";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";
import {
  buildHybridUpdate,
  type CsvImportConflict,
} from "./csvHybridMerge.js";

export type {
  CsvConflictField,
  CsvConflictResolution,
  CsvImportConflict,
} from "./csvHybridMerge.js";
export {
  buildHybridUpdate,
  isMapReceivedValue,
  mergePolishForward,
  mergeTaskForward,
  resolveCsvImportConflicts,
} from "./csvHybridMerge.js";

/** CSV header (row index 5) → Map string field. Empty CSV columns are omitted. */
const HEADER_TO_FIELD: Record<string, string> = {
  Batch: "batch",
  Building: "building",
  "Map received": "mapReceived",
  Address: "address",
  Setup: "setupStage",
  "Mapper Source": "mapperSource",
  "Mapper Name": "mapperName",
  Schedule: "scheduleDate",
  Mapping: "mappingDate",
  "Post Mapping": "postMappingDate",
  "Sent to studio": "sentToStudio",
  "Received from studio": "receivedFromStudio",
  "Graphics upload assignee": "graphicsUploadAssignee",
  "Upload QA Assignee": "uploadQaAssignee",
  "Graphics polish assignee": "graphicsPolishAssignee",
  "Graphics polish status [auto]": "graphicsPolishStatus",
  "Polish QA assignee": "polishQaAssignee",
  Conversion: "conversion",
  Polish: "polishStage",
  Activation: "activation",
  "Re-mapping Date": "remappingDate",
  Dashboard: "dashboardDate",
  "Maint.": "maintDate",
  "comments [external]": "commentExternal",
  "comments [internal]": "commentInternal",
};

const SPREADSHEET_FIELDS = Object.values(HEADER_TO_FIELD);

/** Phases that should not be forced back to FIELD by CSV mapping dates. */
const POST_FIELD_PHASES: MapPhase[] = [
  MapPhase.POLISH,
  MapPhase.QA_REVIEW,
  MapPhase.APPROVED,
  MapPhase.CANCELLED,
];

export type CsvImportResult = {
  created: number;
  updated: number;
  skipped: number;
  cleared: number;
  hubReady: number;
  errors: { row: number; message: string }[];
  sampleMapNumbers: string[];
  /** Date / batch conflicts left for the manager to resolve (non-blocking). */
  conflicts: CsvImportConflict[];
};

/** Trim CR/LF and whitespace from a CSV header cell. */
function normalizeHeader(h: string): string {
  return h.replace(/\r/g, "").replace(/\n/g, " ").trim();
}

/** Read a trimmed cell value from a parsed CSV row. */
function cell(row: Record<string, string>, header: string): string {
  const v = row[header];
  return typeof v === "string" ? v.trim() : "";
}

/** Convert empty strings to null for Prisma optional fields. */
function emptyToNull(v: string): string | null {
  return v ? v : null;
}

/**
 * Parse spreadsheet date cells ("15 Dec 2025", "03 Jun 26", "04 Jun").
 * Yearless values use `fallbackYear` when provided, otherwise the current year.
 */
export function parseCsvDate(raw: string, fallbackYear?: number): Date | null {
  const s = raw.trim();
  if (!s || /^queued\b/i.test(s) || /^(done|v|✓|yes|-|--)$/i.test(s)) return null;

  const withYear = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (withYear) {
    const year = withYear[3]!.length === 2 ? 2000 + Number(withYear[3]) : Number(withYear[3]);
    const d = new Date(`${withYear[2]} ${withYear[1]}, ${year}`);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }

  const noYear = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
  if (noYear) {
    const year = fallbackYear ?? new Date().getFullYear();
    const d = new Date(`${noYear[2]} ${noYear[1]}, ${year}`);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }

  const dash = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/i);
  if (dash) {
    const year = dash[3]!.length === 2 ? 2000 + Number(dash[3]) : Number(dash[3]);
    const d = new Date(`${dash[2]} ${dash[1]}, ${year}`);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }

  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime()) && direct.getFullYear() > 1990) {
    direct.setHours(0, 0, 0, 0);
    return direct;
  }
  return null;
}


/** Drop Done/done/v placeholders — these columns should be dates or empty. */
function dateCellOrNull(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || /^(done|v|✓|yes|-|--)$/i.test(s) || /^queued\b/i.test(s)) return null;
  return s;
}

/** Infer board Task from CSV Setup column when possible (no phase coupling). */
function taskFromSetup(setup: string | null): MapTask {
  const s = (setup ?? "").toLowerCase().trim();
  if (s.includes("uploaded") || s === "done") return MapTask.UPLOADED;
  if (s.includes("polish")) return MapTask.POLISH;
  if (s.includes("upload")) return MapTask.UPLOAD;
  return MapTask.UPLOAD;
}

function setupIndicatesUploaded(setup: string | null): boolean {
  const s = (setup ?? "").toLowerCase().trim();
  return s.includes("uploaded") || s === "done" || s.includes("approved");
}

export type AssigneeTaskResolution = {
  task: MapTask;
  assigneeConflict: boolean;
  graphicsUploadAssignee: string | null;
  uploadQaAssignee: string | null;
  graphicsPolishAssignee: string | null;
  polishQaAssignee: string | null;
};

/**
 * Upload-only → UPLOAD (or UPLOADED if Setup says so).
 * Polish-only → POLISH.
 * Both sides named → conflict (Please assign); Setup-derived task.
 * Neither → Setup / default.
 */
export function resolveTaskFromAssignees(row: Record<string, string>): AssigneeTaskResolution {
  const graphicsUploadAssignee = emptyToNull(cell(row, "Graphics upload assignee"));
  const uploadQaAssignee = emptyToNull(cell(row, "Upload QA Assignee"));
  const graphicsPolishAssignee = emptyToNull(cell(row, "Graphics polish assignee"));
  const polishQaAssignee = emptyToNull(cell(row, "Polish QA assignee"));
  const setup = emptyToNull(cell(row, "Setup"));

  const uploadHas = Boolean(graphicsUploadAssignee || uploadQaAssignee);
  const polishHas = Boolean(graphicsPolishAssignee || polishQaAssignee);

  if (uploadHas && polishHas) {
    return {
      task: taskFromSetup(setup),
      assigneeConflict: true,
      graphicsUploadAssignee,
      uploadQaAssignee,
      graphicsPolishAssignee,
      polishQaAssignee,
    };
  }

  if (uploadHas) {
    return {
      task: setupIndicatesUploaded(setup) ? MapTask.UPLOADED : MapTask.UPLOAD,
      assigneeConflict: false,
      graphicsUploadAssignee,
      uploadQaAssignee,
      graphicsPolishAssignee,
      polishQaAssignee,
    };
  }

  if (polishHas) {
    return {
      task: MapTask.POLISH,
      assigneeConflict: false,
      graphicsUploadAssignee,
      uploadQaAssignee,
      graphicsPolishAssignee,
      polishQaAssignee,
    };
  }

  return {
    task: taskFromSetup(setup),
    assigneeConflict: false,
    graphicsUploadAssignee,
    uploadQaAssignee,
    graphicsPolishAssignee,
    polishQaAssignee,
  };
}

/**
 * Only LIVE (real go-live value) archives a map.
 * Past Activation alone must NOT hide maps from the active Maps board.
 */
function isFinishedSpreadsheetRow(row: Record<string, string>): boolean {
  const live = cell(row, "LIVE").trim();
  if (live && !/^queued\b/i.test(live) && live !== "--" && live !== "-") return true;
  return false;
}

type SpreadsheetDates = {
  scheduleAt: Date | null;
  mappingAt: Date | null;
  activationAt: Date | null;
  sentToStudioAt: Date | null;
  receivedFromStudioAt: Date | null;
};

function parseSpreadsheetDates(row: Record<string, string>): SpreadsheetDates {
  const scheduleAt = parseCsvDate(cell(row, "Schedule"));
  const mappingAt = parseCsvDate(
    cell(row, "Mapping"),
    scheduleAt?.getFullYear()
  );
  const yearHint =
    mappingAt?.getFullYear() ?? scheduleAt?.getFullYear() ?? new Date().getFullYear();
  const activationAt = parseCsvDate(cell(row, "Activation"), yearHint);
  const sentToStudioAt = parseCsvDate(cell(row, "Sent to studio"), yearHint);
  const receivedFromStudioAt = parseCsvDate(cell(row, "Received from studio"), yearHint);
  return { scheduleAt, mappingAt, activationAt, sentToStudioAt, receivedFromStudioAt };
}

/**
 * Hub readiness: only the actual Mapping date puts a map on the Hub.
 * Schedule alone never does. Finished / cancelled rows stay off Hub.
 */
function hubFieldsForMapping(
  mappingAt: Date | null,
  opts: {
    cancelled: boolean;
    finished: boolean;
    existingPhase?: MapPhase;
    activationAt?: Date | null;
    polishStage?: string | null;
  }
): {
  fieldDate: Date | null;
  phase: MapPhase;
  uploadApproved: boolean;
  uploadCompletedAt: Date | null;
  fieldWorkStatus?: FieldWorkStatus;
} {
  if (opts.cancelled) {
    return {
      fieldDate: null,
      phase: MapPhase.CANCELLED,
      uploadApproved: false,
      uploadCompletedAt: null,
      fieldWorkStatus: FieldWorkStatus.CANCELLED,
    };
  }

  if (opts.finished) {
    return {
      fieldDate: mappingAt,
      phase: MapPhase.APPROVED,
      uploadApproved: true,
      uploadCompletedAt: new Date(),
      fieldWorkStatus: FieldWorkStatus.COMPLETED,
    };
  }

  if (mappingAt) {
    const existing = opts.existingPhase;
    // Don't pull polish/QA work back into FIELD on re-import.
    // APPROVED without LIVE is un-archived so past Activation maps stay visible.
    if (existing === MapPhase.APPROVED && !opts.finished) {
      // Past Activation / polish Done must stay on the active board (not archived).
      if (
        isActivationDatePast(opts.activationAt) ||
        (isPolishStageDone(opts.polishStage) && !opts.activationAt)
      ) {
        return {
          fieldDate: mappingAt,
          phase: MapPhase.POLISH,
          uploadApproved: true,
          uploadCompletedAt: new Date(),
          fieldWorkStatus: FieldWorkStatus.COMPLETED,
        };
      }
      return {
        fieldDate: mappingAt,
        phase: MapPhase.FIELD,
        uploadApproved: true,
        uploadCompletedAt: new Date(),
        fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      };
    }
    if (
      existing &&
      POST_FIELD_PHASES.includes(existing) &&
      existing !== MapPhase.CANCELLED &&
      existing !== MapPhase.APPROVED
    ) {
      return {
        fieldDate: mappingAt,
        phase: existing,
        uploadApproved: false,
        uploadCompletedAt: null,
      };
    }
    return {
      fieldDate: mappingAt,
      phase: MapPhase.FIELD,
      uploadApproved: true,
      uploadCompletedAt: new Date(),
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    };
  }

  // Mapping cleared → drop from Hub; keep advanced phases, else PREP/INTAKE.
  // Un-archive APPROVED when CSV is not LIVE so past Activation maps stay visible.
  const existing = opts.existingPhase;
  if (existing === MapPhase.APPROVED && !opts.finished) {
    if (
      isActivationDatePast(opts.activationAt) ||
      (isPolishStageDone(opts.polishStage) && !opts.activationAt)
    ) {
      return {
        fieldDate: null,
        phase: MapPhase.POLISH,
        uploadApproved: false,
        uploadCompletedAt: null,
        fieldWorkStatus: FieldWorkStatus.COMPLETED,
      };
    }
    return {
      fieldDate: null,
      phase: MapPhase.PREP,
      uploadApproved: false,
      uploadCompletedAt: null,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    };
  }
  if (existing && POST_FIELD_PHASES.includes(existing)) {
    return {
      fieldDate: null,
      phase: existing,
      uploadApproved: false,
      uploadCompletedAt: null,
    };
  }
  if (existing === MapPhase.FIELD || existing === MapPhase.UPLOAD_REVIEW) {
    return {
      fieldDate: null,
      phase: MapPhase.PREP,
      uploadApproved: false,
      uploadCompletedAt: null,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
    };
  }
  return {
    fieldDate: null,
    phase: existing ?? MapPhase.INTAKE,
    uploadApproved: false,
    uploadCompletedAt: null,
  };
}

function initialPhaseWithoutMapping(
  row: Record<string, string>,
  cancelled: boolean,
  finished: boolean
): MapPhase {
  if (cancelled) return MapPhase.CANCELLED;
  if (finished) return MapPhase.APPROVED;
  const received = cell(row, "Map received").toLowerCase();
  if (received === "v" || received === "✓" || received === "yes") return MapPhase.PREP;
  return MapPhase.INTAKE;
}

type MapCsvRowData = {
  mapNumber: string;
  client: string;
  area: string | null;
  description: string | null;
  phase: MapPhase;
  task: MapTask;
  station: MapStation;
  fieldDate: Date | null;
  dueDate: Date | null;
  uploadApproved: boolean;
  uploadCompletedAt: Date | null;
  fieldWorkStatus: FieldWorkStatus;
  releasedToGraphics: boolean;
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
  assigneeConflict: boolean;
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

/**
 * Sam's Club field-ops export: rows 0–4 are dashboard chrome;
 * row 5 is the real header; data starts at row 6.
 */
export function parseSamsClubCsv(csvText: string): {
  rows: Record<string, string>[];
  headerRowIndex: number;
} {
  const matrix: string[][] = parse(csvText, {
    relax_column_count: true,
    skip_empty_lines: false,
    bom: true,
  });

  if (matrix.length < 7) {
    throw new Error("CSV too short — expected header row plus data (Sam's Club export format)");
  }

  // Find header row: first row that contains both Batch and Building
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const normalized = matrix[i]!.map(normalizeHeader);
    if (normalized.includes("Batch") && normalized.includes("Building")) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) {
    throw new Error('Could not find header row with "Batch" and "Building" columns');
  }

  const headers = matrix[headerRowIndex]!.map(normalizeHeader);
  const rows: Record<string, string>[] = [];

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const raw = matrix[i]!;
    const obj: Record<string, string> = {};
    let any = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!;
      if (!key) continue;
      const val = (raw[c] ?? "").trim();
      obj[key] = val;
      if (val) any = true;
    }
    if (!any) continue;
    rows.push(obj);
  }

  return { rows, headerRowIndex };
}

/** Delete every map (used before a full CSV re-import). */
export async function clearAllMaps(): Promise<number> {
  const result = await prisma.map.deleteMany({});
  return result.count;
}

function buildRowData(
  row: Record<string, string>,
  defaultClient: string,
  existingPhase?: MapPhase
): MapCsvRowData | null {
  const building = cell(row, "Building");
  const batch = cell(row, "Batch");
  if (!building) return null;

  const mapNumber = `SC-${building}`;
  const isCancelled = batch.toLowerCase() === "cancelled";
  const finished = !isCancelled && isFinishedSpreadsheetRow(row);
  const dates = parseSpreadsheetDates(row);

  const spreadsheetData: Record<string, string | null> = {};
  for (const [header, field] of Object.entries(HEADER_TO_FIELD)) {
    spreadsheetData[field] = emptyToNull(cell(row, header));
  }

  const address = spreadsheetData.address;
  const commentBits = [spreadsheetData.commentExternal, spreadsheetData.commentInternal]
    .filter(Boolean)
    .join(" · ");

  const polishStage = emptyToNull(cell(row, "Polish"));

  const hub = hubFieldsForMapping(dates.mappingAt, {
    cancelled: isCancelled,
    finished,
    existingPhase,
    activationAt: dates.activationAt,
    polishStage,
  });

  let phase = hub.phase;
  if (!dates.mappingAt && !isCancelled && !finished && !existingPhase) {
    phase = initialPhaseWithoutMapping(row, isCancelled, finished);
  } else if (!dates.mappingAt && !isCancelled && !finished && existingPhase === MapPhase.INTAKE) {
    phase = initialPhaseWithoutMapping(row, isCancelled, finished);
  }

  phase = applyPolishActivationPhase(phase, {
    polishStage,
    activationAt: dates.activationAt,
    cancelled: isCancelled,
    finished,
  });

  const assignees = resolveTaskFromAssignees(row);
  let task = assignees.task;
  if (phase === MapPhase.POLISH) {
    task = MapTask.POLISH;
  }

  return {
    mapNumber,
    client: defaultClient,
    area: address,
    description: commentBits || null,
    phase,
    task,
    station: MapStation.GRAPHICS,
    fieldDate: hub.fieldDate,
    dueDate: dates.activationAt,
    uploadApproved: hub.uploadApproved,
    uploadCompletedAt: hub.uploadCompletedAt,
    fieldWorkStatus: hub.fieldWorkStatus ?? FieldWorkStatus.UNCOMPLETED,
    releasedToGraphics: phase !== MapPhase.INTAKE,
    batch: spreadsheetData.batch,
    building: spreadsheetData.building,
    address: spreadsheetData.address,
    mapReceived: spreadsheetData.mapReceived,
    setupStage: spreadsheetData.setupStage,
    mapperSource: spreadsheetData.mapperSource,
    mapperName: spreadsheetData.mapperName,
    scheduleDate: spreadsheetData.scheduleDate,
    scheduleAt: dates.scheduleAt,
    mappingDate: spreadsheetData.mappingDate,
    mappingAt: dates.mappingAt,
    postMappingDate: spreadsheetData.postMappingDate,
    sentToStudio: dates.sentToStudioAt
      ? dateCellOrNull(spreadsheetData.sentToStudio)
      : null,
    sentToStudioAt: dates.sentToStudioAt,
    receivedFromStudio: dates.receivedFromStudioAt
      ? dateCellOrNull(spreadsheetData.receivedFromStudio)
      : null,
    receivedFromStudioAt: dates.receivedFromStudioAt,
    graphicsUploadAssignee: assignees.graphicsUploadAssignee,
    uploadQaAssignee: assignees.uploadQaAssignee,
    graphicsPolishAssignee: assignees.graphicsPolishAssignee,
    graphicsPolishStatus: spreadsheetData.graphicsPolishStatus,
    polishQaAssignee: assignees.polishQaAssignee,
    assigneeConflict: assignees.assigneeConflict,
    conversion: spreadsheetData.conversion,
    polishStage: spreadsheetData.polishStage,
    activation: spreadsheetData.activation,
    activationAt: dates.activationAt,
    remappingDate: spreadsheetData.remappingDate,
    dashboardDate: spreadsheetData.dashboardDate,
    maintDate: spreadsheetData.maintDate,
    commentExternal: spreadsheetData.commentExternal,
    commentInternal: spreadsheetData.commentInternal,
  };
}

/**
 * Upsert maps from a Sam's Club CSV; optionally clear existing maps first.
 * Existing maps use hybrid merge (fill empty + forward-only + date/batch conflicts).
 */
export async function importSamsClubCsv(
  csvText: string,
  user: AuthUser,
  opts: { clearExisting?: boolean; defaultClient?: string } = {}
): Promise<CsvImportResult> {
  const defaultClient = opts.defaultClient ?? "Sam's Club";
  const { rows } = parseSamsClubCsv(csvText);

  let cleared = 0;
  if (opts.clearExisting) {
    cleared = await clearAllMaps();
  }

  const errors: { row: number; message: string }[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let hubReady = 0;
  const sampleMapNumbers: string[] = [];
  const conflicts: CsvImportConflict[] = [];

  const toCreate: MapCsvRowData[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sheetRow = i + 1;

    if (opts.clearExisting) {
      const data = buildRowData(row, defaultClient);
      if (!data) {
        errors.push({ row: sheetRow, message: "Missing Building" });
        skipped++;
        continue;
      }
      toCreate.push(data);
      if (data.uploadApproved && data.phase === MapPhase.FIELD) hubReady++;
      if (sampleMapNumbers.length < 8) sampleMapNumbers.push(data.mapNumber);
      continue;
    }

    try {
      const building = cell(row, "Building");
      if (!building) {
        errors.push({ row: sheetRow, message: "Missing Building" });
        skipped++;
        continue;
      }
      const mapNumber = `SC-${building}`;
      const existing = await prisma.map.findUnique({ where: { mapNumber } });
      const data = buildRowData(row, defaultClient, existing?.phase);
      if (!data) {
        errors.push({ row: sheetRow, message: "Missing Building" });
        skipped++;
        continue;
      }

      if (existing) {
        const { updateData, conflicts: rowConflicts } = buildHybridUpdate(existing, data);
        conflicts.push(...rowConflicts);

        if (Object.keys(updateData).length > 0) {
          await prisma.map.update({ where: { id: existing.id }, data: updateData });
          await prisma.mapEvent.create({
            data: {
              mapId: existing.id,
              userId: user.id,
              action: "csv_import_updated",
              note:
                rowConflicts.length > 0
                  ? `Hybrid CSV update (${mapNumber}); ${rowConflicts.length} conflict(s) pending`
                  : `Hybrid CSV update (${mapNumber})`,
            },
          });
          updated++;
        } else if (rowConflicts.length > 0) {
          updated++;
        } else {
          skipped++;
        }

        if (data.uploadApproved && data.phase === MapPhase.FIELD) hubReady++;
      } else {
        const map = await prisma.map.create({ data });
        await prisma.mapEvent.create({
          data: {
            mapId: map.id,
            userId: user.id,
            action: "csv_import_created",
            note: data.mappingAt
              ? `Imported from CSV (${mapNumber}); Hub date ${data.mappingAt.toISOString().slice(0, 10)}`
              : `Imported from CSV (${mapNumber})`,
          },
        });
        created++;
        if (data.uploadApproved && data.phase === MapPhase.FIELD) hubReady++;
        if (sampleMapNumbers.length < 8) sampleMapNumbers.push(mapNumber);
      }
    } catch (e) {
      errors.push({ row: sheetRow, message: (e as Error).message });
      skipped++;
    }
  }

  if (opts.clearExisting && toCreate.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const chunk = toCreate.slice(i, i + BATCH);
      try {
        await prisma.map.createMany({ data: chunk });
        created += chunk.length;
      } catch (e) {
        for (const row of chunk) {
          try {
            await prisma.map.create({ data: row });
            created++;
          } catch (err) {
            errors.push({ row: 0, message: `${row.mapNumber}: ${(err as Error).message}` });
            skipped++;
            if (row.uploadApproved && row.phase === MapPhase.FIELD) hubReady--;
          }
        }
      }
    }

    const maps = await prisma.map.findMany({
      where: { mapNumber: { in: toCreate.map((m) => m.mapNumber) } },
      select: { id: true, mapNumber: true },
    });
    if (maps.length > 0) {
      await prisma.mapEvent.createMany({
        data: maps.map((m) => ({
          mapId: m.id,
          userId: user.id,
          action: "csv_import_created",
          note: `Imported from CSV (${m.mapNumber})`,
        })),
      });
    }
  }

  void SPREADSHEET_FIELDS;
  return { created, updated, skipped, cleared, hubReady, errors, sampleMapNumbers, conflicts };
}

/** Dry-run CSV parse: row counts and sample buildings, no DB writes. */
export async function previewSamsClubCsv(csvText: string) {
  const { rows, headerRowIndex } = parseSamsClubCsv(csvText);
  const cancelled = rows.filter((r) => cell(r, "Batch").toLowerCase() === "cancelled").length;
  let withMapping = 0;
  let scheduleOnly = 0;
  const samples = rows.slice(0, 5).map((r) => {
    const dates = parseSpreadsheetDates(r);
    if (dates.mappingAt) withMapping++;
    else if (dates.scheduleAt) scheduleOnly++;
    return {
      mapNumber: cell(r, "Building") ? `SC-${cell(r, "Building")}` : null,
      building: cell(r, "Building") || null,
      batch: cell(r, "Batch") || null,
      address: cell(r, "Address") || null,
      schedule: cell(r, "Schedule") || null,
      mapping: cell(r, "Mapping") || null,
      activation: cell(r, "Activation") || null,
      polishAssignee: cell(r, "Graphics polish assignee") || null,
      qaAssignee: cell(r, "Polish QA assignee") || null,
      mappingAt: dates.mappingAt?.toISOString() ?? null,
      hubEligible: Boolean(dates.mappingAt) && !isFinishedSpreadsheetRow(r),
    };
  });
  // Recount hub-eligible across all rows for preview stats
  withMapping = 0;
  scheduleOnly = 0;
  let hubEligible = 0;
  for (const r of rows) {
    const dates = parseSpreadsheetDates(r);
    if (dates.mappingAt) {
      withMapping++;
      if (!isFinishedSpreadsheetRow(r) && cell(r, "Batch").toLowerCase() !== "cancelled") {
        hubEligible++;
      }
    } else if (dates.scheduleAt) {
      scheduleOnly++;
    }
  }
  return {
    headerRowIndex,
    totalRows: rows.length,
    cancelledRows: cancelled,
    activeRows: rows.length - cancelled,
    withMappingDate: withMapping,
    scheduleOnlyNoMapping: scheduleOnly,
    hubEligible,
    samples,
  };
}
