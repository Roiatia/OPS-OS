import { describe, expect, it } from "vitest";
import type { ShiftPlanStaff } from "../../types/availability";
import {
  hasNextMorningFromMidnight,
  proposeWorkWindow,
} from "../mapSupervisorSlots";

function staff(partial: {
  userId?: string;
  name?: string;
  days: ShiftPlanStaff["days"];
}): ShiftPlanStaff {
  return {
    userId: partial.userId ?? "u1",
    name: partial.name ?? "Test",
    isShiftLeader: false,
    submitted: true,
    days: partial.days,
  };
}

describe("proposeWorkWindow overnight", () => {
  it("does not invent hours past midnight when next day is off (Erez case)", () => {
    // Mon 14:00–00:00, Tue unavailable
    const erez = staff({
      name: "Erez",
      days: [
        {
          dayOfWeek: 1,
          canWork: true,
          startMinutes: 14 * 60,
          endMinutes: 24 * 60,
        },
        { dayOfWeek: 2, canWork: false },
      ],
    });

    const full = proposeWorkWindow(erez, 1, 22 * 60);
    expect(full).toBeNull();

    const short = proposeWorkWindow(erez, 1, 22 * 60, { allowShort: true });
    expect(short).toEqual({
      startMinutes: 22 * 60,
      endMinutes: 24 * 60,
      duration: 2 * 60,
    });
    expect(hasNextMorningFromMidnight(erez, 1)).toBe(false);
  });

  it("extends past midnight only when next morning starts at 00:00", () => {
    const overnight = staff({
      name: "Bashar",
      days: [
        {
          dayOfWeek: 1,
          canWork: true,
          startMinutes: 14 * 60,
          endMinutes: 24 * 60,
        },
        {
          dayOfWeek: 2,
          canWork: true,
          startMinutes: 0,
          endMinutes: 8 * 60,
        },
      ],
    });

    const win = proposeWorkWindow(overnight, 1, 22 * 60);
    expect(win).not.toBeNull();
    expect(win!.startMinutes).toBe(22 * 60);
    expect(win!.endMinutes).toBe(24 * 60 + 8 * 60); // until 08:00 (+1)
    expect(win!.duration).toBe(10 * 60);
    expect(hasNextMorningFromMidnight(overnight, 1)).toBe(true);
  });

  it("does not stitch when next day starts later than midnight", () => {
    const gap = staff({
      days: [
        {
          dayOfWeek: 1,
          canWork: true,
          startMinutes: 14 * 60,
          endMinutes: 24 * 60,
        },
        {
          dayOfWeek: 2,
          canWork: true,
          startMinutes: 6 * 60,
          endMinutes: 14 * 60,
        },
      ],
    });

    expect(proposeWorkWindow(gap, 1, 22 * 60)).toBeNull();
    const short = proposeWorkWindow(gap, 1, 22 * 60, { allowShort: true });
    expect(short?.endMinutes).toBe(24 * 60);
    expect(hasNextMorningFromMidnight(gap, 1)).toBe(false);
  });

  it("treats endMinutes 0 as midnight when stitching overnight", () => {
    const overnight = staff({
      days: [
        {
          dayOfWeek: 1,
          canWork: true,
          startMinutes: 14 * 60,
          endMinutes: 0, // UI "00:00"
        },
        {
          dayOfWeek: 2,
          canWork: true,
          startMinutes: 0,
          endMinutes: 8 * 60,
        },
      ],
    });
    const win = proposeWorkWindow(overnight, 1, 22 * 60);
    expect(win?.endMinutes).toBe(24 * 60 + 8 * 60);
  });
});
