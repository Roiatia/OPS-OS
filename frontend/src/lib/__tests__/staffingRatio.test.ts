import { describe, expect, it } from "vitest";
import {
  countDayNightMaps,
  countRequiredMaps,
  preferredStaffForMaps,
  staffingForMaps,
} from "../staffingRatio";
import {
  effectiveSupervisorRating,
  maxMapsForRating,
} from "../availabilityRules";

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

  it("splits day vs night maps", () => {
    const maps = [
      { taskKind: "MAP" as const, startMinutes: 9 * 60 },
      { taskKind: "MAP" as const, startMinutes: 14 * 60 },
      { taskKind: "MAP" as const, startMinutes: 22 * 60 },
      { taskKind: "COMPANY_MEETING" as const, startMinutes: 12 * 60 },
    ];
    expect(countDayNightMaps(maps)).toEqual({ dayMaps: 2, nightMaps: 1, required: 3 });
  });
});

describe("maxMapsForRating (1–9 scale)", () => {
  it("floors at 5 even for rating 1–4", () => {
    expect(maxMapsForRating(1)).toBe(5);
    expect(maxMapsForRating(4)).toBe(5);
  });

  it("rating equals soft map capacity from 5–9", () => {
    expect(maxMapsForRating(5)).toBe(5);
    expect(maxMapsForRating(7)).toBe(7);
    expect(maxMapsForRating(9)).toBe(9);
  });

  it("null defaults to 5; never above 9", () => {
    expect(maxMapsForRating(null)).toBe(5);
    expect(maxMapsForRating(99)).toBe(9);
  });

  it("SLs are always effective rating 9", () => {
    expect(effectiveSupervisorRating(5, true)).toBe(9);
    expect(effectiveSupervisorRating(null, true)).toBe(9);
    expect(effectiveSupervisorRating(7, false)).toBe(7);
  });
});
