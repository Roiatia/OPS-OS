import { describe, it, expect } from "vitest";
import {
  getPipelineStage,
  isActivationDatePast,
  isPolishStageDone,
} from "../pipeline";
import { makeMap } from "./fixtures";

describe("spreadsheet pipeline overrides", () => {
  it("Polish Done with no activation → Polish", () => {
    const map = makeMap({
      phase: "FIELD",
      polishStage: "Done",
      activationAt: null,
    });
    expect(getPipelineStage(map)).toBe("POLISH");
  });

  it("past activation date → Activation even if phase is Polish", () => {
    const map = makeMap({
      phase: "POLISH",
      polishStage: "Done",
      activationAt: "2020-01-15T00:00:00.000Z",
    });
    expect(getPipelineStage(map)).toBe("ACTIVATION");
  });

  it("future activation with Polish Done → Polish (from phase)", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const map = makeMap({
      phase: "POLISH",
      polishStage: "Done",
      activationAt: future.toISOString(),
    });
    expect(isActivationDatePast(map.activationAt)).toBe(false);
    expect(getPipelineStage(map)).toBe("POLISH");
  });

  it("helpers", () => {
    expect(isPolishStageDone("Done")).toBe(true);
    expect(isPolishStageDone("WIP")).toBe(false);
  });
});
