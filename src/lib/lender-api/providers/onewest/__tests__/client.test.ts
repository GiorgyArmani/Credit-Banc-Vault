import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOneWestConfigured } from "../client";
import { onewest } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function doc(id: string, filename: string, docCode = "business_bank_statements"): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ONEWEST_API_USERNAME", "CreditBanc");
  vi.stubEnv("ONEWEST_API_PASSWORD", "pw-1");
  vi.stubEnv("ONEWEST_API_BASE", "");
  vi.stubEnv("ONEWEST_WEBHOOK_TOKEN", "hook-token-123");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("1west client", () => {
  it("needs both credentials", () => {
    vi.stubEnv("ONEWEST_API_PASSWORD", "");
    expect(isOneWestConfigured()).toBe(false);
    expect(providerForLender("1 West")).toBeNull();
  });

  it("matches however the lender row spells the name", () => {
    for (const name of ["1 West", "1West", " one west "]) expect(providerForLender(name)?.id).toBe("onewest");
    expect(providerForLender("United Midwest Bank")).toBeNull();
  });

  it("posts JSON with Basic auth to staging and returns the deal uuid", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: "success", uuid: "uuid-1", redirect_uri: "https://apply.1west.com/x" }));

    const r = await onewest.createApplication({ company: "Acme" });

    expect(r).toEqual({ ok: true, externalId: "uuid-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-staging.1west.com/v1/packages");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("CreditBanc:pw-1").toString("base64")}`);
    expect(JSON.parse(init.body)).toEqual({ company: "Acme" });
  });

  it("a duplicate is a clean 409 rejection", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: "duplicate", status_detail: "This record already exists in our system." }));
    const r = await onewest.createApplication({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.error).toContain("1West already has this business");
  });

  it("reads field errors whether they come as an object or a JSON string", async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { status: "error", errors: '{"business_start_date": "Field business_start_date is required"}' })
    );
    const a = await onewest.createApplication({});
    expect(a).toMatchObject({ ok: false, status: 400, fieldErrors: { business_start_date: ["Field business_start_date is required"] } });
    expect(a.error).toBe("Field business_start_date is required");

    // HTTP 200 with status "error" is still a rejection.
    fetchMock.mockResolvedValueOnce(json(200, { status: "error", errors: { company: "company is required" } }));
    const b = await onewest.createApplication({});
    expect(b).toMatchObject({ ok: false, status: 422 });
  });

  it("a 5xx or a success without a uuid stays uncertain", async () => {
    fetchMock.mockResolvedValueOnce(json(502, {}));
    expect((await onewest.createApplication({})).status).toBe(502);
    fetchMock.mockResolvedValueOnce(json(200, { status: "success", uuid: null }));
    expect(await onewest.createApplication({})).toMatchObject({ ok: false, status: 200 });
  });

  it("uploads each file base64 with its slot, and skips what 1West can't take", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://storage.example/")) return new Response(new Uint8Array([1, 2, 3]));
      return json(200, { status: "success" });
    });

    const results = await onewest.uploadDocuments("uuid-1", [
      doc("d1", "Chase Aug 2026.pdf"),
      doc("d2", "budget.xlsx"),
      doc("d3", "pl.pdf", "profit_loss"),
    ]);

    expect(results.map((r) => [r.documentId, r.accepted, r.unavailable ?? false])).toEqual([
      ["d1", true, false],
      ["d2", false, true],
      ["d3", false, true],
    ]);
    const upload = fetchMock.mock.calls.find(([u]) => String(u).includes("/documents/"));
    expect(upload?.[0]).toBe("https://api-staging.1west.com/v1/documents/uuid-1");
    expect(JSON.parse(upload?.[1].body)).toEqual({ type: "Bank Statement 1", filename: "Chase Aug 2026.pdf", file: "AQID" });
  });

  it("accepts a webhook only with our token in the URL", async () => {
    const hook = (q: string) =>
      new Request(`https://vault.example/api/webhooks/lender-api/onewest${q}`, { method: "POST", body: "{}" });
    expect(await onewest.webhook!.verify(hook("?token=hook-token-123"))).toBe(true);
    expect(await onewest.webhook!.verify(hook("?token=wrong"))).toBe(false);
    expect(await onewest.webhook!.verify(hook(""))).toBe(false);
    vi.stubEnv("ONEWEST_WEBHOOK_TOKEN", "");
    expect(await onewest.webhook!.verify(hook("?token="))).toBe(false);
  });
});
