import { describe, expect, it } from "vitest";
import { FieldWorkStatus } from "@prisma/client";
import {
  hubMapNumber,
  parseBoolCell,
  parseHubSessionCsv,
  parseSessionStatus,
  parseSessionTime,
} from "../hubSessionCsv.js";

const HEADER = "name,number,time,mapper,isNew,status,meetLink";

describe("parseSessionTime", () => {
  it("reads 24h clock values", () => {
    expect(parseSessionTime("15:00")).toBe(900);
    expect(parseSessionTime("9:30")).toBe(570);
    expect(parseSessionTime("1800")).toBe(1080);
  });

  it("reads am/pm values", () => {
    expect(parseSessionTime("3:00 PM")).toBe(900);
    expect(parseSessionTime("12:15 AM")).toBe(15);
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseSessionTime("")).toBeNull();
    expect(parseSessionTime("soon")).toBeNull();
    expect(parseSessionTime("25:00")).toBeNull();
  });
});

describe("cell parsers", () => {
  it("treats only truthy words as new", () => {
    expect(parseBoolCell("TRUE")).toBe(true);
    expect(parseBoolCell("yes")).toBe(true);
    expect(parseBoolCell("FALSE")).toBe(false);
    expect(parseBoolCell("")).toBe(false);
  });

  it("maps status text to field work status", () => {
    expect(parseSessionStatus("ACTIVE")).toBe(FieldWorkStatus.UNCOMPLETED);
    expect(parseSessionStatus("cancelled")).toBe(FieldWorkStatus.CANCELLED);
    expect(parseSessionStatus("DONE")).toBe(FieldWorkStatus.COMPLETED);
  });

  it("keeps the SC- numbering for Sam's Club", () => {
    expect(hubMapNumber("Sam's Club", "6218")).toBe("SC-6218");
    expect(hubMapNumber("North Market", "412")).toBe("NM-412");
  });
});

describe("parseHubSessionCsv", () => {
  it("parses the daily session export", () => {
    const { rows, errors } = parseHubSessionCsv(
      [
        HEADER,
        "Sam's Club,6218,15:00,Brandon Wright,FALSE,ACTIVE,https://meet.google.com/abc-defg-hij",
        "Sam's Club,4776,16:00,Aiza Cortina Schwan,TRUE,ACTIVE,https://meet.google.com/klm-nopq-rst",
      ].join("\n")
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      mapNumber: "SC-6218",
      client: "Sam's Club",
      startMinutes: 900,
      timeLabel: "15:00",
      mapperName: "Brandon Wright",
      isNewStore: false,
      fieldWorkStatus: FieldWorkStatus.UNCOMPLETED,
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(rows[1]?.isNewStore).toBe(true);
  });

  it("reports bad rows without dropping the good ones", () => {
    const { rows, errors } = parseHubSessionCsv(
      [
        HEADER,
        "Sam's Club,6218,15:00,Brandon Wright,FALSE,ACTIVE,",
        "Sam's Club,,16:00,No Number,FALSE,ACTIVE,",
        "Sam's Club,8220,later,Bad Time,FALSE,ACTIVE,",
      ].join("\n")
    );

    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ row: 3, message: "Missing number" });
    expect(errors[1]?.message).toContain("Invalid time");
  });

  it("skips a repeated store at the same time", () => {
    const { rows, errors } = parseHubSessionCsv(
      [
        HEADER,
        "Sam's Club,6218,15:00,Brandon Wright,FALSE,ACTIVE,",
        "Sam's Club,6218,15:00,Brandon Wright,FALSE,ACTIVE,",
        "Sam's Club,6218,19:00,Second Session,FALSE,ACTIVE,",
      ].join("\n")
    );

    expect(rows).toHaveLength(2);
    expect(errors[0]?.message).toContain("Duplicate of row 2");
  });

  it("rejects a file that is missing required columns", () => {
    expect(() => parseHubSessionCsv("store,when\nSam's Club,15:00")).toThrow(
      /Missing column/
    );
  });
});
