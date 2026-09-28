// src/lib/__tests__/owners.test.ts
import { describe, expect, it } from "vitest";
import { legacyOwnerDrafts, maskOwner, owner1AddressClearedEntirely, mergeSsn, normalizeOwnerPhone, planLegacyOwnerColumns, planOwner1Update, resolveOwner1Address, validateOwners, type Owner1Stored, type OwnerInput } from "../owners";

const bo: OwnerInput = {
  position: 2, full_name: "Bo Roe", ownership_pct: 40, dob: "1979-07-08", ssn: "987-65-4321",
  street: "5 Oak Rd", city: "Miami", state: "FL", zip: "33133", email: "bo@example.com", phone: "3055550111",
};

describe("validateOwners", () => {
  it("accepts a valid co-owner", () => {
    expect(validateOwners(60, [bo])).toEqual([]);
  });
  it("rejects a share total over 100", () => {
    expect(validateOwners(70, [bo])).toEqual(["Ownership adds up to 110% — it can't pass 100%."]);
  });
  it("rejects positions outside 2–5 and duplicates", () => {
    expect(validateOwners(10, [{ ...bo, position: 6 }])).toContain("Owner position 6 is outside 2–5.");
    expect(validateOwners(10, [bo, { ...bo, full_name: "Al Poe", ownership_pct: 10 }])).toContain("Owner 2 is listed twice.");
  });
  it("names bad SSN / DOB / state / zip / email for that owner", () => {
    const errs = validateOwners(10, [{ ...bo, ssn: "123", dob: "07/08/79x", state: "Florida", zip: "3313", email: "bo@" }]);
    expect(errs).toEqual([
      "Owner 2: SSN must be 9 digits.",
      "Owner 2: date of birth is not a valid date.",
      "Owner 2: state must be a 2-letter code.",
      "Owner 2: zip must be 5 digits.",
      "Owner 2: email is not valid.",
    ]);
  });
  it("a blank SSN is allowed (keeps the stored one)", () => {
    expect(validateOwners(60, [{ ...bo, ssn: "" }])).toEqual([]);
  });
  it("requires a name", () => {
    expect(validateOwners(60, [{ ...bo, full_name: "  " }])).toContain("Owner 2: name is required.");
  });
  it("a blank (null/undefined) co-owner share is a required error, not silently 0%", () => {
    expect(validateOwners(60, [{ ...bo, ownership_pct: null as unknown as number }])).toContain(
      "Owner 2: ownership % is required."
    );
    expect(validateOwners(60, [{ ...bo, ownership_pct: undefined as unknown as number }])).toContain(
      "Owner 2: ownership % is required."
    );
  });
  it("a NaN co-owner share is a required error", () => {
    expect(validateOwners(60, [{ ...bo, ownership_pct: NaN }])).toContain("Owner 2: ownership % is required.");
  });
  it("0% ownership is still a valid share", () => {
    expect(validateOwners(60, [{ ...bo, ownership_pct: 0 }])).toEqual([]);
  });
  it("a blank/NaN share never appears in the range message and the total ignores it", () => {
    const errs = validateOwners(60, [{ ...bo, ownership_pct: NaN }]);
    expect(errs.some((e) => e.includes("ownership must be 0"))).toBe(false);
    expect(errs.some((e) => e.includes("NaN"))).toBe(false);
  });
  it("the share-total message is never NaN even when a co-owner's share is blank", () => {
    // owner1Pct alone (120) already exceeds 100 — the blank co-owner share
    // must be excluded from the sum, not turn the total into NaN.
    const errs = validateOwners(120, [{ ...bo, ownership_pct: null as unknown as number }]);
    expect(errs).toContain("Ownership adds up to 120% — it can't pass 100%.");
    expect(errs).toContain("Owner 2: ownership % is required.");
    expect(errs.some((e) => e.includes("NaN"))).toBe(false);
  });
});

describe("planLegacyOwnerColumns", () => {
  it("writes present owners and legacy clears removed positions", () => {
    expect(planLegacyOwnerColumns([{ position: 2, full_name: "Bo Roe", ownership_pct: 40 }])).toEqual({
      owner_2_name: "Bo Roe", owner_2_ownership_pct: 40,
      owner_3_name: null, owner_3_ownership_pct: null,
      owner_4_name: null, owner_4_ownership_pct: null,
      owner_5_name: null, owner_5_ownership_pct: null,
      number_of_owners: "More than one",
    });
  });
  it("no co-owners = One", () => {
    expect(planLegacyOwnerColumns([]).number_of_owners).toBe("One");
  });
});

describe("mergeSsn", () => {
  it("blank SSN keeps the stored one", () => {
    expect(mergeSsn("", "987654321")).toBe("987654321");
    expect(mergeSsn(null, "987654321")).toBe("987654321");
    expect(mergeSsn(undefined, null)).toBeNull();
  });
  it("a new SSN replaces it, digits only", () => {
    expect(mergeSsn("111-22-3333", "987654321")).toBe("111223333");
  });
});

