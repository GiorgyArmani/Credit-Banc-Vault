import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isVitalConfigured } from "../client";
import { vital } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();
const BASE = "https://sandbox.vital.example/backend/api/partners";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function doc(id: string, filename: string, docCode = "business_bank_statements"): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VITAL_API_KEY", "key-1");
  vi.stubEnv("VITAL_API_BASE", `${BASE}/`);
  vi.stubEnv("VITAL_WEBHOOK_SECRET", "hook-secret-123");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("vital client", () => {
  it("needs the key AND an explicit base URL (no default host)", () => {
    vi.stubEnv("VITAL_API_BASE", "");
    expect(isVitalConfigured()).toBe(false);
    expect(providerForLender("Vital Cap")).toBeNull();
    vi.stubEnv("VITAL_API_BASE", BASE);
    vi.stubEnv("VITAL_API_KEY", "");
    expect(isVitalConfigured()).toBe(false);
  });

  it("matches however the lender row spells the name", () => {
    for (const name of ["Vital Cap", " vital capital ", "Vital", "Vital Cap Fund"]) expect(providerForLender(name)?.id).toBe("vital");
    expect(providerForLender("Vitality Funding")).toBeNull();
  });

  it("posts JSON with X-API-KEY and returns the submission id", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 9001, business: { id: 4455 } }));

    const r = await vital.createApplication({ business: { name: "Acme" } });

    expect(r).toEqual({ ok: true, externalId: "9001" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/deal-submission`);
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-KEY"]).toBe("key-1");
    expect(JSON.parse(init.body)).toEqual({ business: { name: "Acme" } });
  });

  it("a 4xx is a clean rejection carrying Vital's message", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { message: "telephone is required" }));
    const r = await vital.createApplication({});
    expect(r).toEqual({ ok: false, error: "telephone is required", status: 400 });
  });

  it("a 500, a timeout and a 2xx without an id are all uncertain", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { message: "Internal Server Error" }));
    expect(await vital.createApplication({})).toEqual({ ok: false, error: "Internal Server Error", status: 500 });

    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await vital.createApplication({})).toEqual({ ok: false, error: "Could not reach Vital Cap", status: 0 });

    fetchMock.mockResolvedValueOnce(json(200, { business: { id: 4455 } }));
    expect(await vital.createApplication({})).toEqual({ ok: false, error: "Vital Cap did not return a submission id", status: 0 });
  });

  it("never surfaces the gateway's HTML error page", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>401 Unauthorized</html>", { status: 401 }));
    const r = await vital.createApplication({});
    expect(r.error).toBe("Vital Cap rejected our API key");
  });
});

describe("vital documents", () => {
  it("uploads each file base64 under its category", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(Buffer.from("PDFBYTES"), { status: 200 }))
      .mockResolvedValueOnce(json(200, { id: 1 }));

    const results = await vital.uploadDocuments("9001", [doc("d1", "Chase Aug 2026.pdf")]);

    expect(results).toEqual([{ documentId: "d1", filename: "Chase Aug 2026.pdf", stamped: false, accepted: true }]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/deal-submission/9001/document`);
    expect(JSON.parse(init.body)).toEqual({
      name: "Chase Aug 2026",
      filename: "Chase Aug 2026.pdf",
      category: "Bank Statements",
      content: Buffer.from("PDFBYTES").toString("base64"),
    });
  });

  it("marks a file with no category unavailable without calling Vital", async () => {
    const results = await vital.uploadDocuments("9001", [doc("d1", "lease.pdf", "lease_agreement")]);
    expect(results[0]).toMatchObject({ accepted: false, unavailable: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected file and keeps going", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(Buffer.from("A"), { status: 200 }))
      .mockResolvedValueOnce(json(500, { message: "Unsuccessful Submission" }))
      .mockResolvedValueOnce(new Response(Buffer.from("B"), { status: 200 }))
      .mockResolvedValueOnce(json(200, { id: 2 }));

    const results = await vital.uploadDocuments("9001", [doc("d1", "a.pdf"), doc("d2", "b.pdf", "signed_application")]);

    expect(results[0]).toMatchObject({ accepted: false, error: "Unsuccessful Submission" });
    expect(results[0].unavailable).toBeUndefined();
    expect(results[1]).toMatchObject({ accepted: true });
  });
});

describe("vital status", () => {
  it("fetches the submission and strips it to status fields", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { id: 9001, business: { id: 4455, status: "Declined", owners: [{ socialSecurityNumber: "123456789" }] } })
    );

    const r = await vital.fetchStatus!("9001");

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/deal-submission/9001`);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(r).toEqual({ ok: true, raw: { id: "9001", dealId: "4455", statuses: { status: "Declined" } } });
    expect(vital.interpretStatus(r.raw).kind).toBe("declined");
  });

  it("reports a failed status request", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { message: "Deal Submission Does Not Exist" }));
    expect(await vital.fetchStatus!("1")).toEqual({ ok: false, error: "Deal Submission Does Not Exist" });
  });
});

describe("vital webhook", () => {
  const url = "https://vault.example/api/webhooks/lender-api/vital";
  const req = (suffix = "", headers: Record<string, string> = {}) => new Request(`${url}${suffix}`, { method: "POST", headers });

  it("accepts our secret on the URL or as a Bearer header", async () => {
    expect(await vital.webhook!.verify(req("?token=hook-secret-123"))).toBe(true);
    expect(await vital.webhook!.verify(req("", { Authorization: "Bearer hook-secret-123" }))).toBe(true);
  });

  it("rejects a wrong or missing secret", async () => {
    expect(await vital.webhook!.verify(req("?token=nope"))).toBe(false);
    expect(await vital.webhook!.verify(req())).toBe(false);
  });

  it("rejects everything when no secret is configured", async () => {
    vi.stubEnv("VITAL_WEBHOOK_SECRET", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await vital.webhook!.verify(req("?token="))).toBe(false);
    spy.mockRestore();
  });

  it("has no statusFromBody: a callback is only a signal to re-fetch", () => {
    expect(vital.webhook!.statusFromBody).toBeUndefined();
    expect(vital.webhook!.extractExternalId({ submissionId: 9001 })).toBe("9001");
  });
});
