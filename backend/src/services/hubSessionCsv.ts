import { parse } from "csv-parse/sync";
import { FieldWorkStatus, MapPhase, MapStation, MapTask } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";

/**
 * Daily mapping-session CSV used by the OPS managers, one row per session:
 *   name,number,time,mapper,isNew,status,meetLink
 *   Sam's Club,6218,15:00,Brandon Wright,FALSE,ACTIVE,https://meet.google.com/...
 *
 * Separate from the Sam's Club pipeline export in `csvImport.ts`, which is
 * keyed on Batch/Building and drives the whole map lifecycle.
 */

const REQUIRED_HEADERS = ["name", "number", "time"] as const;

export type HubSessionRow = {
  /** Row number as shown in the spreadsheet (header is row 1). */
  row: number;
  mapNumber: string;
  client: string;
  storeNumber: string;
  startMinutes: number;
  timeLabel: string;
  mapperName: string | null;
  isNewStore: boolean;
  fieldWorkStatus: FieldWorkStatus;
  meetLink: string | null;
};

export type HubSessionPreview = {
  sessionDate: string;
  totalRows: number;
  active: number;
  cancelled: number;
  newStores: number;
  withMeetLink: number;
  existingMaps: number;
  newMaps: number;
  errors: { row: number; message: string }[];
  samples: HubSessionRow[];
};

export type HubSessionImportResult = {
  sessionDate: string;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  sampleMapNumbers: string[];
};

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").replace(/\s+/g, "").trim().toLowerCase();
}

/** "15:00", "9:30", "1500" or "3:00 PM" → minutes from midnight. */
export function parseSessionTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2] ?? 0);
    const isPm = ampm[3]!.toLowerCase() === "pm";
    if (hour === 12) hour = 0;
    if (isPm) hour += 12;
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  const colon = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  const digits = s.match(/^(\d{1,2})(\d{2})$/);
  if (digits) {
    const hour = Number(digits[1]);
    const minute = Number(digits[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  return null;
}

export function parseBoolCell(raw: string): boolean {
  return /^(true|yes|y|1|new)$/i.test(raw.trim());
}

/** ACTIVE keeps the session live; anything cancelled/done maps to its status. */
export function parseSessionStatus(raw: string): FieldWorkStatus {
  const s = raw.trim().toUpperCase();
  if (s === "CANCELLED" || s === "CANCELED" || s === "INACTIVE") {
    return FieldWorkStatus.CANCELLED;
  }
  if (s === "COMPLETED" || s === "COMPLETE" || s === "DONE") {
    return FieldWorkStatus.COMPLETED;
  }
  return FieldWorkStatus.UNCOMPLETED;
}

/** Sam's Club keeps its `SC-####` numbering; other clients get a name prefix. */
export function hubMapNumber(client: string, storeNumber: string): string {
  const normalized = client.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (normalized === "samsclub") return `SC-${storeNumber}`;
  const prefix = client
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, "").charAt(0))
    .join("")
    .toUpperCase();
  return `${prefix || "MAP"}-${storeNumber}`;
}

function timeLabel(startMinutes: number): string {
  const h = Math.floor(startMinutes / 60);
  const m = startMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Session date at the row's clock time, in server-local time like the rest of the Hub. */
function sessionDateTime(sessionDate: Date, startMinutes: number): Date {
  const d = new Date(sessionDate);
  d.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return d;
}

export function parseSessionDate(raw?: string): Date {
  const d = raw ? new Date(`${raw}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid session date "${raw}" — expected YYYY-MM-DD`);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseHubSessionCsv(csvText: string): {
  rows: HubSessionRow[];
  errors: { row: number; message: string }[];
} {
  const matrix: string[][] = parse(csvText, {
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
  });

  if (matrix.length < 2) {
    throw new Error("CSV is empty — expected a header row plus at least one session");
  }

  const headers = matrix[0]!.map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new Error(
      `Missing column(s): ${missing.join(", ")}. Expected header: name,number,time,mapper,isNew,status,meetLink`
    );
  }

  const col = (name: string) => headers.indexOf(name);
  const idx = {
    name: col("name"),
    number: col("number"),
    time: col("time"),
    mapper: col("mapper"),
    isNew: col("isnew"),
    status: col("status"),
    meetLink: col("meetlink"),
  };

  const rows: HubSessionRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i]!;
    const at = (c: number) => (c >= 0 ? (raw[c] ?? "").trim() : "");
    const sheetRow = i + 1;

    const client = at(idx.name);
    const storeNumber = at(idx.number);
    const time = at(idx.time);

    if (!client && !storeNumber && !time) continue;

    if (!client) {
      errors.push({ row: sheetRow, message: "Missing name" });
      continue;
    }
    if (!storeNumber) {
      errors.push({ row: sheetRow, message: "Missing number" });
      continue;
    }
    const startMinutes = parseSessionTime(time);
    if (startMinutes == null) {
      errors.push({ row: sheetRow, message: `Invalid time "${time}"` });
      continue;
    }

    const mapNumber = hubMapNumber(client, storeNumber);
    const duplicateOf = seen.get(`${mapNumber}@${startMinutes}`);
    if (duplicateOf) {
      errors.push({
        row: sheetRow,
        message: `Duplicate of row ${duplicateOf} (${mapNumber} at ${timeLabel(startMinutes)})`,
      });
      continue;
    }
    seen.set(`${mapNumber}@${startMinutes}`, sheetRow);

    rows.push({
      row: sheetRow,
      mapNumber,
      client,
      storeNumber,
      startMinutes,
      timeLabel: timeLabel(startMinutes),
      mapperName: at(idx.mapper) || null,
      isNewStore: parseBoolCell(at(idx.isNew)),
      fieldWorkStatus: parseSessionStatus(at(idx.status)),
      meetLink: at(idx.meetLink) || null,
    });
  }

  return { rows, errors };
}

