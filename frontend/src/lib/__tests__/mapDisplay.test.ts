import { describe, it, expect } from "vitest";
import {
  getMapDisplayState,
  matchesQueue,
  canAssignInspector,
  canAssignQa,
  needsInspectorAssignment,
  needsQaAssignment,
  workflowStateTone,
  matchesColumnFilters,
  EMPTY_COLUMN_FILTERS,
  isMapReceived,
  getMapReceivedLabel,
  getMapReceivedStatus,
  formatCsvDateCell,
} from "../mapDisplay";
import { makeMap, makePerson } from "./fixtures";

describe("getMapDisplayState", () => {
  it("returns Cancelled for a cancelled map regardless of other fields", () => {
    expect(getMapDisplayState(makeMap({ phase: "CANCELLED", qaStatus: "FIX" }))).toBe(
      "Cancelled"
    );
  });

  it("maps qaStatus FIX / FIX_DONE / APPROVED to their states", () => {
    expect(getMapDisplayState(makeMap({ phase: "POLISH", qaStatus: "FIX" }))).toBe("Fix");
    expect(getMapDisplayState(makeMap({ phase: "QA_REVIEW", qaStatus: "FIX_DONE" }))).toBe(
      "FixDone"
    );
    expect(getMapDisplayState(makeMap({ phase: "QA_REVIEW", qaStatus: "APPROVED" }))).toBe(
      "Approved"
    );
  });

  it("treats phase APPROVED as Approved", () => {
    expect(getMapDisplayState(makeMap({ phase: "APPROVED" }))).toBe("Approved");
  });

  it("returns In QA when inspector is done and awaiting QA in a review phase", () => {
    expect(
      getMapDisplayState(
        makeMap({ phase: "UPLOAD_REVIEW", inspectorStatus: "DONE", qaStatus: null })
      )
    ).toBe("In QA");
    expect(
      getMapDisplayState(
        makeMap({ phase: "QA_REVIEW", inspectorStatus: "DONE", qaStatus: null })
      )
    ).toBe("In QA");
  });

  it("reflects inspector progress states during prep", () => {
    expect(getMapDisplayState(makeMap({ phase: "PREP", inspectorStatus: "ACCEPTED" }))).toBe(
      "Accepted"
    );
    expect(getMapDisplayState(makeMap({ phase: "PREP", inspectorStatus: "PROCESSING" }))).toBe(
      "Processing"
    );
    expect(getMapDisplayState(makeMap({ phase: "PREP", inspectorStatus: "DONE" }))).toBe("Done");
  });

  it("falls back to em dash when nothing is set", () => {
    expect(getMapDisplayState(makeMap({ phase: "INTAKE" }))).toBe("—");
    expect(getMapDisplayState(makeMap({ phase: "FIELD" }))).toBe("—");
  });
});

describe("matchesQueue", () => {
  it("matches every map for the 'all' queue", () => {
    expect(matchesQueue(makeMap({ phase: "APPROVED" }), "all")).toBe(true);
  });

  it("unassigned queue only matches intake maps", () => {
    expect(matchesQueue(makeMap({ phase: "INTAKE" }), "unassigned")).toBe(true);
    expect(matchesQueue(makeMap({ phase: "PREP" }), "unassigned")).toBe(false);
  });

  it("needs_qa queue matches review maps without a QA assigned", () => {
    expect(
      matchesQueue(makeMap({ phase: "UPLOAD_REVIEW", assignedQa: null }), "needs_qa")
    ).toBe(true);
    expect(
      matchesQueue(
        makeMap({ phase: "UPLOAD_REVIEW", assignedQa: makePerson("qa1") }),
        "needs_qa"
      )
    ).toBe(false);
  });

  it("in_progress and in_qa partition the active phases", () => {
    expect(matchesQueue(makeMap({ phase: "PREP" }), "in_progress")).toBe(true);
    expect(matchesQueue(makeMap({ phase: "POLISH" }), "in_progress")).toBe(true);
    expect(matchesQueue(makeMap({ phase: "FIELD" }), "in_progress")).toBe(true);
    expect(matchesQueue(makeMap({ phase: "QA_REVIEW" }), "in_qa")).toBe(true);
    expect(matchesQueue(makeMap({ phase: "UPLOAD_REVIEW" }), "in_qa")).toBe(true);
  });
});

