import { describe, expect, it } from "vitest";
import { canEditClientProfile } from "../profile-edit-access";

const base = { advisorId: null, ownerAdvisorId: "adv-owner", isFollower: false };

describe("canEditClientProfile", () => {
  it("underwriting and admin edit any client, with no advisors row", () => {
    expect(canEditClientProfile({ ...base, role: "underwriting" })).toBe(true);
    expect(canEditClientProfile({ ...base, role: "admin" })).toBe(true);
  });
  it("the owning advisor edits", () => {
    expect(canEditClientProfile({ ...base, role: "advisor", advisorId: "adv-owner" })).toBe(true);
  });
  it("a following advisor edits", () => {
    expect(canEditClientProfile({ ...base, role: "advisor", advisorId: "adv-2", isFollower: true })).toBe(true);
  });
  it("an unrelated advisor is rejected", () => {
    expect(canEditClientProfile({ ...base, role: "advisor", advisorId: "adv-2" })).toBe(false);
  });
  it("no advisors row and no staff role is rejected", () => {
    expect(canEditClientProfile({ ...base, role: "client" })).toBe(false);
    expect(canEditClientProfile({ ...base, role: null })).toBe(false);
  });
  it("an empty owner never matches an empty advisor id", () => {
    expect(canEditClientProfile({ role: "advisor", advisorId: "", ownerAdvisorId: "", isFollower: false })).toBe(false);
  });
});
