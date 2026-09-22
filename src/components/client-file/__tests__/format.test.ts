import { describe, expect, it } from "vitest";
import {
  formatCompactCurrency,
  formatCreditScore,
  formatCurrency,
  formatDate,
  formatMonthly,
  formatTimeInBusiness,
} from "@/components/client-file/format";

describe("formatCurrency", () => {
  it("formats whole dollars", () => expect(formatCurrency(150000)).toBe("$150,000"));
  it.each([null, undefined, 0, -5, Number.NaN])("%s → —", (v) => expect(formatCurrency(v as number | null | undefined)).toBe("—"));
});

describe("formatCompactCurrency", () => {
  it.each([
    [950, "$950"],
    [42000, "$42k"],
    [42500, "$42.5k"],
    [999_950, "$1M"],
    [1_200_000, "$1.2M"],
    [999.6, "$1k"],
    [999.4, "$999"],
  ])("%s → %s", (v, out) => expect(formatCompactCurrency(v)).toBe(out));
  it("missing → —", () => expect(formatCompactCurrency(null)).toBe("—"));
});

describe("formatMonthly", () => {
  it("appends / mo", () => expect(formatMonthly(42000)).toBe("$42k / mo"));
  it("missing stays —", () => expect(formatMonthly(0)).toBe("—"));
});

describe("formatTimeInBusiness", () => {
  const now = new Date(2026, 8, 17); // Sep 17 2026, local
  it.each([
    ["2019-10-14", "6y 11m"],
    ["2020-09-01", "6y"],
    ["2026-02-10", "7m"],
    ["2026-09-01", "<1m"],
  ])("%s → %s", (start, out) => expect(formatTimeInBusiness(start, now)).toBe(out));
  it.each([null, undefined, "", "not a date", "2030-01-01"])("%s → —", (v) =>
    expect(formatTimeInBusiness(v as string | null | undefined, now)).toBe("—"),
  );
});

describe("formatDate", () => {
  it("keeps date-only strings on their calendar day", () => expect(formatDate("2019-10-14")).toBe("Oct 14, 2019"));
  it("missing → —", () => expect(formatDate(null)).toBe("—"));
  it("invalid → —", () => expect(formatDate("garbage")).toBe("—"));
});

describe("formatCreditScore", () => {
  it("trims", () => expect(formatCreditScore(" 700 ")).toBe("700"));
  it("keeps ranges", () => expect(formatCreditScore("680-700")).toBe("680-700"));
  it("missing → —", () => expect(formatCreditScore("")).toBe("—"));
});
