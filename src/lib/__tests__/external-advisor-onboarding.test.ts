import { describe, expect, it, vi } from "vitest";

// The module pulls in the service-role Supabase client and the SignWell/storage
// helpers at import time. None of that is exercised by the pure predicate below.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/compliance-onboarding", () => ({
  COMPLIANCE_COLUMNS: "",
  backfillW9Pdf: vi.fn(),
  ensureW9Document: vi.fn(),
  signedComplianceDocUrl: vi.fn(),
  storeVoidedCheck: vi.fn(),
  syncW9: vi.fn(),
}));

import {
  missingOnboardingRequirement,
  ONBOARDING_REQUIREMENT_MESSAGE,
  type OnboardingRequirement,
} from "@/lib/external-advisor-onboarding";

type Row = {
  phone: string | null;
  profile_pic_url: string | null;
  w9_signed_at: string | null;
  voided_check_path: string | null;
};

const complete: Row = {
  phone: "(555) 123-4567",
  profile_pic_url: "https://example.supabase.co/storage/v1/object/public/advisor-profiles/u-1.jpg",
  w9_signed_at: "2026-09-15T00:00:00Z",
  voided_check_path: "external-advisor-onboarding/abc/voided-check_1.pdf",
};

describe("missingOnboardingRequirement", () => {
  it("returns null when every artifact is on file", () => {
    expect(missingOnboardingRequirement(complete)).toBeNull();
  });

  it.each<[OnboardingRequirement, Partial<Row>]>([
    ["phone", { phone: null }],
    ["photo", { profile_pic_url: null }],
    ["w9", { w9_signed_at: null }],
    ["check", { voided_check_path: null }],
  ])("requires %s when it is missing", (expected, missing) => {
    expect(missingOnboardingRequirement({ ...complete, ...missing })).toBe(expected);
  });

  // The wizard walks phone → photo → W-9 → check, and the server's refusal
  // message names a step. If the two disagree, a rep is told to fix a step the
  // wizard is not showing them.
  it("reports the EARLIEST missing requirement in wizard order", () => {
    expect(
      missingOnboardingRequirement({
        phone: null,
        profile_pic_url: null,
        w9_signed_at: null,
        voided_check_path: null,
      })
    ).toBe("phone");

    expect(
      missingOnboardingRequirement({ ...complete, profile_pic_url: null, voided_check_path: null })
    ).toBe("photo");

    expect(missingOnboardingRequirement({ ...complete, w9_signed_at: null, voided_check_path: null })).toBe(
      "w9"
    );
  });

  // A photo is REQUIRED (decided 2026-09-15): when it was optional at signup it
  // got skipped every time, and a Partner+ rep is the advisor of record their
  // borrowers see on the "Your Advisor" card.
  it("does not accept an empty or whitespace-only photo url", () => {
    expect(missingOnboardingRequirement({ ...complete, profile_pic_url: "" })).toBe("photo");
    expect(missingOnboardingRequirement({ ...complete, profile_pic_url: "   " })).toBe("photo");
  });

  it("rejects a phone number that is not a complete 10-digit US number", () => {
    expect(missingOnboardingRequirement({ ...complete, phone: "555-123" })).toBe("phone");
  });

  it("has a message for every requirement", () => {
    const keys: OnboardingRequirement[] = ["phone", "photo", "w9", "check"];
    for (const key of keys) {
      expect(ONBOARDING_REQUIREMENT_MESSAGE[key]).toBeTruthy();
    }
  });
});
