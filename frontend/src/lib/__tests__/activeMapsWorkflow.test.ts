import { describe, it, expect } from "vitest";
import {
  getInspectorStatusOptions,
  getQaStatusOptions,
  getLeaderStatusOptions,
  getCurrentStatusValue,
  isInspectorInbox,
  isInspectorActive,
  isQaActive,
  type StatusOption,
} from "../activeMapsWorkflow";
import { makeMap, makePerson } from "./fixtures";

const values = (opts: StatusOption[]) => opts.map((o) => o.value);

describe("getInspectorStatusOptions", () => {
  it("offers only FixDone when a fix is requested during polish", () => {
    const opts = getInspectorStatusOptions(makeMap({ phase: "POLISH", qaStatus: "FIX" }));
    expect(values(opts)).toEqual(["fix_done"]);
    expect(opts[0]!.action).toEqual({ kind: "qa_review", status: "fix_done" });
  });

  it("returns nothing outside prep/polish", () => {
    expect(getInspectorStatusOptions(makeMap({ phase: "UPLOAD_REVIEW" }))).toEqual([]);
    expect(getInspectorStatusOptions(makeMap({ phase: "INTAKE" }))).toEqual([]);
  });

  it("offers only Accepted before the inspector accepts", () => {
    const opts = getInspectorStatusOptions(makeMap({ phase: "PREP", inspectorStatus: null }));
    expect(values(opts)).toEqual(["ACCEPTED"]);
  });

  it("offers the full progression once accepted", () => {
    const opts = getInspectorStatusOptions(
      makeMap({ phase: "PREP", inspectorStatus: "ACCEPTED" })
    );
    expect(values(opts)).toEqual(["ACCEPTED", "PROCESSING", "DONE"]);
  });
});

describe("getQaStatusOptions", () => {
  it("upload review offers approve + fix", () => {
    expect(values(getQaStatusOptions(makeMap({ phase: "UPLOAD_REVIEW" })))).toEqual([
      "upload_approved",
      "upload_fix",
    ]);
  });

  it("qa review offers approve + fix until fixes are done", () => {
    expect(values(getQaStatusOptions(makeMap({ phase: "QA_REVIEW" })))).toEqual([
      "approved",
      "fix",
    ]);
  });

  it("after fixes are done only approve remains", () => {
    expect(
      values(getQaStatusOptions(makeMap({ phase: "QA_REVIEW", qaStatus: "FIX_DONE" })))
    ).toEqual(["approved"]);
  });

  it("returns nothing outside the review phases", () => {
    expect(getQaStatusOptions(makeMap({ phase: "PREP" }))).toEqual([]);
  });
});

describe("getLeaderStatusOptions", () => {
  it("exposes inspector moves during prep and polish", () => {
    expect(values(getLeaderStatusOptions(makeMap({ phase: "PREP", inspectorStatus: "ACCEPTED" })))).toEqual(
      ["ACCEPTED", "PROCESSING", "DONE"]
    );
    expect(values(getLeaderStatusOptions(makeMap({ phase: "POLISH", qaStatus: "FIX" })))).toEqual([
      "fix_done",
    ]);
  });

  it("exposes QA moves during the review phases", () => {
    expect(values(getLeaderStatusOptions(makeMap({ phase: "UPLOAD_REVIEW" })))).toEqual([
      "upload_approved",
      "upload_fix",
    ]);
    expect(values(getLeaderStatusOptions(makeMap({ phase: "QA_REVIEW" })))).toEqual([
      "approved",
      "fix",
    ]);
  });

  it("offers nothing for new, field, or archived maps", () => {
    for (const phase of ["INTAKE", "FIELD", "APPROVED", "CANCELLED"] as const) {
      expect(getLeaderStatusOptions(makeMap({ phase }))).toEqual([]);
    }
  });
});

describe("getCurrentStatusValue", () => {
  it("maps the display state to the right select value per role", () => {
    const inQa = makeMap({ phase: "UPLOAD_REVIEW", inspectorStatus: "DONE", qaStatus: null });
    expect(getCurrentStatusValue(inQa, "qa")).toBe("in_qa");
    expect(getCurrentStatusValue(inQa, "inspector")).toBe("DONE");

    expect(getCurrentStatusValue(makeMap({ phase: "PREP", inspectorStatus: "ACCEPTED" }), "inspector")).toBe(
      "ACCEPTED"
    );
    expect(getCurrentStatusValue(makeMap({ phase: "QA_REVIEW", qaStatus: "FIX_DONE" }), "qa")).toBe(
      "fix_done"
    );
    expect(getCurrentStatusValue(makeMap({ phase: "INTAKE" }), "inspector")).toBe("");
  });
});

describe("inbox / active predicates", () => {
  const me = "insp-1";

  it("isInspectorInbox: assigned, not yet accepted, in prep/polish", () => {
    const map = makeMap({
      phase: "PREP",
      assignedInspector: makePerson(me),
      inspectorStatus: null,
    });
    expect(isInspectorInbox(map, me)).toBe(true);
    expect(isInspectorInbox(makeMap({ ...map, inspectorStatus: "ACCEPTED" }), me)).toBe(false);
    expect(isInspectorInbox(makeMap({ ...map, assignedInspector: makePerson("other") }), me)).toBe(
      false
    );
  });

  it("isInspectorActive: accepted work or an open fix request", () => {
    expect(
      isInspectorActive(
        makeMap({ phase: "PREP", assignedInspector: makePerson(me), inspectorStatus: "PROCESSING" }),
        me
      )
    ).toBe(true);
    expect(
      isInspectorActive(
        makeMap({ phase: "POLISH", assignedInspector: makePerson(me), qaStatus: "FIX" }),
        me
      )
    ).toBe(true);
    expect(
      isInspectorActive(
        makeMap({ phase: "PREP", assignedInspector: makePerson(me), inspectorStatus: null }),
        me
      )
    ).toBe(false);
  });

  it("isQaActive: in a review phase or has an active fix state", () => {
    expect(isQaActive(makeMap({ phase: "UPLOAD_REVIEW" }))).toBe(true);
    expect(isQaActive(makeMap({ phase: "QA_REVIEW" }))).toBe(true);
    expect(isQaActive(makeMap({ phase: "POLISH", qaStatus: "FIX" }))).toBe(true);
    expect(isQaActive(makeMap({ phase: "PREP" }))).toBe(false);
    expect(isQaActive(makeMap({ phase: "APPROVED" }))).toBe(false);
  });
});
