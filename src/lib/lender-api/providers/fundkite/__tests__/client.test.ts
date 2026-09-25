import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, isFundkiteConfigured } from "../client";
import { fundkite, fundkiteSignature } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";
import type { FundkiteDealRequest } from "../mapping";

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const tokenOk = (token = "tok-1") => json(200, { token_type: "Bearer", expires_in: 31536000, access_token: token });
const deal = { external_id: "cb-a-1", owner_1_ssn: "123456789" } as unknown as FundkiteDealRequest;

function doc(id: string, filename: string, docCode: string | null): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("FUND_KITE_CLIENT_ID", "client-1");
  vi.stubEnv("FUND_KITE_CLIENT_SECRET", "secret-1");
  vi.stubEnv("FUND_KIT_TOKEN_ENDPOINT", "");
  vi.stubEnv("FUND_KITE_TOKEN_ENDPOINT", "");
  vi.stubEnv("FUND_KITE_API_BASE", "");
  vi.stubEnv("FUND_KITE_WEBHOOK_SECRET", "hook-secret");
  __testing.reset();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fundkite client", () => {
  it("needs the client secret, not just the id", () => {
    vi.stubEnv("FUND_KITE_CLIENT_SECRET", "");
    expect(isFundkiteConfigured()).toBe(false);
    expect(providerForLender("Fundkite")).toBeNull();
  });

  it("matches the lender name UW assigns", () => {
    expect(providerForLender(" FUNDKITE ")?.id).toBe("fundkite");
  });

  it("mints a client-credentials token, then creates the deal with an Idempotency-Key", async () => {
    vi.stubEnv("FUND_KIT_TOKEN_ENDPOINT", "https://developers.fundkite.com/oauth/token");
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(202, { request_id: "r1", data: { id: "0b9e-uuid", status: "processing", submission_number: null } }));

    const r = await fundkite.createApplication(deal);

    expect(r).toEqual({ ok: true, externalId: "0b9e-uuid" });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://developers.fundkite.com/oauth/token");
    expect(JSON.parse(tokenInit.body)).toEqual({ grant_type: "client_credentials", client_id: "client-1", client_secret: "secret-1" });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://developers.fundkite.com/api/v1/deals");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(init.headers["Idempotency-Key"]).toBe("cb-a-1");
    expect(JSON.parse(init.body).owner_1_ssn).toBe("123456789");
  });

  it("returns Laravel validation errors as field errors on a clean rejection", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(422, { message: "The type of entity is invalid.", errors: { type_of_entity: ["The selected type of entity is invalid."] } }));
    expect(await fundkite.createApplication(deal)).toEqual({
      ok: false,
      error: "The type of entity is invalid.",
      fieldErrors: { type_of_entity: ["The selected type of entity is invalid."] },
      status: 422,
    });
  });

  it("keeps a 5xx or a network failure uncertain", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(503, {}));
    expect((await fundkite.createApplication(deal)).status).toBe(503);
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await fundkite.createApplication(deal)).status).toBe(0);
  });

  it("re-mints once on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("t1"))
      .mockResolvedValueOnce(json(401, { message: "Unauthenticated." }))
      .mockResolvedValueOnce(tokenOk("t2"))
      .mockResolvedValueOnce(json(200, { id: "u", status: "received" }));
    const r = await fundkite.fetchStatus!("u");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer t2");
    expect(fetchMock.mock.calls[3][0]).toBe("https://developers.fundkite.com/api/v1/deals/u");
  });

  it("uploads each document typed, one per request", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("pdf", { headers: { "content-type": "application/pdf" } }))
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(201, { data: { id: "d" } }))
      .mockResolvedValueOnce(new Response("pdf"))
      .mockResolvedValueOnce(json(422, { message: "The file field is required." }));

    const out = await fundkite.uploadDocuments("deal-1", [doc("d1", "march.pdf", "business_bank_statements"), doc("d2", "lease.pdf", "lease_agreement")]);

    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("https://developers.fundkite.com/api/v1/deals/deal-1/documents");
    expect((init.body as FormData).get("type")).toBe("bank_statement");
    expect(((init.body as FormData).get("file") as File).name).toBe("march.pdf");
    expect((fetchMock.mock.calls[4][1].body as FormData).get("type")).toBe("other");
    expect(out).toEqual([
      { documentId: "d1", filename: "march.pdf", stamped: false, accepted: true },
      { documentId: "d2", filename: "lease.pdf", stamped: false, accepted: false, error: "The file field is required." },
    ]);
  });
});

describe("fundkite webhook", () => {
  const body = JSON.stringify({ event: "deal.received", data: { id: "0b9e-uuid", external_id: "cb-a-1" } });

  function req(signature: string | null): Request {
    return new Request("https://vault.example/api/webhooks/lender-api/fundkite", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature ? { "X-Fundkite-Signature": signature } : {}) },
      body,
    });
  }

  it("verifies an HMAC-SHA256 of the raw body, with or without a sha256= prefix", async () => {
    const sig = fundkiteSignature("hook-secret", body);
    expect(await fundkite.webhook!.verify(req(sig))).toBe(true);
    expect(await fundkite.webhook!.verify(req(`sha256=${sig}`))).toBe(true);
  });

  it("rejects a bad or missing signature, and an unset secret", async () => {
    expect(await fundkite.webhook!.verify(req("deadbeef"))).toBe(false);
    expect(await fundkite.webhook!.verify(req(null))).toBe(false);
    vi.stubEnv("FUND_KITE_WEBHOOK_SECRET", "");
    expect(await fundkite.webhook!.verify(req(fundkiteSignature("hook-secret", body)))).toBe(false);
  });

  it("finds the portal deal id and never reads status from the body", () => {
    expect(fundkite.webhook!.extractExternalId(JSON.parse(body))).toBe("0b9e-uuid");
    expect(fundkite.webhook!.extractExternalId({ deal_id: "x" })).toBe("x");
    expect(fundkite.webhook!.extractExternalId({})).toBeNull();
    expect(fundkite.webhook!.statusFromBody).toBeUndefined();
  });
});
