/**
 * Spreadsheet → existing Map fields only (no new DB columns).
 *
 * Building      → mapNumber
 * Retailer      → client
 * Address         → area (+ description for full line)
 * Schedule/Mapping → fieldDate
 * Activation      → dueDate
 * Mapper          → mapperName
 * comments        → opsManagerComment
 * Jira in notes   → jiraTicketId
 * LIVE / done     → phase APPROVED (History)
 * Schedule=today  → phase FIELD (Hub)
 */

import { parse } from "csv-parse/sync";
import {
  FieldWorkStatus,
  MapPhase,
  Prisma,
  SupervisorStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";
import { isActivationDatePast, isPolishStageDone } from "../domain/pipeline.js";
import { broadcastMapsInvalidate, withSuppressedBroadcasts } from "../lib/realtimeBus.js";

export type SpreadsheetSyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  history: number;
  todayHub: number;
  errors: string[];
};

type SheetRow = Record<string, string>;

const DEFAULT_CLIENT = process.env.SPREADSHEET_DEFAULT_CLIENT ?? "Sam's Club";

function normalizeHeader(h: string): string {
  return String(h ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cell(row: SheetRow, ...needles: string[]): string {
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(n));
    if (key && row[key]?.trim()) return row[key].trim();
  }
  return "";
}

function parseSheetDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s || /^queued\b/i.test(s)) return null;

  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime()) && direct.getFullYear() > 1990) return direct;

  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(`${m[2]} ${m[1]}, ${year}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isFinishedRow(row: SheetRow): boolean {
  if (cell(row, "batch").toLowerCase().includes("cancel")) return true;
  const live = cell(row, "live");
  if (live && !/^queued\b/i.test(live)) return true;
  if (parseSheetDate(cell(row, "activation"))) return true;
  const polish = cell(row, "polish").toLowerCase();
  if (polish === "done" && (live || cell(row, "activation"))) return true;
  return false;
}

function isScheduledToday(row: SheetRow): boolean {
  const d = parseSheetDate(cell(row, "schedule")) ?? parseSheetDate(cell(row, "mapping"));
  return d ? isSameDay(d, todayStart()) : false;
}

function mapNumberFor(building: string, client: string): string {
  const prefix = client.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase() || "MAP";
  return `${prefix}-${building}`;
}

function phaseForRow(row: SheetRow): MapPhase {
  if (cell(row, "batch").toLowerCase().includes("cancel")) return MapPhase.CANCELLED;
  if (isFinishedRow(row)) return MapPhase.APPROVED;

  const activation = parseSheetDate(cell(row, "activation"));
  const polishRaw = cell(row, "polish");

  // Polish Done + no activation → Polish. Past activation + polish Done → Polish
  // (board Pipeline shows Activation when activation date has passed).
  if (isPolishStageDone(polishRaw) && !activation) return MapPhase.POLISH;
  if (isPolishStageDone(polishRaw) && activation && isActivationDatePast(activation)) {
    return MapPhase.POLISH;
  }
  if (isPolishStageDone(polishRaw) && activation && !isActivationDatePast(activation)) {
    return MapPhase.POLISH;
  }
  if (polishRaw.toLowerCase() === "wip") return MapPhase.POLISH;

  if (isScheduledToday(row)) return MapPhase.FIELD;

  if (parseSheetDate(cell(row, "mapping"))) return MapPhase.FIELD;

  const received = cell(row, "map received").toLowerCase();
  if (received === "v" || received === "✓" || received === "yes") return MapPhase.PREP;

  return MapPhase.INTAKE;
}

function buildingFromRow(row: SheetRow): string | null {
  const raw = cell(row, "building").replace(/,/g, "").trim();
  if (!raw || /cancel/i.test(raw)) return null;
  if (!/^\d+$/.test(raw)) return null;
  return raw;
}

function extractJira(note: string): string | null {
  const m = note.match(/OPS-\d+/i) ?? note.match(/jira\s+ticket\s+(\d+)/i);
  if (!m) return null;
  return m[0].toUpperCase().startsWith("OPS") ? m[0].toUpperCase() : `OPS-${m[1]}`;
}

/** Google Sheets CSV often has summary rows before the real header */
export function parseCsvToRows(csv: string): SheetRow[] {
  const matrix = parse(csv, {
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];

  let headerIdx = matrix.findIndex((row) =>
    row.some((c) => String(c).toLowerCase().includes("building"))
  );
  if (headerIdx < 0) headerIdx = 0;

  const headers = (matrix[headerIdx] ?? []).map(normalizeHeader);
  const rows: SheetRow[] = [];

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const row: SheetRow = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = String(line[idx] ?? "").trim();
    });
    if (buildingFromRow(row)) rows.push(row);
  }

  return rows;
}

export async function fetchGoogleSheetRows(tabName?: string): Promise<SheetRow[]> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const rawCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!spreadsheetId || !rawCreds) {
    throw new Error(
      "Google Sheets not set up — use Upload CSV (File → Download → CSV in Google Sheets)."
    );
  }

  const { google } = await import("googleapis");
  const credentials = JSON.parse(rawCreds) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const tab = tabName ?? process.env.GOOGLE_SHEETS_TAB_NAME ?? "Sheet1";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'`,
  });

  const values = res.data.values ?? [];
  const csv = values.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  return parseCsvToRows(csv);
}

