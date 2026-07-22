import { describe, expect, it } from "vitest";
import { MapTask } from "@prisma/client";
import { parseCsvDate, resolveTaskFromAssignees } from "../csvImport.js";

describe("parseCsvDate", () => {
  it("parses day month year", () => {
    const d = parseCsvDate("15 Dec 2025");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(11);
    expect(d!.getDate()).toBe(15);
  });

  it("parses two-digit year", () => {
    const d = parseCsvDate("03 Jun 26");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(3);
  });

  it("parses yearless with fallback year", () => {
    const d = parseCsvDate("04 Jun", 2026);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(4);
  });

  it("rejects done / checkmarks", () => {
    expect(parseCsvDate("done")).toBeNull();
    expect(parseCsvDate("v")).toBeNull();
    expect(parseCsvDate("")).toBeNull();
  });
});

describe("resolveTaskFromAssignees", () => {
  it("upload only → UPLOAD", () => {
    const r = resolveTaskFromAssignees({
      "Graphics upload assignee": "Arielle",
      "Upload QA Assignee": "",
      "Graphics polish assignee": "",
      "Polish QA assignee": "",
      Setup: "",
    });
    expect(r.task).toBe(MapTask.UPLOAD);
    expect(r.assigneeConflict).toBe(false);
    expect(r.graphicsUploadAssignee).toBe("Arielle");
  });

  it("upload + Setup done → UPLOADED", () => {
    const r = resolveTaskFromAssignees({
      "Graphics upload assignee": "Arielle",
      "Upload QA Assignee": "Marcella",
      "Graphics polish assignee": "",
      "Polish QA assignee": "",
      Setup: "Done",
    });
    expect(r.task).toBe(MapTask.UPLOADED);
    expect(r.assigneeConflict).toBe(false);
  });

  it("polish QA only → POLISH", () => {
    const r = resolveTaskFromAssignees({
      "Graphics upload assignee": "",
      "Upload QA Assignee": "",
      "Graphics polish assignee": "",
      "Polish QA assignee": "Anna",
      Setup: "",
    });
    expect(r.task).toBe(MapTask.POLISH);
    expect(r.polishQaAssignee).toBe("Anna");
    expect(r.assigneeConflict).toBe(false);
  });

  it("both sides named → conflict Please assign", () => {
    const r = resolveTaskFromAssignees({
      "Graphics upload assignee": "Arielle",
      "Upload QA Assignee": "",
      "Graphics polish assignee": "Jasmin",
      "Polish QA assignee": "Anna",
      Setup: "Done",
    });
    expect(r.assigneeConflict).toBe(true);
    expect(r.graphicsUploadAssignee).toBe("Arielle");
    expect(r.graphicsPolishAssignee).toBe("Jasmin");
  });
});
