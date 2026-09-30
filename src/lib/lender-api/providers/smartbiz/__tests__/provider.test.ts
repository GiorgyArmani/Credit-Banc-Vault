import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";
import { parseSmartBizEvent, smartbiz, smartBizSignature } from "../index";
import type { SmartBizApplication } from "../mapping";

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const app = {
  business: { name: "Doe", owners: [] },
  submission: { loan_application: { amount_requested: 100000 }, client_reference_id: "ref-1", business_history: {} },
  clientReferenceId: "ref-1",
} as unknown as SmartBizApplication;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SMARTBIZ_PARTNER_ID", "123");
  vi.stubEnv("SMARTBIZ_TOKEN", "tok");
  vi.stubEnv("SMARTBIZ_API_BASE", "");
  vi.stubEnv("SMARTBIZ_WEBHOOK_SECRET", "hook-secret");
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("smartbiz provider", () => {
  it("matches the lender name UW assigns, only when configured", () => {
    expect(providerForLender(" smartbiz ")?.id).toBe("smartbiz");
    vi.stubEnv("SMARTBIZ_TOKEN", "");
    expect(providerForLender("SmartBiz")).toBeNull();
  });

  it("creates the business, then the submission on it; the submission id is the external id", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { id: "b-1" } })).mockResolvedValueOnce(json(201, { data: { id: "s-1" } }));
    expect(await smartbiz.createApplication(app)).toEqual({ ok: true, externalId: "s-1", providerState: { business_id: "b-1" } });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ business_id: "b-1", client_reference_id: "ref-1" });
  });

  it("reuses a known business: submission only, no second business", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { id: "s-2" } }));
    const r = await smartbiz.createApplication(app, { priorState: { business_id: "b-1" } });
    expect(r).toEqual({ ok: true, externalId: "s-2", providerState: { business_id: "b-1" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/v3/submission/");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ business_id: "b-1" });
  });

  it("a known business SmartBiz doesn't recognise (404) is created afresh", async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { errors: [{ title: "Not Found" }] }))
      .mockResolvedValueOnce(json(201, { data: { id: "b-9" } }))
      .mockResolvedValueOnce(json(201, { data: { id: "s-9" } }));
    const r = await smartbiz.createApplication(app, { priorState: { business_id: "b-stale" } });
    expect(r).toEqual({ ok: true, externalId: "s-9", providerState: { business_id: "b-9" } });
    expect(fetchMock.mock.calls[1][0]).toContain("/v3/business/");
  });

  it("a submission rejected on a known business keeps the business and never creates another", async () => {
    fetchMock.mockResolvedValueOnce(json(422, { errors: [{ title: "Input validation errors", detail: "amount" }] }));
    const r = await smartbiz.createApplication(app, { priorState: { business_id: "b-1" } });
    expect(r).toMatchObject({ ok: false, status: 422, providerState: { business_id: "b-1" } });
    expect(r.error).toContain("b-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a duplicate business is a clean rejection with an actionable message", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { errors: [{ status: 400, title: "Bad Request", detail: "Email already exists" }] }));
    const r = await smartbiz.createApplication(app);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(r.error).toContain("SmartBiz already has this business");
    expect(r.error).toContain("SmartBiz said: Bad Request: Email already exists");
  });

  it("submission rejected after business created names the business id", async () => {
    fetchMock
      .mockResolvedValueOnce(json(201, { data: { id: "b-77" } }))
      .mockResolvedValueOnce(json(422, { errors: [{ status: 422, title: "Input validation errors", detail: "amount" }] }));
    const r = await smartbiz.createApplication(app);
    expect(r).toMatchObject({ ok: false, status: 422, providerState: { business_id: "b-77" } });
    expect(r.error).toContain("b-77");
  });

  it("business created but the submission call timed out is uncertain (status 0) and names the business id", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { id: "b-78" } })).mockRejectedValueOnce(new Error("timeout"));
    const r = await smartbiz.createApplication(app);
    expect(r.status).toBe(0);
    expect(r.error).toContain("b-78");
    expect(r.providerState).toEqual({ business_id: "b-78" });
  });

  it("a 2xx business without an id is uncertain", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: {} }));
    expect((await smartbiz.createApplication(app)).status).toBe(0);
  });

  it("uploads each file with its SmartBiz document type", async () => {
    const doc = (id: string, filename: string, docCode: string | null): OutboundDocument => ({
      documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false,
    });
    fetchMock
      .mockResolvedValueOnce(new Response("pdf", { headers: { "content-type": "application/pdf" } }))
      .mockResolvedValueOnce(new Response("null", { status: 202 }))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const results = await smartbiz.uploadDocuments("s-1", [doc("d1", "Aug.pdf", "business_bank_statements"), doc("d2", "x.pdf", "profit_loss")]);
    expect((fetchMock.mock.calls[1][1].body as FormData).get("document_type")).toBe("bank_statement");
    expect(results).toEqual([
      { documentId: "d1", filename: "Aug.pdf", stamped: false, accepted: true },
      expect.objectContaining({ documentId: "d2", accepted: false, unavailable: true }),
    ]);
  });
});

