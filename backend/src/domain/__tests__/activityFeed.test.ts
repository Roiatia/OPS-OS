import { describe, it, expect } from "vitest";
import {
  getActivityTeam,
  getActivityLabel,
  isMilestoneEvent,
  normalizeMilestoneAction,
} from "../activityFeed.js";

describe("getActivityTeam", () => {
  it("routes graphics milestones to the graphics team", () => {
    expect(getActivityTeam("upload_approved")).toBe("graphics");
    expect(getActivityTeam("qa_approved")).toBe("graphics");
    expect(getActivityTeam("fix_done")).toBe("graphics");
    expect(getActivityTeam("inspector_done")).toBe("graphics");
  });

  it("routes everything else to ops", () => {
    expect(getActivityTeam("field_complete")).toBe("ops");
    expect(getActivityTeam("hub_completed")).toBe("ops");
    expect(getActivityTeam("something_unknown")).toBe("ops");
  });
});

describe("isMilestoneEvent", () => {
  it("recognizes explicit milestone actions", () => {
    expect(isMilestoneEvent("upload_approved", null)).toBe(true);
    expect(isMilestoneEvent("hub_cancelled", null)).toBe(true);
  });

  it("treats an inspector_status event as a milestone only when DONE", () => {
    expect(isMilestoneEvent("inspector_status", JSON.stringify({ status: "DONE" }))).toBe(true);
    expect(isMilestoneEvent("inspector_status", JSON.stringify({ status: "PROCESSING" }))).toBe(
      false
    );
    expect(isMilestoneEvent("inspector_status", null)).toBe(false);
    expect(isMilestoneEvent("inspector_status", "not-json")).toBe(false);
  });

  it("ignores non-milestone actions", () => {
    expect(isMilestoneEvent("assigned_inspector", null)).toBe(false);
  });
});

describe("normalizeMilestoneAction", () => {
  it("renames inspector_status to inspector_done", () => {
    expect(normalizeMilestoneAction("inspector_status", null)).toBe("inspector_done");
  });

  it("leaves other actions unchanged", () => {
    expect(normalizeMilestoneAction("upload_approved", null)).toBe("upload_approved");
  });
});

describe("getActivityLabel", () => {
  it("returns a friendly label, falling back to a humanized action", () => {
    expect(getActivityLabel("upload_approved")).toBe("Upload stage complete");
    expect(getActivityLabel("totally_new_action")).toBe("totally new action");
  });
});