describe("maskOwner", () => {
  it("never exposes more than the last 4", () => {
    const m = maskOwner({ position: 2, full_name: "Bo", ownership_pct: 40, dob: null, ssn: "987654321", street: null, city: null, state: null, zip: null, email: null, phone: null });
    expect(m).not.toHaveProperty("ssn");
    expect(m.ssn_last4).toBe("4321");
  });
});

describe("planOwner1Update", () => {
  const stored: Owner1Stored = {
    ssn: "987654321",
    owner_1_street: "1 Old Rd",
    owner_1_city: "Tampa",
    owner_1_state: "FL",
    owner_1_zip: "33602",
  };

  it("a partial street-only input keeps stored city/state/zip and composes home_address from the merged values", () => {
    expect(planOwner1Update({ street: "123 New St" }, stored)).toEqual({
      owner_1_street: "123 New St",
      owner_1_city: "Tampa",
      owner_1_state: "FL",
      owner_1_zip: "33602",
      home_address: "123 New St, Tampa, FL 33602",
    });
  });

  it("an explicit empty string clears that field, keeping the rest stored", () => {
    expect(planOwner1Update({ city: "" }, stored)).toEqual({
      owner_1_street: "1 Old Rd",
      owner_1_city: null,
      owner_1_state: "FL",
      owner_1_zip: "33602",
      home_address: "1 Old Rd, FL 33602",
    });
  });

  it("a blank SSN keeps the stored one and writes no ssn key", () => {
    expect(planOwner1Update({ ssn: "" }, stored)).toEqual({});
    expect(planOwner1Update({}, stored)).toEqual({});
  });

  it("undefined address fields write no address keys at all", () => {
    expect(planOwner1Update({ ownership_pct: 55, dob: "1970-01-01" }, stored)).toEqual({
      owner_1_ownership_pct: 55,
      owner_1_dob: "1970-01-01",
    });
  });
});

describe("planOwner1Update — onboarded client (free-text home_address only)", () => {
  // Onboarding writes only home_address; the structured owner_1_* columns are
  // NULL for almost every vault. A save must never erase that address.
  const onboarded: Owner1Stored = {
    ssn: null,
    owner_1_street: null,
    owner_1_city: null,
    owner_1_state: null,
    owner_1_zip: null,
    home_address: "12 Elm St, Tampa, FL 33602",
  };

  it("all-null or all-blank address input writes no address keys", () => {
    expect(planOwner1Update({ street: null, city: null, state: null, zip: null }, onboarded)).toEqual({});
    expect(planOwner1Update({ street: "", city: "", state: "", zip: "" }, onboarded)).toEqual({});
  });

  it("input equal to the parsed home_address writes no address keys", () => {
    expect(planOwner1Update({ street: "12 Elm St", city: "Tampa", state: "FL", zip: "33602" }, onboarded)).toEqual({});
  });

  it("a real change writes the structured columns and the composed home_address", () => {
    expect(planOwner1Update({ street: "12 Elm St", city: "Tampa", state: "FL", zip: "33603" }, onboarded)).toEqual({
      owner_1_street: "12 Elm St",
      owner_1_city: "Tampa",
      owner_1_state: "FL",
      owner_1_zip: "33603",
      home_address: "12 Elm St, Tampa, FL 33603",
    });
  });

  it("clearing a field that had a (parsed) value is an explicit clear", () => {
    expect(planOwner1Update({ street: "12 Elm St", city: "Tampa", state: "FL", zip: "" }, onboarded)).toEqual({
      owner_1_street: "12 Elm St",
      owner_1_city: "Tampa",
      owner_1_state: "FL",
      owner_1_zip: null,
      home_address: "12 Elm St, Tampa, FL",
    });
  });

  it("input equal to the stored structured columns writes nothing", () => {
    const stored: Owner1Stored = {
      ssn: null, owner_1_street: "1 Old Rd", owner_1_city: "Tampa", owner_1_state: "FL", owner_1_zip: "33602",
      home_address: "1 Old Rd, Tampa, FL 33602",
    };
    expect(planOwner1Update({ street: "1 Old Rd", city: "Tampa", state: "fl", zip: "33602" }, stored)).toEqual({});
  });
});

