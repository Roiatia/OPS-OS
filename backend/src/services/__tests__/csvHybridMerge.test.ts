import { describe, expect, it } from "vitest";
import { MapTask } from "@prisma/client";
import {
  buildHybridUpdate,
  mergePolishForward,
  mergeTaskForward,
  isMapReceivedValue,
  type HybridCsvRow,
} from "../csvHybridMerge.js";

function baseExisting(over: Partial<Parameters<typeof buildHybridUpdate>[0]> = {}) {
  return {
    id: "m1",
    mapNumber: "SC-100",
    client: "Sam's Club",
    area: "Addr",
    description: null,
    task: MapTask.UPLOADED,
    batch: "1",
    building: "100",
    address: "Addr",
    mapReceived: "v",
    setupStage: null,
    mapperSource: null,
    mapperName: "Alex",
    scheduleDate: null,
    scheduleAt: new Date(2026, 5, 10),
    mappingDate: null,
    mappingAt: new Date(2026, 5, 12),
    postMappingDate: null,
    sentToStudio: null,
    sentToStudioAt: null,
    receivedFromStudio: null,
    receivedFromStudioAt: null,
    graphicsUploadAssignee: null,
    uploadQaAssignee: null,
    graphicsPolishAssignee: null,
    graphicsPolishStatus: null,
    polishQaAssignee: null,
    conversion: null,
    polishStage: "Done",
    activation: null,
    activationAt: null,
    remappingDate: null,
    dashboardDate: null,
    maintDate: null,
    commentExternal: null,
    commentInternal: null,
    uploadCompletedAt: new Date(),
    ...over,
  };
}

function baseCsv(over: Partial<HybridCsvRow> = {}): HybridCsvRow {
  return {
    client: "Sam's Club",
    area: "Addr",
    description: null,
    task: MapTask.UPLOAD,
    batch: "1",
    building: "100",
    address: "Addr",
    mapReceived: "",
    setupStage: null,
    mapperSource: null,
    mapperName: "Alex",
    scheduleDate: "10 Jun 2026",
    scheduleAt: new Date(2026, 5, 10),
    mappingDate: "12 Jun 2026",
    mappingAt: new Date(2026, 5, 12),
    postMappingDate: null,
    sentToStudio: null,
    sentToStudioAt: null,
    receivedFromStudio: null,
    receivedFromStudioAt: null,
    graphicsUploadAssignee: null,
    uploadQaAssignee: null,
    graphicsPolishAssignee: null,
    graphicsPolishStatus: null,
    polishQaAssignee: null,
    conversion: null,
    polishStage: "",
    activation: null,
    activationAt: null,
    remappingDate: null,
    dashboardDate: null,
    maintDate: null,
    commentExternal: null,
    commentInternal: null,
    ...over,
  };
}

describe("mergeTaskForward", () => {
  it("never un-uploads", () => {
    expect(mergeTaskForward(MapTask.UPLOADED, MapTask.UPLOAD)).toBe(MapTask.UPLOADED);
  });
  it("can move upload → uploaded", () => {
    expect(mergeTaskForward(MapTask.UPLOAD, MapTask.UPLOADED)).toBe(MapTask.UPLOADED);
  });
});

describe("mergePolishForward", () => {
  it("never undoes Done", () => {
    expect(mergePolishForward("Done", "")).toBeUndefined();
    expect(mergePolishForward("Done", "In progress")).toBeUndefined();
  });
  it("forwards to Done", () => {
    expect(mergePolishForward("WIP", "Done")).toBe("Done");
  });
  it("fills empty", () => {
    expect(mergePolishForward("", "WIP")).toBe("WIP");
  });
});

describe("isMapReceivedValue", () => {
  it("recognizes v", () => {
    expect(isMapReceivedValue("v")).toBe(true);
    expect(isMapReceivedValue("")).toBe(false);
  });
});

describe("buildHybridUpdate", () => {
  it("does not overwrite filled mapper; fills empty mapper", () => {
    const keep = buildHybridUpdate(baseExisting(), baseCsv({ mapperName: "Other" }));
    expect(keep.updateData.mapperName).toBeUndefined();

    const fill = buildHybridUpdate(
      baseExisting({ mapperName: null }),
      baseCsv({ mapperName: "Other" })
    );
    expect(fill.updateData.mapperName).toBe("Other");
  });

  it("map received only moves forward to v", () => {
    const keep = buildHybridUpdate(baseExisting({ mapReceived: "v" }), baseCsv({ mapReceived: "" }));
    expect(keep.updateData.mapReceived).toBeUndefined();

    const forward = buildHybridUpdate(
      baseExisting({ mapReceived: null }),
      baseCsv({ mapReceived: "v" })
    );
    expect(forward.updateData.mapReceived).toBe("v");
  });

  it("does not change task backward", () => {
    const r = buildHybridUpdate(baseExisting({ task: MapTask.UPLOADED }), baseCsv({ task: MapTask.UPLOAD }));
    expect(r.updateData.task).toBeUndefined();
  });

  it("emits date conflict when both set and differ", () => {
    const r = buildHybridUpdate(
      baseExisting({ activationAt: new Date(2026, 6, 1) }),
      baseCsv({ activationAt: new Date(2026, 6, 15), activation: "15 Jul 2026" })
    );
    expect(r.conflicts.some((c) => c.field === "activationAt")).toBe(true);
    expect(r.updateData.activationAt).toBeUndefined();
  });

  it("fills empty activation and sets dueDate", () => {
    const act = new Date(2026, 6, 15);
    const r = buildHybridUpdate(
      baseExisting({ activationAt: null }),
      baseCsv({ activationAt: act, activation: "15 Jul 2026" })
    );
    expect(r.updateData.activationAt).toEqual(act);
    expect(r.updateData.dueDate).toEqual(act);
    expect(r.conflicts).toHaveLength(0);
  });

  it("emits batch conflict when values differ", () => {
    const r = buildHybridUpdate(baseExisting({ batch: "1" }), baseCsv({ batch: "cancelled" }));
    expect(r.conflicts).toEqual([
      expect.objectContaining({
        field: "batch",
        systemValue: "1",
        csvValue: "cancelled",
      }),
    ]);
  });

  it("auto-fills empty mapping and sets fieldDate", () => {
    const mapping = new Date(2026, 5, 20);
    const r = buildHybridUpdate(
      baseExisting({ mappingAt: null }),
      baseCsv({ mappingAt: mapping, mappingDate: "20 Jun 2026" })
    );
    expect(r.updateData.mappingAt).toEqual(mapping);
    expect(r.updateData.fieldDate).toEqual(mapping);
  });
});