describe("smartbiz webhook", () => {
  const raw = JSON.stringify({
    specversion: "1.0.0",
    type: "com.smartbizloans.submission.loan_application.state_updated",
    data: '{"business_id": "b-1", "client_reference_id": "ref-1", "current_state": "declined"}',
  });
  const sign = (ts: string, body: string) => createHmac("sha256", "hook-secret").update(ts + body).digest("base64");
  const req = (headers: Record<string, string>, body = raw) =>
    new Request("https://vault.example/api/webhooks/lender-api/smartbiz", { method: "POST", headers, body });

  it("verifies base64 HMAC-SHA256 over timestamp + raw body", async () => {
    expect(smartBizSignature("hook-secret", "1700000000", raw)).toBe(sign("1700000000", raw));
    expect(await smartbiz.webhook!.verify(req({ "http-timestamp": "1700000000", "http-sbabiz-signature": sign("1700000000", raw) }))).toBe(true);
    expect(await smartbiz.webhook!.verify(req({ "http-timestamp": "1700000001", "http-sbabiz-signature": sign("1700000000", raw) }))).toBe(false);
    expect(await smartbiz.webhook!.verify(req({ "http-timestamp": "1700000000" }))).toBe(false);
  });

  it("rejects everything when no secret is configured", async () => {
    vi.stubEnv("SMARTBIZ_WEBHOOK_SECRET", "");
    expect(await smartbiz.webhook!.verify(req({ "http-timestamp": "1", "http-sbabiz-signature": sign("1", raw) }))).toBe(false);
  });

  it("resolves from string and object data", async () => {
    expect(parseSmartBizEvent(JSON.parse(raw))).toEqual({ business_id: "b-1", client_reference_id: "ref-1", current_state: "declined" });
    expect(parseSmartBizEvent({ data: { client_reference_id: "ref-2" } })).toEqual({ client_reference_id: "ref-2" });
    expect(parseSmartBizEvent({ data: "not json" })).toBeNull();

    fetchMock.mockResolvedValueOnce(json(200, { data: [{ id: "s-1", type: "submission" }], meta: {} }));
    expect(await smartbiz.webhook!.resolveExternalId!(JSON.parse(raw))).toBe("s-1");
  });

  it("resolves to null when the reference is unknown or absent", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [], meta: {} }));
    expect(await smartbiz.webhook!.resolveExternalId!(JSON.parse(raw))).toBeNull();
    expect(await smartbiz.webhook!.resolveExternalId!({ data: "{}" })).toBeNull();
  });

  it("throws when the SmartBiz search itself fails (HTTP error) so the route answers 503 and SmartBiz retries", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { errors: [{ status: 500, title: "Server Error" }] }));
    await expect(smartbiz.webhook!.resolveExternalId!(JSON.parse(raw))).rejects.toThrow(/SmartBiz search failed/);
  });

  it("throws when the SmartBiz search can't be reached (network)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(smartbiz.webhook!.resolveExternalId!(JSON.parse(raw))).rejects.toThrow(/SmartBiz search failed/);
  });
});