/** Dry run — row counts and what would be created vs updated. No DB writes. */
export async function previewHubSessionCsv(
  csvText: string,
  sessionDateRaw?: string
): Promise<HubSessionPreview> {
  const sessionDate = parseSessionDate(sessionDateRaw);
  const { rows, errors } = parseHubSessionCsv(csvText);

  const existing = await prisma.map.findMany({
    where: { mapNumber: { in: rows.map((r) => r.mapNumber) } },
    select: { mapNumber: true },
  });
  const existingNumbers = new Set(existing.map((m) => m.mapNumber));

  return {
    sessionDate: toIsoDate(sessionDate),
    totalRows: rows.length,
    active: rows.filter((r) => r.fieldWorkStatus === FieldWorkStatus.UNCOMPLETED).length,
    cancelled: rows.filter((r) => r.fieldWorkStatus === FieldWorkStatus.CANCELLED).length,
    newStores: rows.filter((r) => r.isNewStore).length,
    withMeetLink: rows.filter((r) => r.meetLink).length,
    existingMaps: rows.filter((r) => existingNumbers.has(r.mapNumber)).length,
    newMaps: rows.filter((r) => !existingNumbers.has(r.mapNumber)).length,
    errors,
    samples: rows.slice(0, 8),
  };
}

/**
 * Load a day's mapping sessions onto the Hub.
 * Existing maps keep their assignment/progress and only get session details;
 * missing maps are created straight into FIELD so Intake can distribute them.
 */
export async function importHubSessionCsv(
  csvText: string,
  user: AuthUser,
  opts: { sessionDate?: string; replaceDay?: boolean } = {}
): Promise<HubSessionImportResult> {
  const sessionDate = parseSessionDate(opts.sessionDate);
  const { rows, errors } = parseHubSessionCsv(csvText);

  const dayEnd = new Date(sessionDate);
  dayEnd.setHours(23, 59, 59, 999);

  if (opts.replaceDay) {
    await prisma.map.updateMany({
      where: {
        hubSessionAt: { gte: sessionDate, lte: dayEnd },
        mapNumber: { notIn: rows.map((r) => r.mapNumber) },
      },
      data: { hubSessionAt: null },
    });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const sampleMapNumbers: string[] = [];

  for (const row of rows) {
    try {
      const fieldDate = sessionDateTime(sessionDate, row.startMinutes);
      const existing = await prisma.map.findUnique({
        where: { mapNumber: row.mapNumber },
        select: { id: true, fieldWorkStatus: true },
      });

      const sessionFields = {
        client: row.client,
        fieldDate,
        mappingAt: fieldDate,
        mapperName: row.mapperName,
        meetLink: row.meetLink,
        isNewStore: row.isNewStore,
        hubSessionAt: sessionDate,
      };

      if (existing) {
        // Don't reopen work a supervisor already closed out today.
        const keepStatus =
          existing.fieldWorkStatus === FieldWorkStatus.COMPLETED &&
          row.fieldWorkStatus === FieldWorkStatus.UNCOMPLETED;

        await prisma.map.update({
          where: { id: existing.id },
          data: {
            ...sessionFields,
            phase: MapPhase.FIELD,
            uploadApproved: true,
            uploadCompletedAt: new Date(),
            ...(keepStatus ? {} : { fieldWorkStatus: row.fieldWorkStatus }),
            ...(row.fieldWorkStatus === FieldWorkStatus.CANCELLED
              ? { onHubStatusBoard: true }
              : {}),
          },
        });
        await prisma.mapEvent.create({
          data: {
            mapId: existing.id,
            userId: user.id,
            action: "hub_csv_updated",
            note: `Hub session ${toIsoDate(sessionDate)} ${row.timeLabel}${
              row.mapperName ? ` · ${row.mapperName}` : ""
            }`,
          },
        });
        updated++;
      } else {
        const map = await prisma.map.create({
          data: {
            ...sessionFields,
            mapNumber: row.mapNumber,
            building: row.storeNumber,
            phase: MapPhase.FIELD,
            task: MapTask.UPLOADED,
            station: MapStation.OPS,
            uploadApproved: true,
            uploadCompletedAt: new Date(),
            releasedToGraphics: true,
            fieldWorkStatus: row.fieldWorkStatus,
            onHubStatusBoard: row.fieldWorkStatus === FieldWorkStatus.CANCELLED,
          },
        });
        await prisma.mapEvent.create({
          data: {
            mapId: map.id,
            userId: user.id,
            action: "hub_csv_created",
            note: `Hub session ${toIsoDate(sessionDate)} ${row.timeLabel}${
              row.mapperName ? ` · ${row.mapperName}` : ""
            }`,
          },
        });
        created++;
        if (sampleMapNumbers.length < 8) sampleMapNumbers.push(row.mapNumber);
      }
    } catch (e) {
      errors.push({ row: row.row, message: (e as Error).message });
      skipped++;
    }
  }

  return {
    sessionDate: toIsoDate(sessionDate),
    created,
    updated,
    skipped,
    errors,
    sampleMapNumbers,
  };
}
