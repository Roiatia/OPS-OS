import { describe, it, expect } from "vitest";
import { MapPhase } from "@prisma/client";
import {
  getPipelineStage,
  getPipelineStageForMap,
  isUploadStageComplete,
  assertUploadCompleteForMapping,
  isPolishStageDone,
  isActivationDatePast,
  applyPolishActivationPhase,
} from "../pipeline.js";

describe("getPipelineStage", () => {
  it("groups map phases into business pipeline stages", () => {
    expect(getPipelineStage(MapPhase.INTAKE)).toBe("UPLOAD");
    expect(getPipelineStage(MapPhase.PREP)).toBe("UPLOAD");
    expect(getPipelineStage(MapPhase.UPLOAD_REVIEW)).toBe("UPLOAD");
    expect(getPipelineStage(MapPhase.FIELD)).toBe("MAPPING");
    expect(getPipelineStage(MapPhase.POLISH)).toBe("POLISH");
    expect(getPipelineStage(MapPhase.QA_REVIEW)).toBe("POLISH");
    expect(getPipelineStage(MapPhase.APPROVED)).toBe("ACTIVATION");
  });
});

describe("isUploadStageComplete", () => {
  it("requires both approval and a completion timestamp", () => {
    expect(isUploadStageComplete({ uploadApproved: true, uploadCompletedAt: new Date() })).toBe(
      true
    );
    expect(isUploadStageComplete({ uploadApproved: true, uploadCompletedAt: null })).toBe(false);
    expect(isUploadStageComplete({ uploadApproved: false, uploadCompletedAt: new Date() })).toBe(
      false
    );
  });
});

describe("assertUploadCompleteForMapping", () => {
  it("no-ops for non-field phases", () => {
    expect(() =>
      assertUploadCompleteForMapping({
        phase: MapPhase.PREP,
        uploadApproved: false,
        uploadCompletedAt: null,
      })
    ).not.toThrow();
  });

  it("passes when a field map has a completed upload", () => {
    expect(() =>
      assertUploadCompleteForMapping({
        phase: MapPhase.FIELD,
        uploadApproved: true,
        uploadCompletedAt: new Date(),
      })
    ).not.toThrow();
  });

  it("throws when a field map has not completed the upload stage", () => {
    expect(() =>
      assertUploadCompleteForMapping({
        phase: MapPhase.FIELD,
        uploadApproved: false,
        uploadCompletedAt: null,
        mapNumber: "MAP-9",
      })
    ).toThrow(/MAP-9/);
  });
});

describe("polish / activation pipeline rules", () => {
  it("detects Polish Done", () => {
    expect(isPolishStageDone("Done")).toBe(true);
    expect(isPolishStageDone("done")).toBe(true);
    expect(isPolishStageDone("WIP")).toBe(false);
    expect(isPolishStageDone(null)).toBe(false);
  });

  it("treats today and earlier as past activation", () => {
    const today = new Date("2026-07-22T12:00:00");
    expect(isActivationDatePast(new Date("2026-07-22T00:00:00"), today)).toBe(true);
    expect(isActivationDatePast(new Date("2026-07-21T00:00:00"), today)).toBe(true);
    expect(isActivationDatePast(new Date("2026-07-23T00:00:00"), today)).toBe(false);
    expect(isActivationDatePast(null, today)).toBe(false);
  });

  it("applyPolishActivationPhase: Done + no activation → POLISH", () => {
    expect(
      applyPolishActivationPhase(MapPhase.FIELD, {
        polishStage: "Done",
        activationAt: null,
      })
    ).toBe(MapPhase.POLISH);
  });

  it("applyPolishActivationPhase: past activation + Done → POLISH (stays on board)", () => {
    const today = new Date("2026-07-22T12:00:00");
    // isActivationDatePast uses Date.now by default — pass an old date
    expect(
      applyPolishActivationPhase(MapPhase.FIELD, {
        polishStage: "Done",
        activationAt: new Date("2026-01-01"),
      })
    ).toBe(MapPhase.POLISH);
  });

  it("getPipelineStageForMap: past activation → ACTIVATION", () => {
    expect(
      getPipelineStageForMap({
        phase: MapPhase.POLISH,
        polishStage: "Done",
        activationAt: new Date("2020-01-01"),
      })
    ).toBe("ACTIVATION");
  });

  it("getPipelineStageForMap: Done + no activation → POLISH", () => {
    expect(
      getPipelineStageForMap({
        phase: MapPhase.FIELD,
        polishStage: "Done",
        activationAt: null,
      })
    ).toBe("POLISH");
  });
});
