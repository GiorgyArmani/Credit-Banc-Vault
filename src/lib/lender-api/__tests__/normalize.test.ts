import { describe, expect, it } from "vitest";
import {
  digitsOnly,
  nonEmpty,
  parseUsAddress,
  splitName,
  toInt,
  toIsoDate,
  toStateCode,
  toZip5,
} from "@/lib/lender-api/normalize";

describe("scalars", () => {
  it("nonEmpty trims and nulls blanks", () => {
    expect(nonEmpty("  a ")).toBe("a");
    expect(nonEmpty("   ")).toBeNull();
    expect(nonEmpty(null)).toBeNull();
    expect(nonEmpty(0)).toBe("0");
  });

  it("digitsOnly strips formatting", () => {
    expect(digitsOnly("123-45-6789")).toBe("123456789");
    expect(digitsOnly(null)).toBe("");
  });

  it("toInt parses money-ish strings", () => {
    expect(toInt("$12,500.60")).toBe(12501);
    expect(toInt(49.4)).toBe(49);
    expect(toInt("")).toBeNull();
    expect(toInt("abc")).toBeNull();
  });

  it("toIsoDate keeps date-only strings stable (no timezone shift)", () => {
    expect(toIsoDate("2019-03-01")).toBe("2019-03-01");
    expect(toIsoDate("2019-03-01T00:00:00Z")).toBe("2019-03-01");
    expect(toIsoDate("not a date")).toBeNull();
  });

  it("splitName keeps middle names with the first name", () => {
    expect(splitName("Mary Ann Smith")).toEqual({ first: "Mary Ann", last: "Smith" });
    expect(splitName("John Smith Jr.")).toEqual({ first: "John", last: "Smith Jr." });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: null });
    expect(splitName("")).toEqual({ first: null, last: null });
  });

  it("toStateCode accepts codes, dotted codes and names", () => {
    expect(toStateCode("fl")).toBe("FL");
    expect(toStateCode("Fl.")).toBe("FL");
    expect(toStateCode("New York")).toBe("NY");
    expect(toStateCode("ZZ")).toBeNull();
  });

  it("toZip5 accepts 5 and 9 digit zips", () => {
    expect(toZip5("33101")).toBe("33101");
    expect(toZip5("33101-1234")).toBe("33101");
    expect(toZip5("3310")).toBeNull();
  });
});

describe("parseUsAddress — shapes seen in client_data_vault", () => {
  it.each([
    // comma-separated
    ["123 Oak Rd, Fresno, CA 93701", { street1: "123 Oak Rd", city: "Fresno", state: "CA", zip: "93701" }],
    ["55 Pine Ave, Denver, CO, 80202", { street1: "55 Pine Ave", city: "Denver", state: "CO", zip: "80202" }],
    // no comma between street and city — split after the street suffix
    ["900 Lake Ave. Minneapolis MN 55401", { street1: "900 Lake Ave.", city: "Minneapolis", state: "MN", zip: "55401" }],
    ["12 Elm st Raleigh nc 27601", { street1: "12 Elm st", city: "Raleigh", state: "NC", zip: "27601" }],
    // unit after the suffix stays with the street
    ["4 Bay Ave. Apt 2B Naples Fl. 34102", { street1: "4 Bay Ave. Apt 2B", city: "Naples", state: "FL", zip: "34102" }],
    ["7 Main DRIVE, SUITE 300 Grand Rapids, MI 49503", { street1: "7 Main DRIVE SUITE 300", city: "Grand Rapids", state: "MI", zip: "49503" }],
    // full state name
    ["1 Market Street, Richmond, Virginia 23219", { street1: "1 Market Street", city: "Richmond", state: "VA", zip: "23219" }],
    // semicolon used as a separator
    ["8 Hill Rd; Little Rock, AR 72201", { street1: "8 Hill Rd", city: "Little Rock", state: "AR", zip: "72201" }],
    // "Ct" street suffix must not be read as Connecticut
    ["30 Oak Ct, Tampa FL 33601", { street1: "30 Oak Ct", city: "Tampa", state: "FL", zip: "33601" }],
  ])("%s", (raw, expected) => {
    expect(parseUsAddress(raw)).toEqual(expected);
  });

  it("returns the whole string as street when nothing else can be found", () => {
    expect(parseUsAddress("100 Somewhere Road")).toEqual({
      street1: "100 Somewhere Road",
      city: null,
      state: null,
      zip: null,
    });
  });

  it("handles empty input", () => {
    expect(parseUsAddress(null)).toEqual({ street1: null, city: null, state: null, zip: null });
  });
});
