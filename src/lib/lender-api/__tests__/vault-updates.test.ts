// src/lib/lender-api/__tests__/vault-updates.test.ts
import { describe, expect, it } from "vitest";
import { planVaultUpdates } from "@/lib/lender-api/vault-updates";

describe("planVaultUpdates — primary business", () => {
  it("writes everything to the vault and mirrors the address to the business row", () => {
    expect(
      planVaultUpdates(
        { ssn: "123456789", ein: "987654321", business_street: "1 Main St", company_city: "Tampa", company_state: "FL", owner_1_name: null },
        true
      )
    ).toEqual({
      ok: true,
      vault: { ssn: "123456789", ein: "987654321", business_street: "1 Main St", company_city: "Tampa", company_state: "FL" },
      business: { company_city: "Tampa", company_state: "FL" },
    });
  });

  it("plans nothing for no updates", () => {
    expect(planVaultUpdates({}, true)).toEqual({ ok: true, vault: {}, business: {} });
  });
});

describe("planVaultUpdates — second business", () => {
  it("writes the business address only to that business, owner fields to the vault", () => {
    expect(
      planVaultUpdates(
        { owner_1_street: "1 A St", client_phone: "(305) 555-0100", ssn: "123456789", company_city: "Tampa", company_zip_code: "33601" },
        false
      )
    ).toEqual({
      ok: true,
      vault: { owner_1_street: "1 A St", client_phone: "(305) 555-0100", ssn: "123456789" },
      business: { company_city: "Tampa", company_zip_code: "33601" },
    });
  });

  it.each([
    [{ business_street: "1 Main St" }],
    [{ ein: "987654321" }],
    [{ owner_1_street: "1 A St", business_street: null }],
  ])("refuses the primary-only fields %j and writes nothing", (updates) => {
    expect(planVaultUpdates(updates, false)).toEqual({
      ok: false,
      error: "Business street and EIN can only be edited on the primary business.",
    });
  });
});
