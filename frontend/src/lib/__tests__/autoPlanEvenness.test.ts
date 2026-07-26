import { describe, expect, it } from "vitest";
import { autoPlanAvailability } from "../autoPlanAvailability";
import type { ShiftPlanMap, ShiftPlanStaff } from "../../types/availability";
import { AVAILABILITY_DAYS } from "../availabilityRules";

function staffMember(
  userId: string,
  name: string,
  opts: {
    isShiftLeader?: boolean;
    rating?: number;
    offerDays?: number[];
    maxShiftsPerWeek?: number;
  } = {}
): ShiftPlanStaff {
  const offerDays = new Set(opts.offerDays ?? [...AVAILABILITY_DAYS]);
  return {
    userId,
    name,
    isShiftLeader: opts.isShiftLeader ?? false,
    submitted: true,
    supervisorRating: opts.rating ?? 4,
    maxShiftsPerWeek: opts.maxShiftsPerWeek ?? null,
    daysOffered: offerDays.size,
    days: AVAILABILITY_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      canWork: offerDays.has(dayOfWeek),
      allDay: true,
      startMinutes: 8 * 60,
      endMinutes: 22 * 60,
    })),
  };
}

function mapsForDay(dayOfWeek: number, count: number): ShiftPlanMap[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${dayOfWeek}-${i}`,
    mapNumber: `${dayOfWeek}-${i}`,
    client: "Acme",
    taskKind: "MAP" as const,
    startMinutes: (8 + i) * 60,
    endMinutes: null,
  }));
}

describe("autoPlanAvailability evenness", () => {
  it("keeps assigned days almost even when everyone offered 6 days", () => {
    const staff: ShiftPlanStaff[] = [
      staffMember("cosmin", "Cosmin (Sup)", { rating: 3 }),
      staffMember("eyal", "Eyal (Sup)", { rating: 1 }),
      staffMember("lior", "Lior Hadad", { rating: 4 }),
      staffMember("alex", "Alex Ben-Ami", { rating: 4 }),
      staffMember("noam", "Noam Katz", { rating: 4 }),
      staffMember("oren", "Oren (SL)", { isShiftLeader: true, rating: 9 }),
      staffMember("rachel", "Rachel (SL)", { isShiftLeader: true, rating: 9 }),
      staffMember("dana", "Dana Weiss", { isShiftLeader: true, rating: 9 }),
      staffMember("erez", "Erez (SL)", { isShiftLeader: true, rating: 9 }),
      staffMember("bashar", "Bashar (Sup)", { rating: 2 }),
    ];

    const mapsPerDay = AVAILABILITY_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      count: 6,
      maps: mapsForDay(dayOfWeek, 6),
    }));

    const result = autoPlanAvailability({ staff, mapsPerDay });
    const counts = new Map<string, number>();
    for (const a of result.assignments) {
      counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    }

    const values = staff.map((s) => counts.get(s.userId) ?? 0);
    const min = Math.min(...values);
    const max = Math.max(...values);

    expect(max - min).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(2);
    expect(max).toBeLessThanOrEqual(3);
  });

  it("never assigns more days than offered", () => {
    const staff: ShiftPlanStaff[] = [
      staffMember("full", "Full", { rating: 4, offerDays: [0, 1, 2, 3, 4, 5] }),
      staffMember("five", "Five", { rating: 4, offerDays: [0, 1, 2, 3, 4] }),
      staffMember("three", "Three", { isShiftLeader: true, rating: 9, offerDays: [0, 2, 4] }),
      staffMember("two", "Two", { isShiftLeader: true, rating: 9, offerDays: [1, 3] }),
      staffMember("four", "Four", { rating: 3, offerDays: [0, 1, 2, 3] }),
    ];

    const mapsPerDay = AVAILABILITY_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      count: 4,
      maps: mapsForDay(dayOfWeek, 4),
    }));

    const result = autoPlanAvailability({ staff, mapsPerDay });
    const counts = new Map<string, number>();
    for (const a of result.assignments) {
      counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    }

    for (const s of staff) {
      const offered = s.daysOffered ?? s.days.filter((d) => d.canWork).length;
      expect(counts.get(s.userId) ?? 0).toBeLessThanOrEqual(offered);
    }
  });

  it("never exceeds a weekly shift cap even when someone offers every day", () => {
    const staff: ShiftPlanStaff[] = [
      staffMember("millie", "Millie", { rating: 4, maxShiftsPerWeek: 3 }),
      staffMember("igor", "Igor", { rating: 4 }),
      staffMember("noam", "Noam", { rating: 4 }),
      staffMember("zach", "Zach", { isShiftLeader: true, rating: 9 }),
      staffMember("erez", "Erez", { isShiftLeader: true, rating: 9 }),
    ];

    const mapsPerDay = AVAILABILITY_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      count: 6,
      maps: mapsForDay(dayOfWeek, 6),
    }));

    const result = autoPlanAvailability({ staff, mapsPerDay });
    const millieDays = result.assignments.filter((a) => a.userId === "millie").length;

    expect(millieDays).toBeLessThanOrEqual(3);
    expect(millieDays).toBeGreaterThan(0);
  });
});
