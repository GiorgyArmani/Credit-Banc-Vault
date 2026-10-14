import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import { arfTagsForDocCode, buildArfApplication, interpretArfStatus, isArfApplication, readArfJob } from "../mapping";

const JOB = "EXTDS-3f8a1c92-5b7d-4e21-9a6f-0c4d8e2b1f37";

describe("arf application", () => {
  it("carries only our reference: ARF reads the deal from the files", () => {
    const built = buildArfApplication(makeSource(), {}, { referenceId: "cb-assign-1-1" });
    expect(built).toEqual({
      payload: { referenceId: "cb-assign-1-1" },
      redacted: { referenceId: "cb-assign-1-1" },
      gaps: [],
      effectivePicks: {},
    });
  });

  it("never gaps on client data, however thin the profile", () => {
    const built = buildArfApplication(
      makeSource({ vault: { ssn: null, ein: null, owner_1_name: null, client_phone: null, business_address: null } }),
      {},
      { referenceId: "r" }
    );
    expect(built.gaps).toEqual([]);
  });

  it("knows which document is the application", () => {
    expect(isArfApplication("signed_application")).toBe(true);
    expect(isArfApplication("funding_application")).toBe(true);
    expect(isArfApplication("business_bank_statements")).toBe(false);
    expect(isArfApplication(null)).toBe(false);
    expect(arfTagsForDocCode("signed_application")).toEqual(["Application (required)"]);
    expect(arfTagsForDocCode("voided_check")).toEqual([]);
  });
});

describe("arf job state", () => {
  it("reads the state from the HTTP code first", () => {
    expect(readArfJob(202, { jobId: JOB, status: "queued" }, JOB)).toEqual({ jobId: JOB, status: "queued" });
    expect(readArfJob(202, { jobId: JOB, status: "awaiting_callback" }, JOB)).toEqual({ jobId: JOB, status: "awaiting_callback" });
    expect(readArfJob(200, { jobId: JOB, status: "submitted" }, JOB)).toEqual({ jobId: JOB, status: "submitted" });
    expect(readArfJob(200, null, JOB)).toEqual({ jobId: JOB, status: "submitted" });
    expect(readArfJob(500, { detail: "processing failed" }, JOB)).toEqual({ jobId: JOB, status: "failed" });
  });

  it("says nothing about the job on 404, 401 or a gateway error", () => {
    for (const code of [404, 401, 502, 503, 0]) expect(readArfJob(code, null, JOB)).toBeNull();
  });

  it("is in progress while working and once delivered", () => {
    expect(interpretArfStatus({ status: "queued" })).toEqual({ kind: "in_progress", stage: "Queued at ARF" });
    expect(interpretArfStatus({ status: "processing" })).toEqual({ kind: "in_progress", stage: "ARF is processing" });
    expect(interpretArfStatus({ status: "awaiting_callback" })).toEqual({ kind: "in_progress", stage: "ARF is processing" });
    expect(interpretArfStatus({ status: "submitted" })).toEqual({ kind: "in_progress", stage: "Delivered to ARF" });
    expect(interpretArfStatus(null)).toEqual({ kind: "in_progress", stage: "Queued at ARF" });
  });

  it("a failed job needs attention and warns against resending", () => {
    const s = interpretArfStatus({ status: "failed" });
    expect(s.kind).toBe("needs_info");
    expect(s.kind === "needs_info" && s.note).toContain("do not resend");
  });

  it("never reads an approval or a decline, whatever the status says", () => {
    for (const status of ["approved", "declined", "funded", "something_new"]) {
      expect(interpretArfStatus({ status }).kind).toBe("in_progress");
    }
  });
});
