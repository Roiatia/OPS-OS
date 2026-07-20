import { describe, it, expect } from "vitest";
import {
  countInspectorActiveMaps,
  buildBalancedInspectorAssignments,
  summarizeShufflePlan,
  withOptimisticInspector,
  withUnassignedInspector,
} from "../assignment";
import { makeMap, makePerson } from "./fixtures";

const inspectors = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];

describe("countInspectorActiveMaps", () => {
  it("counts non-archived maps assigned to the inspector", () => {
    const maps = [
      makeMap({ id: "1", phase: "PREP", assignedInspector: makePerson("a") }),
      makeMap({ id: "2", phase: "POLISH", assignedInspector: makePerson("a") }),
      makeMap({ id: "3", phase: "APPROVED", assignedInspector: makePerson("a") }),
      makeMap({ id: "4", phase: "PREP", assignedInspector: makePerson("b") }),
    ];
    expect(countInspectorActiveMaps(maps, "a")).toBe(2);
    expect(countInspectorActiveMaps(maps, "b")).toBe(1);
  });
});

describe("buildBalancedInspectorAssignments", () => {
  it("spreads maps evenly across inspectors starting empty", () => {
    const toAssign = [makeMap({ id: "1" }), makeMap({ id: "2" }), makeMap({ id: "3" })];
    const plan = buildBalancedInspectorAssignments(toAssign, inspectors, []);
    const perInspector = plan.reduce<Record<string, number>>((acc, a) => {
      acc[a.inspectorId] = (acc[a.inspectorId] ?? 0) + 1;
      return acc;
    }, {});
    // 3 maps across 2 inspectors → 2 and 1.
    expect(Object.values(perInspector).sort()).toEqual([1, 2]);
    expect(plan).toHaveLength(3);
  });

  it("prefers the inspector with the lighter existing workload", () => {
    const existing = [makeMap({ id: "x", phase: "PREP", assignedInspector: makePerson("a") })];
    const plan = buildBalancedInspectorAssignments([makeMap({ id: "1" })], inspectors, existing);
    expect(plan[0]!.inspectorId).toBe("b");
  });

  it("returns nothing when there are no inspectors or no maps", () => {
    expect(buildBalancedInspectorAssignments([makeMap()], [], [])).toEqual([]);
    expect(buildBalancedInspectorAssignments([], inspectors, [])).toEqual([]);
  });
});

describe("summarizeShufflePlan", () => {
  it("reports current, receiving, and total-after per inspector", () => {
    const existing = [makeMap({ id: "x", phase: "PREP", assignedInspector: makePerson("a") })];
    const plan = [
      { mapId: "1", inspectorId: "b" },
      { mapId: "2", inspectorId: "b" },
    ];
    const rows = summarizeShufflePlan(plan, inspectors, existing);
    const byId = Object.fromEntries(rows.map((r) => [r.inspectorId, r]));
    expect(byId.a).toMatchObject({ currentActive: 1, receiving: 0, totalAfter: 1 });
    expect(byId.b).toMatchObject({ currentActive: 0, receiving: 2, totalAfter: 2 });
  });
});

describe("optimistic transitions", () => {
  it("withOptimisticInspector attaches inspector and moves INTAKE → PREP", () => {
    const next = withOptimisticInspector(
      makeMap({ phase: "INTAKE" }),
      makePerson("a", "Alice")
    );
    expect(next.phase).toBe("PREP");
    expect(next.assignedInspector).toEqual({ id: "a", name: "Alice", email: "a@test.local" });
    expect(next.inspectorStatus).toBeNull();
    expect(next.qaStatus).toBeNull();
  });

  it("withOptimisticInspector keeps a non-intake phase", () => {
    const next = withOptimisticInspector(makeMap({ phase: "POLISH" }), makePerson("a"));
    expect(next.phase).toBe("POLISH");
  });

  it("withUnassignedInspector clears inspector and returns to INTAKE", () => {
    const next = withUnassignedInspector(
      makeMap({ phase: "PREP", assignedInspector: makePerson("a"), inspectorStatus: "PROCESSING" })
    );
    expect(next.phase).toBe("INTAKE");
    expect(next.assignedInspector).toBeNull();
    expect(next.inspectorStatus).toBeNull();
  });
});
