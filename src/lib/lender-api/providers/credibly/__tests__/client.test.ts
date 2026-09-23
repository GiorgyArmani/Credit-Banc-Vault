import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  createSubmission,
  getSubmissionStatus,
  isCrediblyConfigured,
  parseExpiresAt,
} from "../client";
import { credibly, crediblySignature } from "../index";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const jwtOk = (token = "jwt-1", expires_at = new Date(Date.now() + 600_000).toISOString()) =>
  json(200, { token, expires_at });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CREDIBLY_API_KEY", "api-key-1");
  vi.stubEnv("CREDIBLY_API_BASE", "");
  __testing.reset();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("credibly client", () => {
  it("is not configured without an API key", () => {
    vi.stubEnv("CREDIBLY_API_KEY", "");
    expect(isCrediblyConfigured()).toBe(false);
  });

  it("mints a JWT with the API key header and defaults to UAT", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(json(200, { status: "Intake" }));

    const r = await getSubmissionStatus("19FE925E");

    expect(r.ok).toBe(true);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://api-uat.credibly.com/v2/get-jwt");
    expect(tokenInit.method).toBe("GET");
    expect(tokenInit.headers["X-API-KEY"]).toBe("api-key-1");
    // The API key must never be used as a bearer token.
    expect(tokenInit.headers.Authorization).toBeUndefined();

    const [apiUrl, apiInit] = fetchMock.mock.calls[1];
    expect(apiUrl).toBe("https://api-uat.credibly.com/v2/submissions/19FE925E/status");
    expect(apiInit.headers.Authorization).toBe("Bearer jwt-1");
  });

  it("only talks to production when the base URL says so", async () => {
    vi.stubEnv("CREDIBLY_API_BASE", "https://api.credibly.com");
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(json(200, {}));
    await getSubmissionStatus("x");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.credibly.com/v2/get-jwt");
  });

  it("caches the JWT across calls", async () => {
    fetchMock
      .mockResolvedValueOnce(jwtOk())
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(200, {}));
    await getSubmissionStatus("a");
    await getSubmissionStatus("b");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v2/get-jwt"))).toHaveLength(1);
  });

  it("re-mints once on a 401 (their token expiry) and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(jwtOk("jwt-old"))
      .mockResolvedValueOnce(json(401, { code: 401, message: "Token expired" }))
      .mockResolvedValueOnce(jwtOk("jwt-new"))
      .mockResolvedValueOnce(json(200, { submission_id: "ABC123", status: "Submitted" }));

    const r = await createSubmission({});

    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ submission_id: "ABC123", status: "Submitted" });
    const last = fetchMock.mock.calls.at(-1)!;
    expect(last[1].headers.Authorization).toBe("Bearer jwt-new");
  });

  it("surfaces their 400 validation message", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(json(400, { error: "federal_tax_id is invalid" }));
    const r = await createSubmission({});
    expect(r).toMatchObject({ ok: false, status: 400, error: "federal_tax_id is invalid" });
  });

  it("reports an unreachable lender as status 0, never as a rejection", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockRejectedValueOnce(new Error("socket hang up"));
    const r = await createSubmission({});
    expect(r.status).toBe(0);
    expect(r.ok).toBe(false);
  });

  it("does not leak the API key when it is rejected", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "bad key" }));
    const r = await createSubmission({});
    expect(r.error).toBe("Credibly rejected our API key");
    expect(JSON.stringify(r)).not.toContain("api-key-1");
  });
});

describe("parseExpiresAt", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");

  it("reads ISO timestamps, with or without a zone", () => {
    expect(parseExpiresAt("2026-09-22T12:10:00Z", now)).toBe(Date.parse("2026-09-22T12:10:00Z"));
    // No zone is treated as UTC, not as the server's local time.
    expect(parseExpiresAt("2026-09-22 12:10:00", now)).toBe(Date.parse("2026-09-22T12:10:00Z"));
  });

  it("reads the shape their UAT server actually returns", () => {
    // Verified live 2026-09-22: space separator, microseconds, no zone, and it
    // IS UTC — the token was ~30 minutes out, which only holds if UTC.
    expect(parseExpiresAt("2026-09-22 12:30:42.675421", now)).toBe(Date.parse("2026-09-22T12:30:42.675Z"));
  });

  it("reads epoch seconds and milliseconds", () => {
    expect(parseExpiresAt(String(now / 1000 + 600), now)).toBe(now + 600_000);
    expect(parseExpiresAt(now + 600_000, now)).toBe(now + 600_000);
  });

  it("refuses anything that would keep a dead token alive", () => {
    expect(parseExpiresAt("", now)).toBeNull();
    expect(parseExpiresAt("not a date", now)).toBeNull();
    expect(parseExpiresAt("2020-01-01T00:00:00Z", now)).toBeNull(); // already past
    expect(parseExpiresAt("2030-01-01T00:00:00Z", now)).toBeNull(); // implausibly far
    expect(parseExpiresAt(undefined, now)).toBeNull();
  });
});