describe("resolveOwner1Address", () => {
  it("prefers the structured columns and falls back to the parsed home_address per field", () => {
    expect(
      resolveOwner1Address({
        ssn: null, owner_1_street: null, owner_1_city: null, owner_1_state: null, owner_1_zip: null,
        home_address: "12 Elm St, Tampa, FL 33602",
      })
    ).toEqual({ street: "12 Elm St", city: "Tampa", state: "FL", zip: "33602" });
    expect(
      resolveOwner1Address({
        ssn: null, owner_1_street: "9 New Ave", owner_1_city: null, owner_1_state: null, owner_1_zip: null,
        home_address: "12 Elm St, Tampa, FL 33602",
      })
    ).toEqual({ street: "9 New Ave", city: "Tampa", state: "FL", zip: "33602" });
  });
});

describe("legacyOwnerDrafts (I2)", () => {
  const row = { position: 2, full_name: "Bo Roe", ownership_pct: 40, dob: null, ssn: null, street: null, city: null, state: null, zip: null, email: null, phone: null };
  it("a legacy owner_N_name with no table row becomes a draft with its name and share", () => {
    expect(
      legacyOwnerDrafts({ owner_3_name: " Al Poe ", owner_3_ownership_pct: 25 }, [row])
    ).toEqual([
      { position: 3, full_name: "Al Poe", ownership_pct: 25, dob: null, street: null, city: null, state: null, zip: null, email: null, phone: null, ssn_last4: null },
    ]);
  });
  it("a position that already has a table row is not duplicated", () => {
    expect(legacyOwnerDrafts({ owner_2_name: "Bo Roe", owner_2_ownership_pct: 40 }, [row])).toEqual([]);
  });
  it("a missing/blank legacy share stays null (the editor flags it as required), never 0", () => {
    const [d] = legacyOwnerDrafts({ owner_4_name: "Cy Loe", owner_4_ownership_pct: null }, []);
    expect(d.ownership_pct).toBeNull();
  });
  it("blank legacy names are ignored", () => {
    expect(legacyOwnerDrafts({ owner_5_name: "  ", owner_5_ownership_pct: 10 }, [])).toEqual([]);
  });
});

describe("validateOwners — phone (I3)", () => {
  it("a partial phone is an error", () => {
    expect(validateOwners(60, [{ ...bo, phone: "555-12" }])).toContain("Owner 2: phone must be 10 digits.");
  });
  it("10 digits, or 11 with a leading 1, is fine; blank is allowed", () => {
    expect(validateOwners(60, [{ ...bo, phone: "(305) 555-0111" }])).toEqual([]);
    expect(validateOwners(60, [{ ...bo, phone: "+1 305 555 0111" }])).toEqual([]);
    expect(validateOwners(60, [{ ...bo, phone: "" }])).toEqual([]);
    expect(validateOwners(60, [{ ...bo, phone: null }])).toEqual([]);
  });
  it("11 digits without a leading 1 is an error", () => {
    expect(validateOwners(60, [{ ...bo, phone: "23055550111" }])).toContain("Owner 2: phone must be 10 digits.");
  });
});

describe("normalizeOwnerPhone (I3)", () => {
  it("stores the 10-digit number, dropping a leading US 1", () => {
    expect(normalizeOwnerPhone("+1 (305) 555-0111")).toBe("3055550111");
    expect(normalizeOwnerPhone("305.555.0111")).toBe("3055550111");
    expect(normalizeOwnerPhone("")).toBeNull();
    expect(normalizeOwnerPhone(null)).toBeNull();
  });
});

describe("validateOwners — owner 1 share (T13)", () => {
  it("a NaN owner-1 share is a required error and never poisons the total", () => {
    const errs = validateOwners(NaN, [bo]);
    expect(errs).toContain("Owner 1: ownership % is required.");
    expect(errs.some((e) => e.includes("NaN"))).toBe(false);
  });
  it("an owner-1 share outside 0–100 is an error", () => {
    expect(validateOwners(-5, [])).toContain("Owner 1: ownership must be 0–100%.");
  });
  it("null owner-1 share is not flagged here (callers resolve null to the stored value)", () => {
    expect(validateOwners(null, [bo])).toEqual([]);
  });
});

describe("owner1AddressClearedEntirely (C1)", () => {
  const onboarded: Owner1Stored = {
    ssn: null, owner_1_street: null, owner_1_city: null, owner_1_state: null, owner_1_zip: null,
    home_address: "12 Elm St, Tampa, FL 33602",
  };
  it("blanking all four fields over a stored address is flagged", () => {
    expect(owner1AddressClearedEntirely({ street: "", city: null, state: "", zip: null }, onboarded)).toBe(true);
  });
  it("not flagged when nothing is on file, when a field is kept, or when fields are omitted", () => {
    expect(owner1AddressClearedEntirely({ street: "", city: "", state: "", zip: "" }, { ...onboarded, home_address: null })).toBe(false);
    expect(owner1AddressClearedEntirely({ street: "12 Elm St", city: "", state: "", zip: "" }, onboarded)).toBe(false);
    expect(owner1AddressClearedEntirely({ ownership_pct: 50 }, onboarded)).toBe(false);
  });
});
