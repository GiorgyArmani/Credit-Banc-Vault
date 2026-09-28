import { describe, expect, it } from "vitest";
import { findOwnersDraftErrors, type OwnersDraft } from "../owners-editor";

const draft = (phone: string | null, pct: number | null = 40): OwnersDraft => ({
  owner1: { ownership_pct: 60 },
  owners: [{ position: 2, full_name: "Bo Roe", ownership_pct: pct, phone }],
});

describe("findOwnersDraftErrors", () => {
  it("flags a partial co-owner phone (I3)", () => {
    expect(findOwnersDraftErrors(draft("555-12"), true)).toEqual(["Owner 2: phone must be 10 digits."]);
  });
  it("accepts 10 digits, +1 11 digits, and blank", () => {
    expect(findOwnersDraftErrors(draft("(305) 555-0111"), true)).toEqual([]);
    expect(findOwnersDraftErrors(draft("+1 305 555 0111"), true)).toEqual([]);
    expect(findOwnersDraftErrors(draft(""), true)).toEqual([]);
    expect(findOwnersDraftErrors(draft(null), true)).toEqual([]);
  });
  it("still flags a blank share", () => {
    expect(findOwnersDraftErrors(draft(null, null), true)).toEqual(["Owner 2: ownership % is required."]);
  });
});
