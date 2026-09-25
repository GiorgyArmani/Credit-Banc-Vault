import { describe, expect, it } from "vitest";
import {
  buildConnectedLenders,
  compareLenderMatches,
  connectedLender,
  lenderKey,
} from "../connected";

const provider = (id: string, displayName: string) => ({ id, displayName });

describe("connected lenders", () => {
  it("keys lender names the way providers match them (trimmed, case-insensitive)", () => {
    expect(lenderKey("  Loot ")).toBe("loot");
    expect(lenderKey(null)).toBe("");
  });

  it("maps only names a configured provider claims, once per spelling", () => {
    const lookup = (name: string) =>
      name.trim().toLowerCase() === "loot" ? provider("loot", "Loot") : null;
    expect(buildConnectedLenders(["Loot", "loot ", "Kapitus", null, ""], lookup)).toEqual({
      loot: { provider_id: "loot", display_name: "Loot" },
    });
  });

  it("looks a lender up by any spelling of its name", () => {
    const map = { loot: { provider_id: "loot", display_name: "Loot" } };
    expect(connectedLender(map, "LOOT")).toEqual({ provider_id: "loot", display_name: "Loot" });
    expect(connectedLender(map, "Kapitus")).toBeNull();
    expect(connectedLender(map, undefined)).toBeNull();
  });
});

describe("compareLenderMatches", () => {
  const r = (name: string, passed: boolean, flags: number, api: boolean) => ({ name, passed, flags, api });
  const sort = (list: ReturnType<typeof r>[]) =>
    [...list]
      .sort((a, b) =>
        compareLenderMatches(
          { passed: a.passed, flagCount: a.flags, api: a.api },
          { passed: b.passed, flagCount: b.flags, api: b.api }
        )
      )
      .map((x) => x.name);

  it("puts API lenders first among the eligible", () => {
    expect(sort([r("plain", true, 0, false), r("api", true, 0, true)])).toEqual(["api", "plain"]);
  });

  it("never lifts an ineligible API lender over an eligible one", () => {
    expect(sort([r("api-fails", false, 1, true), r("plain-passes", true, 0, false)])).toEqual([
      "plain-passes",
      "api-fails",
    ]);
  });

  it("boosts API lenders within the ineligible group too, then fewest issues", () => {
    expect(
      sort([r("plain-1", false, 1, false), r("api-3", false, 3, true), r("plain-2", false, 2, false)])
    ).toEqual(["api-3", "plain-1", "plain-2"]);
  });
});
