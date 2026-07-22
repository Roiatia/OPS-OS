import type { ScheduleTaskKind, ShiftPlanMap } from "../types/availability";

/** Frontend-only fake map for testing the planner (no CRM / backend sync). */
export type FakeMapInput = {
  dayOfWeek: number;
  mapNumber: string;
  client: string;
  mapperName: string;
  /** Minutes from midnight, or null if unset */
  startMinutes: number | null;
  endMinutes: number | null;
  taskKind?: ScheduleTaskKind;
};

export type LocalPlannerMap = ShiftPlanMap & { dayOfWeek: number; local: true };

let localIdSeq = 0;

export function localMapFromFakeDetails(input: FakeMapInput): LocalPlannerMap {
  localIdSeq += 1;
  return {
    id: `local-${input.dayOfWeek}-${input.mapNumber.trim() || "map"}-${Date.now()}-${localIdSeq}`,
    mapNumber: input.mapNumber.trim() || "FAKE",
    client: input.client.trim() || "—",
    taskKind: input.taskKind ?? "MAP",
    mapperName: input.mapperName.trim() || null,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    fieldDate: null,
    dayOfWeek: input.dayOfWeek,
    local: true,
  };
}

/** Parse "HH:MM" or "H:MM" → minutes, or null if empty/invalid. */
export function parseTimeToMinutes(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToInputValue(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Demo week for OPS testing — maps split ~half at 08:00 / half at 10:00
 * so client×start counts are easy to inspect. Local only; never written to the DB.
 */
export function buildDemoWeekTasks(): LocalPlannerMap[] {
  const t = (h: number, m = 0) => h * 60 + m;
  const EARLY = t(8);
  const LATE = t(10);
  const specs: FakeMapInput[] = [
    // Sunday — 3 @ 08:00, 3 @ 10:00
    {
      dayOfWeek: 0,
      mapNumber: "FAKE-S1",
      client: "Acme",
      mapperName: "Dana",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 0,
      mapNumber: "FAKE-S2",
      client: "Acme",
      mapperName: "Noa",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 0,
      mapNumber: "FAKE-S3",
      client: "Northwind",
      mapperName: "Avi",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 0,
      mapNumber: "FAKE-S4",
      client: "Northwind",
      mapperName: "Yael",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 0,
      mapNumber: "FAKE-S5",
      client: "Globex",
      mapperName: "Tom",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 0,
      mapNumber: "FAKE-S6",
      client: "Globex",
      mapperName: "Maya",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 0,
      mapNumber: "MEET-SUN",
      client: "Internal",
      mapperName: "",
      startMinutes: t(14),
      endMinutes: t(15),
      taskKind: "COMPANY_MEETING",
    },

    // Monday — 3 @ 08:00, 2 @ 10:00
    {
      dayOfWeek: 1,
      mapNumber: "FAKE-M1",
      client: "Initech",
      mapperName: "Ido",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 1,
      mapNumber: "FAKE-M2",
      client: "Initech",
      mapperName: "Lior",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 1,
      mapNumber: "FAKE-M3",
      client: "Umbrella",
      mapperName: "Sara",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 1,
      mapNumber: "FAKE-M4",
      client: "NightCo",
      mapperName: "Eli",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 1,
      mapNumber: "FAKE-M5",
      client: "NightCo",
      mapperName: "Ruth",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 1,
      mapNumber: "REFRESH-M",
      client: "Internal",
      mapperName: "",
      startMinutes: t(9, 30),
      endMinutes: t(11),
      taskKind: "MAPPING_REFRESH",
    },

    // Tuesday — 3 @ 08:00, 2 @ 10:00
    {
      dayOfWeek: 2,
      mapNumber: "FAKE-T1",
      client: "Acme",
      mapperName: "Dana",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 2,
      mapNumber: "FAKE-T2",
      client: "Northwind",
      mapperName: "Avi",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 2,
      mapNumber: "FAKE-T3",
      client: "Globex",
      mapperName: "Tom",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 2,
      mapNumber: "FAKE-T4",
      client: "Umbrella",
      mapperName: "Sara",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 2,
      mapNumber: "FAKE-T5",
      client: "NightCo",
      mapperName: "Ron",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 2,
      mapNumber: "HH-TUE",
      client: "Internal",
      mapperName: "",
      startMinutes: t(18),
      endMinutes: t(19),
      taskKind: "HAPPY_HOUR",
    },

    // Wednesday — 2 @ 08:00, 1 @ 10:00
    {
      dayOfWeek: 3,
      mapNumber: "FAKE-W1",
      client: "Acme",
      mapperName: "Noa",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 3,
      mapNumber: "FAKE-W2",
      client: "Initech",
      mapperName: "Ido",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 3,
      mapNumber: "FAKE-W3",
      client: "Globex",
      mapperName: "Maya",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 3,
      mapNumber: "MEET-WED",
      client: "Internal",
      mapperName: "",
      startMinutes: t(11),
      endMinutes: t(12),
      taskKind: "COMPANY_MEETING",
    },

    // Thursday — 3 @ 08:00, 2 @ 10:00
    {
      dayOfWeek: 4,
      mapNumber: "FAKE-TH1",
      client: "Northwind",
      mapperName: "Yael",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 4,
      mapNumber: "FAKE-TH2",
      client: "Northwind",
      mapperName: "Avi",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 4,
      mapNumber: "FAKE-TH3",
      client: "Globex",
      mapperName: "Maya",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 4,
      mapNumber: "FAKE-TH4",
      client: "Umbrella",
      mapperName: "Sara",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 4,
      mapNumber: "FAKE-TH5",
      client: "NightCo",
      mapperName: "Ron",
      startMinutes: LATE,
      endMinutes: null,
    },

    // Friday — 1 @ 08:00, 1 @ 10:00
    {
      dayOfWeek: 5,
      mapNumber: "FAKE-F1",
      client: "Acme",
      mapperName: "Dana",
      startMinutes: EARLY,
      endMinutes: null,
    },
    {
      dayOfWeek: 5,
      mapNumber: "FAKE-F2",
      client: "Initech",
      mapperName: "Ido",
      startMinutes: LATE,
      endMinutes: null,
    },
    {
      dayOfWeek: 5,
      mapNumber: "REFRESH-F",
      client: "Internal",
      mapperName: "",
      startMinutes: t(12),
      endMinutes: t(13, 30),
      taskKind: "MAPPING_REFRESH",
    },
    {
      dayOfWeek: 5,
      mapNumber: "MEET-FRI",
      client: "Internal",
      mapperName: "",
      startMinutes: t(15),
      endMinutes: t(16),
      taskKind: "COMPANY_MEETING",
    },
  ];

  return specs.map((s) => localMapFromFakeDetails(s));
}
