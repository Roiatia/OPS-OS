import { parse } from "csv-parse/sync";
import { MapPhase, MapTask, MapStation } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";

/** CSV header (row index 5) → Map field. Empty CSV columns are omitted. */
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

export type CsvImportResult = {
  created: number;
  updated: number;
  skipped: number;
  cleared: number;
  errors: { row: number; message: string }[];
  sampleMapNumbers: string[];
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

/** Infer board Task from CSV Setup column when possible (no phase coupling). */
function taskFromSetup(setup: string | null): MapTask {
  const s = (setup ?? "").toLowerCase().trim();
  if (s.includes("uploaded")) return MapTask.UPLOADED;
  if (s.includes("polish")) return MapTask.POLISH;
  if (s.includes("upload")) return MapTask.UPLOAD;
  return MapTask.UPLOAD;
}

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

/**
 * Upsert maps from a Sam's Club CSV; optionally clear existing maps first.
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
  const sampleMapNumbers: string[] = [];

  const toCreate: {
    mapNumber: string;
    client: string;
    area: string | null;
    description: string | null;
    phase: MapPhase;
    task: MapTask;
    station: MapStation;
    batch: string | null;
    building: string | null;
    address: string | null;
    mapReceived: string | null;
    setupStage: string | null;
    mapperSource: string | null;
    mapperName: string | null;
    scheduleDate: string | null;
    mappingDate: string | null;
    postMappingDate: string | null;
    sentToStudio: string | null;
    receivedFromStudio: string | null;
    graphicsPolishAssignee: string | null;
    graphicsPolishStatus: string | null;
    polishQaAssignee: string | null;
    conversion: string | null;
    polishStage: string | null;
    activation: string | null;
    remappingDate: string | null;
    dashboardDate: string | null;
    maintDate: string | null;
    commentExternal: string | null;
    commentInternal: string | null;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sheetRow = i + 1;
    const building = cell(row, "Building");
    const batch = cell(row, "Batch");

    if (!building) {
      errors.push({ row: sheetRow, message: "Missing Building" });
      skipped++;
      continue;
    }

    // Stable map id from building code (matches existing Sam's Club naming).
    const mapNumber = `SC-${building}`;
    // Batch column "Cancelled" → CANCELLED phase (still imported for history).
    const isCancelled = batch.toLowerCase() === "cancelled";

    // Copy all spreadsheet columns onto Map.* string fields for later use.
    const spreadsheetData: Record<string, string | null> = {};
    for (const [header, field] of Object.entries(HEADER_TO_FIELD)) {
      spreadsheetData[field] = emptyToNull(cell(row, header));
    }

    const address = spreadsheetData.address;
    const commentBits = [spreadsheetData.commentExternal, spreadsheetData.commentInternal]
      .filter(Boolean)
      .join(" · ");

    const data = {
      mapNumber,
      client: defaultClient,
      area: address,
      description: commentBits || null,
      phase: isCancelled ? MapPhase.CANCELLED : MapPhase.INTAKE,
      task: taskFromSetup(spreadsheetData.setupStage),
      station: MapStation.GRAPHICS,
      batch: spreadsheetData.batch,
      building: spreadsheetData.building,
      address: spreadsheetData.address,
      mapReceived: spreadsheetData.mapReceived,
      setupStage: spreadsheetData.setupStage,
      mapperSource: spreadsheetData.mapperSource,
      mapperName: spreadsheetData.mapperName,
      scheduleDate: spreadsheetData.scheduleDate,
      mappingDate: spreadsheetData.mappingDate,
      postMappingDate: spreadsheetData.postMappingDate,
      sentToStudio: spreadsheetData.sentToStudio,
      receivedFromStudio: spreadsheetData.receivedFromStudio,
      graphicsPolishAssignee: spreadsheetData.graphicsPolishAssignee,
      graphicsPolishStatus: spreadsheetData.graphicsPolishStatus,
      polishQaAssignee: spreadsheetData.polishQaAssignee,
      conversion: spreadsheetData.conversion,
      polishStage: spreadsheetData.polishStage,
      activation: spreadsheetData.activation,
      remappingDate: spreadsheetData.remappingDate,
      dashboardDate: spreadsheetData.dashboardDate,
      maintDate: spreadsheetData.maintDate,
      commentExternal: spreadsheetData.commentExternal,
      commentInternal: spreadsheetData.commentInternal,
    };

    if (opts.clearExisting) {
      toCreate.push(data);
      if (sampleMapNumbers.length < 8) sampleMapNumbers.push(mapNumber);
      continue;
    }

    try {
      const existing = await prisma.map.findUnique({ where: { mapNumber } });
      if (existing) {
        await prisma.map.update({
          where: { id: existing.id },
          data: {
            client: data.client,
            area: data.area,
            description: data.description,
            phase: isCancelled ? MapPhase.CANCELLED : existing.phase,
            batch: data.batch,
            building: data.building,
            address: data.address,
            mapReceived: data.mapReceived,
            setupStage: data.setupStage,
            mapperSource: data.mapperSource,
            mapperName: data.mapperName,
            scheduleDate: data.scheduleDate,
            mappingDate: data.mappingDate,
            postMappingDate: data.postMappingDate,
            sentToStudio: data.sentToStudio,
            receivedFromStudio: data.receivedFromStudio,
            graphicsPolishAssignee: data.graphicsPolishAssignee,
            graphicsPolishStatus: data.graphicsPolishStatus,
            polishQaAssignee: data.polishQaAssignee,
            conversion: data.conversion,
            polishStage: data.polishStage,
            activation: data.activation,
            remappingDate: data.remappingDate,
            dashboardDate: data.dashboardDate,
            maintDate: data.maintDate,
            commentExternal: data.commentExternal,
            commentInternal: data.commentInternal,
          },
        });
        await prisma.mapEvent.create({
          data: {
            mapId: existing.id,
            userId: user.id,
            action: "csv_import_updated",
            note: `Updated from CSV (${mapNumber})`,
          },
        });
        updated++;
      } else {
        const map = await prisma.map.create({ data });
        await prisma.mapEvent.create({
          data: {
            mapId: map.id,
            userId: user.id,
            action: "csv_import_created",
            note: `Imported from CSV (${mapNumber})`,
          },
        });
        created++;
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
        // Fall back row-by-row for this chunk
        for (const row of chunk) {
          try {
            await prisma.map.create({ data: row });
            created++;
          } catch (err) {
            errors.push({ row: 0, message: `${row.mapNumber}: ${(err as Error).message}` });
            skipped++;
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
  return { created, updated, skipped, cleared, errors, sampleMapNumbers };
}

/** Dry-run CSV parse: row counts and sample buildings, no DB writes. */
export async function previewSamsClubCsv(csvText: string) {
  const { rows, headerRowIndex } = parseSamsClubCsv(csvText);
  const cancelled = rows.filter((r) => cell(r, "Batch").toLowerCase() === "cancelled").length;
  const samples = rows.slice(0, 5).map((r) => ({
    mapNumber: cell(r, "Building") ? `SC-${cell(r, "Building")}` : null,
    building: cell(r, "Building") || null,
    batch: cell(r, "Batch") || null,
    address: cell(r, "Address") || null,
    polishAssignee: cell(r, "Graphics polish assignee") || null,
  }));
  return {
    headerRowIndex,
    totalRows: rows.length,
    cancelledRows: cancelled,
    activeRows: rows.length - cancelled,
    samples,
  };
}