describe("assignment predicates", () => {
  it("canAssignInspector only in intake/prep/polish", () => {
    for (const phase of ["INTAKE", "PREP", "POLISH"] as const) {
      expect(canAssignInspector(makeMap({ phase }))).toBe(true);
    }
    for (const phase of ["UPLOAD_REVIEW", "FIELD", "QA_REVIEW", "APPROVED"] as const) {
      expect(canAssignInspector(makeMap({ phase }))).toBe(false);
    }
  });

  it("canAssignQa for active phases (not approved/cancelled)", () => {
    expect(canAssignQa(makeMap({ phase: "UPLOAD_REVIEW" }))).toBe(true);
    expect(canAssignQa(makeMap({ phase: "QA_REVIEW" }))).toBe(true);
    expect(canAssignQa(makeMap({ phase: "PREP" }))).toBe(true);
    expect(canAssignQa(makeMap({ phase: "POLISH" }))).toBe(true);
    expect(canAssignQa(makeMap({ phase: "APPROVED" }))).toBe(false);
    expect(canAssignQa(makeMap({ phase: "CANCELLED" }))).toBe(false);
  });

  it("needsInspectorAssignment is intake-only", () => {
    expect(needsInspectorAssignment(makeMap({ phase: "INTAKE" }))).toBe(true);
    expect(needsInspectorAssignment(makeMap({ phase: "PREP" }))).toBe(false);
  });

  it("needsQaAssignment when active and no QA", () => {
    expect(needsQaAssignment(makeMap({ phase: "QA_REVIEW", assignedQa: null }))).toBe(true);
    expect(
      needsQaAssignment(makeMap({ phase: "QA_REVIEW", assignedQa: makePerson("qa1") }))
    ).toBe(false);
    expect(needsQaAssignment(makeMap({ phase: "PREP", assignedQa: null }))).toBe(true);
    expect(needsQaAssignment(makeMap({ phase: "POLISH", assignedQa: null }))).toBe(true);
  });
});

describe("workflowStateTone", () => {
  it("maps each display state to a badge tone", () => {
    expect(workflowStateTone("Accepted")).toBe("ACCEPTED");
    expect(workflowStateTone("Processing")).toBe("PROCESSING");
    expect(workflowStateTone("Done")).toBe("DONE");
    expect(workflowStateTone("In QA")).toBe("UPLOAD_REVIEW");
    expect(workflowStateTone("Fix")).toBe("FIX");
    expect(workflowStateTone("FixDone")).toBe("FIX_DONE");
    expect(workflowStateTone("Approved")).toBe("APPROVED");
    expect(workflowStateTone("Cancelled")).toBe("CANCELLED");
    expect(workflowStateTone("—")).toBe("PENDING");
  });
});


describe("formatCsvDateCell", () => {
  it("never shows Done/done placeholders", () => {
    expect(formatCsvDateCell(null, "done")).toBe("—");
    expect(formatCsvDateCell(null, "Done")).toBe("—");
    expect(formatCsvDateCell(null, "DONE")).toBe("—");
    expect(formatCsvDateCell(null, "v")).toBe("—");
  });

  it("prefers typed ISO dates", () => {
    const label = formatCsvDateCell("2026-06-15T00:00:00.000Z", "done");
    expect(label).not.toBe("—");
    expect(label.toLowerCase()).not.toContain("done");
  });
});

describe("map received", () => {
  it("treats empty as not received yet", () => {
    expect(isMapReceived(null)).toBe(false);
    expect(isMapReceived("")).toBe(false);
    expect(isMapReceived("  ")).toBe(false);
    expect(getMapReceivedLabel(null)).toBe("Not received yet");
    expect(getMapReceivedStatus(null)).toBe("not_received");
  });

  it("treats v / check / yes as received", () => {
    expect(isMapReceived("v")).toBe(true);
    expect(isMapReceived("V")).toBe(true);
    expect(isMapReceived("✓")).toBe(true);
    expect(isMapReceived("yes")).toBe(true);
    expect(getMapReceivedLabel("v")).toBe("Map received");
    expect(getMapReceivedStatus("v")).toBe("received");
  });

  it("filters by mapReceived status", () => {
    const received = makeMap({ mapReceived: "v" });
    const pending = makeMap({ mapReceived: null });
    expect(
      matchesColumnFilters(received, { ...EMPTY_COLUMN_FILTERS, mapReceived: "received" })
    ).toBe(true);
    expect(
      matchesColumnFilters(pending, { ...EMPTY_COLUMN_FILTERS, mapReceived: "received" })
    ).toBe(false);
    expect(
      matchesColumnFilters(pending, { ...EMPTY_COLUMN_FILTERS, mapReceived: "not_received" })
    ).toBe(true);
  });
});

describe("matchesColumnFilters", () => {
  it("passes when no filters are set", () => {
    expect(matchesColumnFilters(makeMap(), EMPTY_COLUMN_FILTERS)).toBe(true);
  });

  it("filters by map number substring (case-insensitive)", () => {
    const map = makeMap({ mapNumber: "MAP-2024-0110" });
    expect(matchesColumnFilters(map, { ...EMPTY_COLUMN_FILTERS, map: "0110" })).toBe(true);
    expect(matchesColumnFilters(map, { ...EMPTY_COLUMN_FILTERS, map: "9999" })).toBe(false);
  });

  it("filters by exact client and state", () => {
    const map = makeMap({ client: "Acme", phase: "PREP", inspectorStatus: "ACCEPTED" });
    expect(matchesColumnFilters(map, { ...EMPTY_COLUMN_FILTERS, client: "Acme" })).toBe(true);
    expect(matchesColumnFilters(map, { ...EMPTY_COLUMN_FILTERS, state: "Accepted" })).toBe(true);
    expect(matchesColumnFilters(map, { ...EMPTY_COLUMN_FILTERS, state: "Fix" })).toBe(false);
  });
});
