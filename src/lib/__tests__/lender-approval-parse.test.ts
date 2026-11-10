import { describe, expect, it } from "vitest";
import { parseApproval, parseApprovedAmount, parseApprovedTerm } from "@/lib/lender-approval-parse";

// Real approval notes from production (trimmed), Nov 2026.
const CASES: [string, number | null, string | null][] = [
  ["Approved Amount: $350,000 Expected Payback Term: 12 Months Factor Rate: 1.25 Payback Amount: $437,500 Weekly Payment: $8,413.46", 350000, "12 months"],
  ["$400k, 1.32 buy rate 24 bi-weekly remits (12 months) Max Upsell: 6%", 400000, "12 months"],
  ["Approved up to $355k 1st position pending October MTD", 355000, null],
  ["SBA 7a Loan Proposal: Proposed Loan Amount: $350,000 Rate: 10% (Variable: Prime + 3%) Term: 10 years (No prepayment penalty) Monthly Payment: $4,625.28", 350000, "10 years"],
  ["Loan Request: A new first lien in the amount of $625,000 Property Type: Warehouse Term: 360 Month Term & Amortization", 625000, "360 months"],
  ["Equipment Cost: $1,500,000.00 Base Term: 24 months Payment: $68,010.00 due and payable Monthly", 1500000, "24 months"],
  ["Option 1 – Full Doc LTV: 70% Loan Amount: $980,000 Interest Rate: 10.5% P&I Payment: $8,964.45 Term: 5-Year ARM", 980000, "5 years"],
  ["$3,500 over 60 days at a 149 10% fees (Credit Banc white label)", 3500, "60 days"],
  ["Loan Request: $724,500 Property Type: Office Term: 360 Month Term", 724500, "360 months"],
  ["HELOC offers: Primary Residence: 311 N Chase LN. Max HELOC: $750k Rate: 8.25% Amortization: 30 years", 750000, null],
  ["Calculator: https://offer-calc-v2.credibly.com/?id=1296919&key=b9dc0a80ae", null, null],
  ["Notes: soft offer, pending merchant interview Stips: VC DL Bank Verification", null, null],
  ["Monthly P&I: $20,847.72 Prepayment penalty: 5% for 5 years", null, null],
];

describe("lender approval parsing", () => {
  it.each(CASES)("%s", (notes, amount, term) => {
    expect(parseApprovedAmount(notes)).toBe(amount);
    expect(parseApprovedTerm(notes)).toBe(term);
  });

  it("formats for the dialog and handles empty notes", () => {
    expect(parseApproval("Approved Amount: $350,000 Term: 12 Months")).toEqual({ amount: "$350,000", term: "12 months" });
    expect(parseApproval(null)).toEqual({ amount: null, term: null });
    expect(parseApproval("")).toEqual({ amount: null, term: null });
  });
});
