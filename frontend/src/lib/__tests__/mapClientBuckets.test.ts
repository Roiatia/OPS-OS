import { describe, expect, it } from "vitest";
import type { ShiftPlanMap } from "../../types/availability";
import {
  buildDayTableRows,
  consolidateBucketAssignees,
  groupMapsByClientStart,
  seatsForMapBucket,
} from "../mapClientBuckets";

function map(
  id: string,
  client: string,
  start: number,
  kind: ShiftPlanMap["taskKind"] = "MAP"
): ShiftPlanMap {
  return {
    id,
    mapNumber: id,
    client,
    startMinutes: start,
    taskKind: kind,
  };
}

describe("mapClientBuckets", () => {
  it("groups same client+start into one bucket with count", () => {
    const maps = [
      map("a1", "Acme", 8 * 60),
      map("a2", "Acme", 8 * 60),
      map("n1", "Northwind", 8 * 60),
      map("a3", "Acme", 10 * 60),
      map("meet", "Internal", 14 * 60, "COMPANY_MEETING"),
    ];
    const buckets = groupMapsByClientStart(maps);
    expect(buckets).toHaveLength(3);
    const acme8 = buckets.find((b) => b.client === "Acme" && b.startMinutes === 8 * 60);
    expect(acme8?.count).toBe(2);
    const rows = buildDayTableRows(maps);
    expect(rows.filter((r) => r.kind === "bucket")).toHaveLength(3);
    expect(rows.filter((r) => r.kind === "event")).toHaveLength(1);
  });

  it("seats ~2 maps per person", () => {
    expect(seatsForMapBucket(1)).toBe(1);
    expect(seatsForMapBucket(2)).toBe(1);
    expect(seatsForMapBucket(3)).toBe(2);
    expect(seatsForMapBucket(5)).toBe(3);
  });

  it("consolidates assignees onto all sibling maps", () => {
    const maps = [map("a1", "Acme", 480), map("a2", "Acme", 480)];
    const assignees = {
      a1: [{ userId: "u1", startMinutes: 480, endMinutes: 960 }],
      a2: [
        { userId: "u2", startMinutes: 480, endMinutes: 960 },
        { userId: "u3", startMinutes: 480, endMinutes: 960 },
      ],
    };
    const out = consolidateBucketAssignees([{ dayOfWeek: 0, maps }], assignees);
    // 2 maps → 1 seat; prefer canonical (a1) first
    expect(out.a1).toHaveLength(1);
    expect(out.a1![0]!.userId).toBe("u1");
    expect(out.a2).toEqual(out.a1);
  });
});
