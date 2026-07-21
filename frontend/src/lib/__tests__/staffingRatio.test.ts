import { describe, expect, it } from "vitest";
import {
  countRequiredMaps,
  preferredStaffForMaps,
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
});
