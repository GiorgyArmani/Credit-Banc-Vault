import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  bittyFileRejection,
  bittyFileType,
  buildBittySubmission,
  interpretBittyStatus,
  readBittySubmitResponse,
  recentAnalysisMonths,
  suggestBittyPicks,
  toPhone10,
  type BittySubmission,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };
const picks = { bankruptcy_current: "No", advance_default: "No", advance_current: "0", recent_negative_days: "2" };

function build(source = makeSource(), p: Record<string, string> = picks) {
  const built = buildBittySubmission(source, p, ctx);
  return { built, payload: built.payload as BittySubmission };
}

function month(totalDeposits: string, negativeDays = "0") {
  return { totalDeposits, beginningBalance: "1", endingBalance: "1", avgDailyBalance: "1", numDeposits: "5", negativeDays };
}
const empty = { totalDeposits: "", beginningBalance: "", endingBalance: "", avgDailyBalance: "", numDeposits: "", negativeDays: "0" };

/** 12 slots, index 0 = January; `filled` maps month index → month data. */
function account(filled: Record<number, ReturnType<typeof month>>) {
  return { months: Array.from({ length: 12 }, (_, i) => filled[i] ?? empty), notes: ["", ""] };
}

describe("bitty payload", () => {
  it("builds a complete submission with no gaps", () => {
    const { built, payload } = build();
    expect(built.gaps).toEqual([]);
    expect(payload.leadid).toBe("cb-assign-1-1");
    expect(payload.legal_name).toBe("Doe Plumbing LLC");
    expect(payload.dba_name).toBe("Doe Plumbing");
    expect(payload.ein).toBe("123456789");
    expect(payload.address).toBe("10 Pipe St");
    expect(payload.city).toBe("Miami");
    expect(payload.state).toBe("FL");
    expect(payload.zip).toBe("33101");
    expect(payload.phone).toBe("3055550199");
    expect(payload.start_date).toBe("2018-05-01");
    expect(payload.requested_amount).toBe(50000);
    expect(payload.average_revenue).toBe(45000);
    expect(payload.bankruptcy_current).toBe(false);
    expect(payload.advance_default).toBe(false);
    expect(payload.advance_current).toBe(0);
    expect(payload.recent_negative_days).toBe(2);
    expect(payload.owners).toHaveLength(1);
    expect(payload.owners[0]).toMatchObject({
      first_name: "Jane",
      last_name: "Doe",
      address: "22 Palm Ave",
      city: "Miami",
      state: "FL",
      zip: "33130",
      email: "jane@example.com",
      cell_phone: "3055550100",
      dob: "1980-02-03",
      ssn: "123456789",
      ownership_percentage: 100,
    });
    // The key and the files are added by the client, never by the pure mapping.
    expect(payload).not.toHaveProperty("apikey");
    expect(payload).not.toHaveProperty("files");
  });

  it("redacts the SSN in the stored snapshot only", () => {
    const { built, payload } = build();
    expect(payload.owners[0].ssn).toBe("123456789");
    expect((built.redacted as BittySubmission).owners[0].ssn).toBe("*****6789");
  });

  it("requires every yes/no pick — nothing on file answers advance_default", () => {
    const { built } = build(makeSource(), {});
    const fields = built.gaps.map((g) => g.field);
    expect(fields).toContain("pick:advance_default");
    expect(fields).toContain("pick:bankruptcy_current");
    expect(fields).toContain("pick:recent_negative_days");
    // The advance count is always suggestible from the open positions.
    expect(fields).not.toContain("pick:advance_current");
  });

  it("flags a missing cell phone, SSN, DOB, EIN and requested amount", () => {
    const { built } = build(
      makeSource({ vault: { client_phone: "555", ssn: null, owner_1_dob: null, ein: null, capital_requested: null }, deal: null })
    );
    const fields = built.gaps.map((g) => g.field);
    expect(fields).toEqual(expect.arrayContaining(["client_phone", "ssn", "owner_1_dob", "ein", "capital_requested"]));
  });

  it("needs revenue from somewhere", () => {
    const { built } = build(
      makeSource({
        analysis: null,
        vault: { avg_monthly_deposits: null },
        business: { avg_monthly_deposits: null },
      })
    );
    expect(built.gaps.map((g) => g.field)).toContain("average_revenue");
  });

  it("sends three months of deposits from the bank analysis, oldest first", () => {
    const source = makeSource({
      analysis: {
        created_at: "2026-09-10T12:00:00Z",
        // Jun, Jul, Aug across two accounts; March is older and ignored.
        accounts_data: [
          account({ 2: month("1,000"), 5: month("10,000.50"), 6: month("20,000"), 7: month("30,000", "1") }),
          account({ 7: month("5,000", "4") }),
        ],
      },
    });
    const { payload } = build(source);
    expect(payload.bank_deposits1).toBe(10000.5);
    expect(payload.bank_deposits2).toBe(20000);
    expect(payload.bank_deposits3).toBe(35000);
    // The average still goes along — the spec accepts both.
    expect(payload.average_revenue).toBe(45000);
    // Worst account in the most recent month.
    expect(suggestBittyPicks(source).recent_negative_days).toBe("4");
  });

  it("maps up to two open positions into the advance fields", () => {
    const source = makeSource({
      openPositions: [
        { lender_name: "Funder A", current_balance: 9000, payment_amount: 250, payment_frequency: "Daily" },
        { lender_name: "Funder B", current_balance: 4000, payment_amount: 900, payment_frequency: "Weekly" },
      ],
    });
    expect(suggestBittyPicks(source).advance_current).toBe("2");
    const { built, payload } = build(source, { ...picks, advance_current: "2" });
    expect(built.gaps).toEqual([]);
    expect(payload).toMatchObject({
      advance_current: 2,
      advance_provider1: "Funder A",
      advance_freq1: 1,
      advance_payment1: 250,
      advance_provider2: "Funder B",
      advance_freq2: 2,
      advance_payment2: 900,
    });
  });

  it("rejects a position Bitty cannot express, and a count the file can't back", () => {
    const monthly = makeSource({
      openPositions: [{ lender_name: "Funder A", current_balance: 1, payment_amount: 100, payment_frequency: "Monthly" }],
    });
    const labels = build(monthly, { ...picks, advance_current: "1" }).built.gaps.map((g) => g.label).join();
    expect(labels).toMatch(/Daily or Weekly/);

    const none = build(makeSource(), { ...picks, advance_current: "2" }).built;
    expect(none.gaps.map((g) => g.field)).toContain("open_positions");
  });

  it("sends 3+ advances as the bare count", () => {
    const { payload } = build(makeSource(), { ...picks, advance_current: "3+" });
    expect(payload.advance_current).toBe(3);
    expect(payload).not.toHaveProperty("advance_provider1");
  });

  it("never sends the primary business's EIN for a second business", () => {
    const { built, payload } = build(makeSource({ business: { is_primary: false, company_name: "Second Co" } }));
    expect(payload.ein).toBe("");
    expect(built.gaps.map((g) => g.field)).toContain("ein");
  });
});

