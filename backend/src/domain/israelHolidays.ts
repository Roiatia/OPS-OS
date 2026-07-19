/**
 * Civil dates for major Israeli public holidays (חופשות / חגים with work restrictions).
 * Kept as an explicit calendar so availability/planning can gate hagim without an external API.
 * Extend yearly as needed.
 */
const HOLIDAY_DATES: Record<string, string> = {
  // 2025
  "2025-04-13": "Pesach (first day)",
  "2025-04-19": "Pesach (last day)",
  "2025-05-02": "Independence Day",
  "2025-06-02": "Shavuot",
  "2025-09-23": "Rosh Hashanah",
  "2025-09-24": "Rosh Hashanah",
  "2025-10-02": "Yom Kippur",
  "2025-10-07": "Sukkot (first day)",
  "2025-10-14": "Simchat Torah",
  // 2026
  "2026-04-02": "Pesach (first day)",
  "2026-04-08": "Pesach (last day)",
  "2026-04-22": "Independence Day",
  "2026-05-22": "Shavuot",
  "2026-09-12": "Rosh Hashanah",
  "2026-09-13": "Rosh Hashanah",
  "2026-09-21": "Yom Kippur",
  "2026-09-26": "Sukkot (first day)",
  "2026-10-03": "Simchat Torah",
  // 2027
  "2027-03-23": "Pesach (first day)",
  "2027-03-29": "Pesach (last day)",
  "2027-05-12": "Independence Day",
  "2027-06-11": "Shavuot",
  "2027-10-02": "Rosh Hashanah",
  "2027-10-03": "Rosh Hashanah",
  "2027-10-11": "Yom Kippur",
  "2027-10-16": "Sukkot (first day)",
  "2027-10-23": "Simchat Torah",
};

function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function israelHolidayName(date: Date): string | null {
  return HOLIDAY_DATES[toIsoDateLocal(date)] ?? null;
}

export function isIsraelHoliday(date: Date): boolean {
  return israelHolidayName(date) != null;
}

/** Holidays that fall Sun–Fri in the availability week starting Sunday. */
export function holidaysInAvailabilityWeek(weekStart: Date): { dayOfWeek: number; name: string; date: Date }[] {
  const out: { dayOfWeek: number; name: string; date: Date }[] = [];
  for (let dayOfWeek = 0; dayOfWeek <= 5; dayOfWeek++) {
    const d = new Date(weekStart);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOfWeek);
    const name = israelHolidayName(d);
    if (name) out.push({ dayOfWeek, name, date: d });
  }
  return out;
}

/** Can work hagim only if Friday form is signed. */
export function canWorkHagim(fridayContract: boolean, _hagimOk = false): boolean {
  return fridayContract;
}
