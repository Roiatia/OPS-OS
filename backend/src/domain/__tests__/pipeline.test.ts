import { describe, it, expect } from "vitest";
import { MapPhase } from "@prisma/client";
import {
  getPipelineStage,
  isUploadStageComplete,
  assertUploadCompleteForMapping,
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