describe("bitty helpers", () => {
  it("normalizes phones to 10 digits", () => {
    expect(toPhone10("+1 (305) 555-0100")).toBe("3055550100");
    expect(toPhone10("305-555-0100")).toBe("3055550100");
    expect(toPhone10("555-0100")).toBeNull();
  });

  it("types and filters files", () => {
    expect(bittyFileType("business_bank_statements")).toBe(2);
    expect(bittyFileType("voided_check")).toBe(4);
    expect(bittyFileType("tax_returns")).toBeUndefined();
    expect(bittyFileRejection("Statement.PDF")).toBeNull();
    expect(bittyFileRejection("sheet.xlsx")).toMatch(/\.xlsx/);
    expect(bittyFileRejection("noext")).toMatch(/extension/);
  });

  it("walks months back from the analysis date, wrapping the year", () => {
    const months = recentAnalysisMonths([account({ 11: month("300"), 0: month("100"), 1: month("200") })], "2026-02-15");
    // Jan (100), then Dec (300); February's own slot is a year old and comes last.
    expect(months.map((m) => m.deposits)).toEqual([100, 300, 200]);
    expect(recentAnalysisMonths(null, "2026-02-15")).toEqual([]);
    expect(recentAnalysisMonths([account({})], null)).toEqual([]);
  });
});

