import { prisma } from "../lib/prisma.js";

export type MapPresenceHit = {
  mapNumber: string;
  building: string | null;
  phase: string;
  batch: string | null;
};

export type MapPresenceCheckResult = {
  /** Unique map numbers derived from the input list */
  checked: string[];
  found: MapPresenceHit[];
  /** Map numbers from the list that do not exist in the DB */
  missing: string[];
  invalidInputs: string[];
};

/**
 * Normalize a building / map id to `SC-{digits}`.
 * Accepts `4041`, `"4041"`, `"SC-4041"`, `"SC 4041"`, `"sc4041"`.
 */
export function toMapNumber(input: string | number): string | null {
  const raw = String(input).trim();
  if (!raw) return null;

  const digits = raw.replace(/^sc[-\s]?/i, "").replace(/\D/g, "");
  if (!digits) return null;
  return `SC-${digits}`;
}

/** Pure diff: which requested map numbers are absent from `existing`. */
export function diffMissingMapNumbers(
  requested: string[],
  existing: Iterable<string>
): { checked: string[]; missing: string[] } {
  const checked = [...new Set(requested)];
  const have = new Set(existing);
  const missing = checked.filter((n) => !have.has(n));
  return { checked, missing };
}

/**
 * Check whether each building/map number exists in the database.
 * Pass CSV Building values (e.g. 4041, 4754) or full map numbers (SC-4041).
 */
export async function checkMapsInDatabase(
  inputs: Array<string | number>
): Promise<MapPresenceCheckResult> {
  const invalidInputs: string[] = [];
  const mapNumbers: string[] = [];

  for (const input of inputs) {
    const mapNumber = toMapNumber(input);
    if (!mapNumber) {
      invalidInputs.push(String(input));
      continue;
    }
    mapNumbers.push(mapNumber);
  }

  const checked = [...new Set(mapNumbers)];
  if (checked.length === 0) {
    return { checked: [], found: [], missing: [], invalidInputs };
  }

  const rows = await prisma.map.findMany({
    where: { mapNumber: { in: checked } },
    select: {
      mapNumber: true,
      building: true,
      phase: true,
      batch: true,
    },
  });

  const found: MapPresenceHit[] = rows.map((r) => ({
    mapNumber: r.mapNumber,
    building: r.building,
    phase: r.phase,
    batch: r.batch,
  }));

  const { missing } = diffMissingMapNumbers(
    checked,
    found.map((f) => f.mapNumber)
  );

  return { checked, found, missing, invalidInputs };
}
