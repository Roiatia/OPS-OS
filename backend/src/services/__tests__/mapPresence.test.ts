import { describe, expect, it } from "vitest";
import { diffMissingMapNumbers, toMapNumber } from "../mapPresence.js";

describe("toMapNumber", () => {
  it("normalizes building digits and SC prefixes", () => {
    expect(toMapNumber(4041)).toBe("SC-4041");
    expect(toMapNumber("4041")).toBe("SC-4041");
    expect(toMapNumber("SC-4041")).toBe("SC-4041");
    expect(toMapNumber("SC 4754")).toBe("SC-4754");
    expect(toMapNumber("sc4041")).toBe("SC-4041");
  });

  it("rejects empty / non-numeric", () => {
    expect(toMapNumber("")).toBeNull();
    expect(toMapNumber("   ")).toBeNull();
    expect(toMapNumber("abc")).toBeNull();
  });
});

describe("diffMissingMapNumbers", () => {
  it("reports numbers not present in the existing set", () => {
    const { checked, missing } = diffMissingMapNumbers(
      ["SC-4041", "SC-4754", "SC-4041", "SC-8191"],
      ["SC-8191", "SC-4041"]
    );
    expect(checked).toEqual(["SC-4041", "SC-4754", "SC-8191"]);
    expect(missing).toEqual(["SC-4754"]);
  });

  it("returns empty missing when all present", () => {
    const { missing } = diffMissingMapNumbers(["SC-1", "SC-2"], ["SC-2", "SC-1"]);
    expect(missing).toEqual([]);
  });
});