describe("bitty responses", () => {
  const approved = {
    success: true,
    message: "Approved",
    id: 108029,
    pre_offer: {
      funding_gross: "75000.00",
      funding_net: "71102.00",
      funding_factor: "1.590000",
      funding_lein_pos: 1,
      funding_rtr: "119250.00",
      funding_term: 24,
      funding_payment: "4969.00",
      funding_freq: "Weekly",
      funding_origination_fee: 3898,
      commission_percentage: ".00",
      commission_amount: ".00",
    },
  };

  it("treats Approved as created, with the verdict attached", () => {
    const r = readBittySubmitResponse(200, approved, "lead-1");
    expect(r).toMatchObject({ ok: true, externalId: "108029", initialStatus: approved });
    const s = interpretBittyStatus(approved);
    expect(s.kind).toBe("approved");
    const note = s.kind === "approved" ? s.note : "";
    expect(note).toMatch(/\$75,000 gross \/ \$71,102 net/);
    expect(note).toMatch(/24 Weekly payments of \$4,969/);
    // ".00" means no commission, so none is shown.
    expect(note).not.toMatch(/commission/);
  });

  it("includes our commission when Bitty quotes one (observed live on dev)", () => {
    const withCommission = {
      ...approved,
      pre_offer: { ...approved.pre_offer, commission_percentage: "8.00", commission_amount: "2240.00" },
    };
    const s = interpretBittyStatus(withCommission);
    expect(s.kind === "approved" ? s.note : "").toMatch(/commission 8% \(\$2,240\)$/);
  });

  it("treats Declined as created even with no id — the leadid stands in", () => {
    const declined = { success: true, message: "Declined", id: "", reason: ["Minimum Revenue", "Underwriting Decline"] };
    expect(readBittySubmitResponse(200, declined, "lead-1")).toMatchObject({ ok: true, externalId: "lead-1" });
    expect(interpretBittyStatus(declined)).toEqual({
      kind: "declined",
      stage: "Declined",
      note: "Decline reasons: Minimum Revenue, Underwriting Decline",
    });
  });

  it("treats Duplicate as created and pending review — never approved", () => {
    const dup = { success: true, message: "Duplicate", duplicate_id: 72796, duplicate: "This submission was flagged as a duplicate." };
    expect(readBittySubmitResponse(200, dup, "lead-1")).toMatchObject({ ok: true, externalId: "72796" });
    expect(interpretBittyStatus(dup)).toMatchObject({ kind: "needs_info", stage: "Duplicate review" });
  });

  it("reads validation errors as a clean rejection with field errors", () => {
    const r = readBittySubmitResponse(
      200,
      { success: false, message: "Error", validation: { owners_1: { cell_phone: ["The cell phone field is required."] } } },
      "lead-1"
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.fieldErrors).toEqual({ "owners_1.cell_phone": ["The cell phone field is required."] });
    expect(r.error).toMatch(/cell phone/);
  });

  it("reads Duplicate Request and system errors as clean rejections", () => {
    const busy = readBittySubmitResponse(200, { success: false, message: "Duplicate Request", reason: ["x"] }, "l");
    expect(busy).toMatchObject({ ok: false, status: 409 });
    const sys = readBittySubmitResponse(200, { success: false, message: "error", reason: ["System Error, Please Resubmit."] }, "l");
    expect(sys).toMatchObject({ ok: false, status: 400, error: "Bitty: System Error, Please Resubmit." });
  });

  it("surfaces a rejected key (observed live on dev: 401)", () => {
    const r = readBittySubmitResponse(401, { success: false, message: "Invalid access key, contact info@bitty.com" }, "l");
    expect(r).toMatchObject({ ok: false, status: 401, error: "Bitty: Invalid access key, contact info@bitty.com" });
  });

  it("reads the live dev validation shape (observed: HTTP 422, mixed nesting)", () => {
    const r = readBittySubmitResponse(
      422,
      {
        success: false,
        message: "Error",
        validation: { owners_1: { email: ["The email field is required."] }, ein: ["The ein field is required."] },
      },
      "l"
    );
    expect(r.fieldErrors).toEqual({ "owners_1.email": ["The email field is required."], ein: ["The ein field is required."] });
    expect(r.status).toBe(422);
  });

  it("keeps anything unreadable uncertain", () => {
    // A 2xx or 5xx we can't read may still have created the deal.
    expect(readBittySubmitResponse(200, null, "l").status).toBe(200);
    expect(readBittySubmitResponse(502, { message: "error" }, "l").status).toBe(502);
    expect(readBittySubmitResponse(0, null, "l").status).toBe(0);
    // Approved is read by message, never by `success`.
    expect(readBittySubmitResponse(200, { success: true }, "l").ok).toBe(false);
  });
});
