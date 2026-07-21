/**
 * Staffing for real maps only (~2 maps per supervisor, allow +1).
 *
 * Examples:
 * - 6 maps → target 3, max 4
 * - 8 maps → target 4, max 5
 * Meetings / happy hour do not count toward headcount.
 */
export const MAPS_PER_PERSON = 2;

export type StaffingTarget = {
  mapsCount: number;
  min: number;
  max: number;
  target: number;
  preferred: number;
};

export function isRequiredMapTask(taskKind?: string | null): boolean {
  // Meetings may stay empty; real maps (and mapping refresh) need ≥1 supervisor
  if (taskKind === "HAPPY_HOUR" || taskKind === "COMPANY_MEETING") return false;
  return true;
}

export function countRequiredMaps(
  maps: { taskKind?: string | null }[]
): number {
  return maps.filter((m) => isRequiredMapTask(m.taskKind)).length;
}

export function preferredStaffForMaps(mapsCount: number): number {
  if (mapsCount <= 0) return 0;
  if (mapsCount === 1) return 1;
  // ~2 maps/person
  const base = Math.max(2, Math.ceil(mapsCount / MAPS_PER_PERSON));
  // Busy days: +1 seat so roster = open SL + supervisors (+ close SL), not only SLs
  if (mapsCount >= 4) return base + 1; // 6 maps → 4 people
  return base;
}

export function staffingForMaps(
  mapsCount: number,
  availableCanWork: number
): StaffingTarget {
  if (mapsCount <= 0) {
    return { mapsCount: 0, min: 0, max: 0, target: 0, preferred: 0 };
  }

  const preferred = preferredStaffForMaps(mapsCount);
  // Allow one extra seat (6 maps → 3–4), never balloon beyond that
  const max = mapsCount === 1 ? 1 : preferred + 1;
  const min = mapsCount === 1 ? 1 : Math.max(2, preferred - 1);

  if (availableCanWork <= 0) {
    return { mapsCount, min, max, target: min, preferred };
  }

  // Aim for preferred (e.g. 3 for 6 maps), not the max
  let target = Math.min(preferred, availableCanWork, max);
  target = Math.max(Math.min(min, availableCanWork), target);

  return { mapsCount, min, max, target, preferred };
}

export function staffingRatioHint(mapsCount: number): string {
  if (mapsCount <= 0) return "No maps";
  if (mapsCount === 1) return "1 SL";
  const n = preferredStaffForMaps(mapsCount);
  return `~${n}–${n + 1} people (~2 maps each) · need 1 SL`;
}
