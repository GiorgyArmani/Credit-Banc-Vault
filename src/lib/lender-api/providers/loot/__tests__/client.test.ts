import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, isLootConfigured, submitCustomerApplication } from "../client";
import { loot, lootDuplicateExplanation, lootSignature } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const tokenOk = (token = "tok-1") => json(200, { statusCode: 200, data: { access_token: token, token_type: "Bearer", expires_in: 3600 } });
const created = (id = "deal-1") => json(200, { statusCode: 200, data: { deal: { deal_id: id, business_name: "X", owner_name: "Y" } } });

function doc(id: string, filename: string): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode: "business_bank_statements", stamped: false };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("LOOT_CLIENT_ID", "client-1");
  vi.stubEnv("LOOT_SECRET_KEY", "secret-1");
  vi.stubEnv("LOOT_API_BASE", "");
  vi.stubEnv("LOOT_WEBHOOK_SECRET", "webhook-secret-123456");
  __testing.reset();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("loot client", () => {
  it("needs both credentials", () => {
    vi.stubEnv("LOOT_SECRET_KEY", "");
    expect(isLootConfigured()).toBe(false);
    expect(providerForLender("Loot")).toBeNull();
  });

  it("matches the lender name UW assigns", () => {
    expect(providerForLender(" loot ")?.id).toBe("loot");
  });

  it("gets a token with Basic auth against staging, then posts multipart with the bearer", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(created("abc"));

    const r = await loot.createApplication({ email: "a@b.co", "owners[0][ssn]": "123456789" });

    expect(r).toEqual({ ok: true, externalId: "abc" });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://api-dev.getloot.com/api/v1/external/auth/token");
    expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from("client-1:secret-1").toString("base64")}`);
    expect(tokenInit.body).toBe("grant_type=client_credentials");

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api-dev.getloot.com/api/v1/external/partner/submit/customer-application");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    // fetch must set the multipart boundary itself.
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("owners[0][ssn]")).toBe("123456789");
  });

  it("caches the token and re-mints once on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("t1"))
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(json(401, { statusCode: 401 }))
      .mockResolvedValueOnce(tokenOk("t2"))
      .mockResolvedValueOnce(created());

    await submitCustomerApplication({});
    await submitCustomerApplication({});

    expect(fetchMock.mock.calls.map((c) => c[0].split("/").pop())).toEqual([
      "token",
      "customer-application",
      "customer-application",
      "token",
      "customer-application",
    ]);
    expect(fetchMock.mock.calls[4][1].headers.Authorization).toBe("Bearer t2");
  });

  it("reports a 400 as a clean rejection with Loot's message", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(400, { statusCode: 400, message: "requestingAmount must be a number" }));
    expect(await loot.createApplication({})).toEqual({ ok: false, error: "requestingAmount must be a number", status: 400 });
  });

  it.each([
    "Email already exists",
    "User has been previously funded or has active advance",
    "Duplicate EIN",
    "A deal with this EIN already exists",
  ])("explains a duplicate rejection (%s) and keeps Loot's words", async (message) => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(400, { statusCode: 400, message }));
    const r = await loot.createApplication({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toContain("Loot already has this business");
    expect(r.error).toContain(`Loot said: ${message}`);
  });

  it("does not read an EIN format error as a duplicate", () => {
    expect(lootDuplicateExplanation("ein must be 9 digits")).toBeNull();
  });

  it("reports a 5xx and a network failure as uncertain", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(502, {}));
    expect((await loot.createApplication({})).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await loot.createApplication({})).status).toBe(0);
  });

  it("uploads each file on its own and reports each verdict", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("pdf-bytes", { headers: { "content-type": "application/pdf" } }))
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(200, { statusCode: 200, data: {} }))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }))
      .mockResolvedValueOnce(new Response("x"))
      .mockResolvedValueOnce(json(400, { statusCode: 400, message: "No attachments founds" }));

    const out = await loot.uploadDocuments("deal-1", [doc("d1", "a.pdf"), doc("d2", "b.pdf"), doc("d3", "c.pdf")]);

    const upload = fetchMock.mock.calls[2][1].body as FormData;
    expect(upload.get("dealId")).toBe("deal-1");
    expect((upload.get("attachments") as File).name).toBe("a.pdf");
    expect(out).toEqual([
      { documentId: "d1", filename: "a.pdf", stamped: false, accepted: true },
      expect.objectContaining({ documentId: "d2", accepted: false, unavailable: true }),
      expect.objectContaining({ documentId: "d3", accepted: false, error: "No attachments founds" }),
    ]);
    // A lender-side rejection stays retryable.
    expect(out[2].unavailable).toBeUndefined();
  });

  it("has no status API", () => {
    expect(loot.fetchStatus).toBeUndefined();
  });
});

describe("loot webhook", () => {
  const body = { apiVersion: "v1", nonce: "abc123", eventType: "DEAL_DECISION", createdAt: "2026-09-24T12:00:00.000Z", data: { deal: { deal_id: "D1" } } };
  const sig = lootSignature("webhook-secret-123456", body.nonce, body.eventType, body.createdAt);

  function req(signature: string | null, payload: unknown = body, inBody = false): Request {
    const b = inBody && signature ? { ...(payload as object), signature } : payload;
    return new Request("https://vault.example/api/webhooks/lender-api/loot", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature && !inBody ? { "x-loot-webhook-signature": signature } : {}) },
      body: JSON.stringify(b),
    });
  }

  it("accepts their HMAC-SHA512 in the header or the body", async () => {
    expect(sig).toHaveLength(128);
    expect(await loot.webhook!.verify(req(sig))).toBe(true);
    expect(await loot.webhook!.verify(req(sig, body, true))).toBe(true);
  });

  it("rejects a wrong or missing signature, a tampered envelope, and an unset secret", async () => {
    expect(await loot.webhook!.verify(req("00".repeat(64)))).toBe(false);
    expect(await loot.webhook!.verify(req(null))).toBe(false);
    expect(await loot.webhook!.verify(req(sig, { ...body, createdAt: "2026-09-25T12:00:00.000Z" }))).toBe(false);
    vi.stubEnv("LOOT_WEBHOOK_SECRET", "");
    expect(await loot.webhook!.verify(req(sig))).toBe(false);
  });

  it("leaves the body readable for the route", async () => {
    const r = req(sig);
    await loot.webhook!.verify(r);
    expect(await r.json()).toEqual(body);
  });
});
