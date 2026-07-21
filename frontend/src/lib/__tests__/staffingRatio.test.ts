import { describe, expect, it } from "vitest";
import {
  countDayNightMaps,
  countRequiredMaps,
  preferredStaffForMaps,
  shiftContinuityHint,
  staffingForMaps,
} from "../staffingRatio";

describe("staffingForMaps", () => {
  it("6 maps → target 4 (room for SL + supervisors)", () => {
    const s = staffingForMaps(6, 12);
    expect(preferredStaffForMaps(6)).toBe(4);
    expect(s.target).toBe(4);
  });

  it("meetings do not count as required maps", () => {
    expect(
      countRequiredMaps([
        { taskKind: "MAP" },
        { taskKind: "MAP" },
        { taskKind: "COMPANY_MEETING" },
      ])
    ).toBe(2);
  });

  it("splits day vs night maps and continuity hint", () => {
    const maps = [
      { taskKind: "MAP" as const, startMinutes: 9 * 60 },
      { taskKind: "MAP" as const, startMinutes: 14 * 60 },
      { taskKind: "MAP" as const, startMinutes: 22 * 60 },
      { taskKind: "COMPANY_MEETING" as const, startMinutes: 12 * 60 },
    ];
    expect(countDayNightMaps(maps)).toEqual({ dayMaps: 2, nightMaps: 1, required: 3 });
    const hint = shiftContinuityHint(maps, 4);
    expect(hint).toContain("2 day + 1 night");
    expect(hint).toContain("22:00");
    expect(hint).toContain("next morning has 4");
  });
});