describe("credibly webhook", () => {
  const body = '{"submission_id": "7872A8A2", "status": "Submitted"}';

  function req(signature: string | null) {
    return new Request("https://vault.example/api/webhooks/lender-api/credibly", {
      method: "POST",
      headers: signature ? { "X-Signature": signature } : {},
      body,
    });
  }

  it("accepts a signature of iso_token + the raw body", async () => {
    vi.stubEnv("CREDIBLY_WEBHOOK_TOKEN", "iso-token");
    expect(await credibly.webhook!.verify(req(crediblySignature("iso-token", body)))).toBe(true);
  });

  it("rejects a wrong signature, a missing header, and an unset token", async () => {
    vi.stubEnv("CREDIBLY_WEBHOOK_TOKEN", "iso-token");
    expect(await credibly.webhook!.verify(req("deadbeef"))).toBe(false);
    expect(await credibly.webhook!.verify(req(null))).toBe(false);
    // Hashing the body WITHOUT the token must not pass either.
    expect(await credibly.webhook!.verify(req(crediblySignature("", body)))).toBe(false);
    vi.stubEnv("CREDIBLY_WEBHOOK_TOKEN", "");
    expect(await credibly.webhook!.verify(req(crediblySignature("iso-token", body)))).toBe(false);
  });

  it("leaves the body readable for the route", async () => {
    vi.stubEnv("CREDIBLY_WEBHOOK_TOKEN", "iso-token");
    const r = req(crediblySignature("iso-token", body));
    await credibly.webhook!.verify(r);
    await expect(r.json()).resolves.toEqual({ submission_id: "7872A8A2", status: "Submitted" });
  });

  it("takes only the submission id from the body", () => {
    expect(credibly.webhook!.extractExternalId({ submission_id: "7872A8A2" })).toBe("7872A8A2");
    expect(credibly.webhook!.extractExternalId({ status: "Submitted" })).toBeNull();
    expect(credibly.webhook!.extractExternalId(null)).toBeNull();
  });
});

describe("credibly document upload", () => {
  const doc = (id: string, docCode: string): OutboundDocument => ({
    documentId: id,
    filename: `${id}.pdf`,
    url: `https://vault.example/signed/${id}.pdf`,
    docCode,
    stamped: true,
  });

  // A factory, not a shared value: a Response body can only be read once.
  const statusWithStips = () =>
    json(200, {
      status: "Submitted",
      stips: [
        { stip_id: "O-2", stip_status: "Pending", short_text: "Bank Statements", long_text: "" },
        { stip_id: "O-5", stip_status: "Pending", short_text: "Signed Application", long_text: "" },
      ],
    });

  it("posts each document to its own stip, by URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jwtOk())
      .mockResolvedValueOnce(statusWithStips())
      .mockResolvedValueOnce(json(200, { status: "ok" }))
      .mockResolvedValueOnce(json(200, { status: "ok" }));

    const results = await credibly.uploadDocuments("ABC123", [
      doc("d1", "business_bank_statements"),
      doc("d2", "funding_application"),
    ]);

    expect(results.every((r) => r.accepted)).toBe(true);
    const uploadCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/documents/"));
    expect(uploadCalls.map(([url]) => String(url))).toEqual([
      "https://api-uat.credibly.com/v2/submissions/ABC123/documents/O-2",
      "https://api-uat.credibly.com/v2/submissions/ABC123/documents/O-5",
    ]);
    expect(JSON.parse(uploadCalls[0][1].body)).toEqual({
      files: ["https://vault.example/signed/d1.pdf"],
      final_document: true,
    });
  });

  it("falls back to base64 when Credibly cannot fetch the URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jwtOk())
      .mockResolvedValueOnce(statusWithStips())
      .mockResolvedValueOnce(json(400, { error: "could not retrieve file" }))
      .mockResolvedValueOnce(new Response(Buffer.from("hello"), { status: 200, headers: { "Content-Type": "application/pdf" } }))
      .mockResolvedValueOnce(json(200, { status: "ok" }));

    const results = await credibly.uploadDocuments("ABC123", [doc("d1", "business_bank_statements")]);

    expect(results).toEqual([{ documentId: "d1", filename: "d1.pdf", stamped: true, accepted: true }]);
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
    expect(body.files[0]).toEqual({
      file_name: "d1.pdf",
      mime_type: "application/pdf",
      base64_data: Buffer.from("hello").toString("base64"),
    });
  });

  it("never guesses a stip for a document that matches none", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(statusWithStips());

    const results = await credibly.uploadDocuments("ABC123", [doc("d9", "voided_check")]);

    expect(results[0].accepted).toBe(false);
    expect(results[0].error).toContain("No Credibly stip matches");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/documents/"))).toBe(false);
  });

  it("reports every document when the stip list cannot be read", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(json(404, { code: 404, message: "not found" }));

    const results = await credibly.uploadDocuments("ABC123", [doc("d1", "business_bank_statements")]);

    expect(results[0].accepted).toBe(false);
    expect(results[0].error).toContain("not found");
  });
});

describe("credibly provider wiring", () => {
  it("matches the lender name underwriting assigns", () => {
    expect(credibly.matchesLender("Credibly")).toBe(true);
    expect(credibly.matchesLender("  credibly ")).toBe(true);
    expect(credibly.matchesLender("Credibly Capital")).toBe(false);
  });

  it("reports a create failure with the HTTP status, so uncertainty isn't a rejection", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(json(500, {}));
    const r = await credibly.createApplication({});
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it("treats a 200 without a submission id as a failure", async () => {
    fetchMock.mockResolvedValueOnce(jwtOk()).mockResolvedValueOnce(json(200, { status: "Submitted" }));
    const r = await credibly.createApplication({});
    expect(r.ok).toBe(false);
  });
});