function rowToMapPayload(row: SheetRow): {
  mapNumber: string;
  data: Prisma.MapCreateInput;
  scheduledToday: boolean;
} | null {
  const building = buildingFromRow(row);
  if (!building) return null;

  const client = cell(row, "retailer", "client") || DEFAULT_CLIENT;
  const mapNumber = mapNumberFor(building, client);
  const fullAddress = cell(row, "address");
  const schedule = parseSheetDate(cell(row, "schedule"));
  const mapping = parseSheetDate(cell(row, "mapping"));
  const activation = parseSheetDate(cell(row, "activation"));
  const fieldDate = schedule ?? mapping;
  const internalNote = cell(row, "comments [internal]", "internal");
  const externalNote = cell(row, "comments [external]", "external");
  const note = [internalNote, externalNote].filter(Boolean).join("\n") || null;
  const phase = phaseForRow(row);
  const scheduledToday = isScheduledToday(row);
  const hubReady =
    phase === MapPhase.FIELD && (scheduledToday || Boolean(mapping));

  const polishStatus = cell(row, "graphics polish status", "polish status");
  const storeStatus = cell(row, "store status");

  const descriptionParts = [fullAddress ? `Address: ${fullAddress}` : ""];
  if (polishStatus) descriptionParts.push(`Polish: ${polishStatus}`);
  if (storeStatus) descriptionParts.push(`Status: ${storeStatus}`);
  if (cell(row, "activation")) descriptionParts.push(`Activation: ${cell(row, "activation")}`);
  if (cell(row, "live")) descriptionParts.push(`LIVE: ${cell(row, "live")}`);

  const data: Prisma.MapCreateInput = {
    mapNumber,
    client,
    area: fullAddress || null,
    description: descriptionParts.filter(Boolean).join(" · ") || null,
    fieldDate: fieldDate ?? null,
    dueDate: activation ?? null,
    mapperName: cell(row, "mapper", "field team") || null,
    opsManagerComment: note,
    jiraTicketId: extractJira(note ?? "") ?? extractJira(externalNote),
    phase,
    releasedToGraphics: phase !== MapPhase.INTAKE,
    uploadApproved: hubReady || phase === MapPhase.POLISH || phase === MapPhase.APPROVED,
    uploadCompletedAt:
      hubReady || phase === MapPhase.POLISH || phase === MapPhase.APPROVED ? new Date() : null,
    fieldWorkStatus:
      phase === MapPhase.CANCELLED
        ? FieldWorkStatus.CANCELLED
        : phase === MapPhase.APPROVED
          ? FieldWorkStatus.COMPLETED
          : FieldWorkStatus.UNCOMPLETED,
    supervisorStatus: phase === MapPhase.APPROVED ? SupervisorStatus.DONE : null,
    onHubStatusBoard: false,
  };

  return { mapNumber, data, scheduledToday };
}

export async function syncMapsFromSpreadsheet(
  user: AuthUser,
  options: { csv?: string; sheetTab?: string } = {}
): Promise<SpreadsheetSyncResult> {
  const rows = options.csv
    ? parseCsvToRows(options.csv)
    : await fetchGoogleSheetRows(options.sheetTab);

  if (rows.length === 0) {
    throw new Error(
      'No rows found — CSV needs a "Building" column with store numbers (e.g. 4969).'
    );
  }

  const result: SpreadsheetSyncResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    history: 0,
    todayHub: 0,
    errors: [],
  };

  const eventRows: { mapId: string; userId: string; action: string; note: string }[] = [];

  // Suppress per-row realtime reshape queries — they flood the DB pool on large
  // sheets and leave the UI stuck on "Loading…" while maps are already saved.
  await withSuppressedBroadcasts(async () => {
    for (const row of rows) {
      try {
        const parsed = rowToMapPayload(row);
        if (!parsed) {
          result.skipped++;
          continue;
        }

        const { mapNumber, data, scheduledToday } = parsed;
        const phase = data.phase as MapPhase;

        if (phase === MapPhase.APPROVED || phase === MapPhase.CANCELLED) result.history++;
        if (scheduledToday && phase === MapPhase.FIELD) result.todayHub++;

        const existing = await prisma.map.findUnique({ where: { mapNumber } });

        if (existing) {
          const { mapNumber: _mn, ...updateData } = data;
          await prisma.map.update({
            where: { id: existing.id },
            data: updateData as Prisma.MapUpdateInput,
          });
          eventRows.push({
            mapId: existing.id,
            userId: user.id,
            action: "spreadsheet_sync",
            note: `Spreadsheet sync → ${phase}`,
          });
          result.updated++;
        } else {
          const created = await prisma.map.create({ data });
          eventRows.push({
            mapId: created.id,
            userId: user.id,
            action: "spreadsheet_sync",
            note: `Spreadsheet import → ${phase}`,
          });
          result.imported++;
        }
      } catch (err) {
        result.errors.push(`${cell(row, "building") || "?"}: ${(err as Error).message}`);
      }
    }

    // Batch audit events (skip per-row awaits that doubled sync time).
    const EVENT_CHUNK = 200;
    for (let i = 0; i < eventRows.length; i += EVENT_CHUNK) {
      await prisma.mapEvent.createMany({ data: eventRows.slice(i, i + EVENT_CHUNK) });
    }
  });

  broadcastMapsInvalidate();
  return result;
}
