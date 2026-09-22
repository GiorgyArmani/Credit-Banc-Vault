import { describe, expect, it } from "vitest";
import { PARTNER_TAG, PARTNER_TIER_TAGS, partnerTierTags } from "@/lib/referral-partner-ghl";

// The tag strings are a contract with GHL: the welcome automations trigger on
// them, and a typo here is silent — the partner just never gets onboarded.
describe("referral partner tags", () => {
  it("uses the tag names that exist in the live location", () => {
    expect(PARTNER_TAG).toBe("referral partner");
    expect(PARTNER_TIER_TAGS[1]).toBe("tier 1 referral partner");
    expect(PARTNER_TIER_TAGS[2]).toBe("tier 2 referral partner");
  });

  it("adds the current tier and removes the other one", () => {
    expect(partnerTierTags(1)).toEqual({
      add: "tier 1 referral partner",
      remove: "tier 2 referral partner",
    });
    expect(partnerTierTags(2)).toEqual({
      add: "tier 2 referral partner",
      remove: "tier 1 referral partner",
    });
  });

  it("never adds and removes the same tag", () => {
    for (const tier of [1, 2] as const) {
      const { add, remove } = partnerTierTags(tier);
      expect(add).not.toBe(remove);
    }
  });
});
