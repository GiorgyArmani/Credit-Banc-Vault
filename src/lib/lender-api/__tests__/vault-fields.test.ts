import { describe, expect, it } from "vitest";
import { normalizeVaultUpdates, resolveVaultFields, scopeResolvedToBusiness } from "@/lib/lender-api/vault-fields";
import { makeSource } from "./fixtures";

describe("scopeResolvedToBusiness", () => {
  const { vault } = makeSource({
    vault: { business_street: null, company_city: null, business_address: "10 Pipe St, Miami, FL 33101", owner_1_street: null, home_address: "22 Palm Ave, Miami, FL 33130" },
  });
  const resolved = resolveVaultFields(vault);
  const biz = { is_primary: false, company_city: " Tampa ", company_state: "fl", company_zip_code: "33601-1234" };

  it("leaves the primary business (or no business) exactly as resolved", () => {
    expect(scopeResolvedToBusiness(resolved, { ...biz, is_primary: true })).toEqual(resolved);
    expect(scopeResolvedToBusiness(resolved, null)).toEqual(resolved);
  });

  it("uses the second business's own address and drops the primary's street and EIN", () => {
    const scoped = scopeResolvedToBusiness(resolved, biz);
    expect(scoped.values).toMatchObject({
      company_city: "Tampa",
      company_state: "FL",
      company_zip_code: "33601",
      business_street: null,
      ein: null,
      owner_1_street: "22 Palm Ave",
      ssn: "123456789",
    });
    expect(scoped.parsed).not.toContain("business_street");
    expect(scoped.parsed).not.toContain("company_city");
    expect(scoped.parsed).toContain("owner_1_street");
  });

  it("clears unusable business values rather than falling back to the primary's", () => {
    const scoped = scopeResolvedToBusiness(resolved, { is_primary: false, company_city: "  ", company_state: null, company_zip_code: "abc" });
    expect(scoped.values).toMatchObject({ company_city: null, company_state: null, company_zip_code: null });
  });
});

describe("resolveVaultFields", () => {
  it("prefers structured columns over parsed free text", () => {
    const { vault } = makeSource({
      vault: { owner_1_street: "1 Real St", owner_1_city: "Austin", owner_1_state: "tx", owner_1_zip: "78701-0001", home_address: "9 Other Rd, Dallas, TX 75201" },
    });
    const r = resolveVaultFields(vault);
    expect(r.values.owner_1_street).toBe("1 Real St");
    expect(r.values.owner_1_state).toBe("TX");
    expect(r.values.owner_1_zip).toBe("78701");
    expect(r.parsed).not.toContain("owner_1_street");
  });

  it("falls back to parsing and reports which fields were parsed", () => {
    const { vault } = makeSource({
      vault: { owner_1_street: null, owner_1_city: null, owner_1_state: null, owner_1_zip: null, home_address: "9 Other Rd, Dallas, TX 75201" },
    });
    const r = resolveVaultFields(vault);
    expect(r.values).toMatchObject({ owner_1_street: "9 Other Rd", owner_1_city: "Dallas", owner_1_state: "TX", owner_1_zip: "75201" });
    expect(r.parsed).toEqual(expect.arrayContaining(["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"]));
  });

  it("normalizes ssn and ein to digits", () => {
    const { vault } = makeSource({ vault: { ssn: "123-45-6789", ein: "12-3456789" } });
    const r = resolveVaultFields(vault);
    expect(r.values.ssn).toBe("123456789");
    expect(r.values.ein).toBe("123456789");
  });
});

describe("normalizeVaultUpdates", () => {
  it("rejects unknown keys", () => {
    expect(normalizeVaultUpdates({ role: "admin" })).toEqual({ ok: false, error: "Unknown field: role" });
  });

  it("rejects a non-object", () => {
    expect(normalizeVaultUpdates("x")).toEqual({ ok: false, error: "vault_updates must be an object" });
  });

  it("normalizes valid values", () => {
    const r = normalizeVaultUpdates({
      ssn: "123-45-6789",
      owner_1_state: "Florida",
      owner_1_zip: "33101-1234",
      owner_1_dob: "1980-02-03",
      owner_1_street: "  1 Main St ",
      business_street: "",
    });
    expect(r).toEqual({
      ok: true,
      updates: {
        ssn: "123456789",
        owner_1_state: "FL",
        owner_1_zip: "33101",
        owner_1_dob: "1980-02-03",
        owner_1_street: "1 Main St",
        business_street: null,
      },
    });
  });

  it.each([
    [{ ssn: "12345" }, "SSN must be 9 digits"],
    [{ ein: "123" }, "EIN must be 9 digits"],
    [{ owner_1_state: "Narnia" }, "Owner state must be a US state"],
    [{ company_zip_code: "12" }, "Business zip must be 5 digits"],
    [{ owner_1_dob: "yesterday-ish" }, "Owner date of birth must be a date"],
    [{ owner_1_name: "" }, "Owner name is required"],
    [{ client_phone: "555" }, "Phone must have at least 10 digits"],
    [{ company_state: "" }, "Business state is required"],
    [{ company_zip_code: "   " }, "Business zip is required"],
  ])("rejects %j", (input, error) => {
    expect(normalizeVaultUpdates(input)).toEqual({ ok: false, error });
  });

  it("allows owner_1_state and owner_1_zip to be nulled", () => {
    expect(normalizeVaultUpdates({ owner_1_state: "" })).toEqual({
      ok: true,
      updates: { owner_1_state: null },
    });
    expect(normalizeVaultUpdates({ owner_1_zip: "   " })).toEqual({
      ok: true,
      updates: { owner_1_zip: null },
    });
  });
});
