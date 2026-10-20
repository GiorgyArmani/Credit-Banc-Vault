import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSamsonConfigured } from "../client";
import { samson } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();
const BASE = "https://samson.example/services/apexrest/SamsonAPI";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function doc(id: string, docCode: string | null = "business_bank_statements"): OutboundDocument {
  return { documentId: id, filename: `${id}.pdf`, url: `https://storage.example/${id}`, docCode, stamped: false };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SAMSON_FUNDING_API_BASE", `${BASE}/`);
  vi.stubEnv("SAMSON_FUNDING_API_KEY", "key-1");
  vi.stubEnv("SAMSON_FUNDING_PARTNER_NAME", "Credit Banc");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("samson client", () => {
  it("needs base, key and partner name; matches the lender row", () => {
    expect(providerForLender("Samson Funding")?.id).toBe("samson");
    expect(providerForLender("  samson ")?.id).toBe("samson");
    vi.stubEnv("SAMSON_FUNDING_PARTNER_NAME", "");
    expect(isSamsonConfigured()).toBe(false);
    expect(providerForLender("Samson Funding")).toBeNull();
  });

  it("creates a record with both auth headers and returns the opportunity id", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { Status: "Success", Message: "Records created successfully", OpportunityId: "006X" }));
    const res = await samson.createApplication({ business: {} });
    expect(res).toEqual({ ok: true, externalId: "006X" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.headers).toMatchObject({ "API-Key": "key-1", "Partner-Name": "Credit Banc", "Content-Type": "application/json" });
  });

  it("a 401 is a clean rejection with their message", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { Status: "Error", Message: "Unauthorized: Invalid API Key or Partner Name" }));
    const res = await samson.createApplication({});
    expect(res).toMatchObject({ ok: false, status: 401, error: "Samson Funding: Unauthorized: Invalid API Key or Partner Name" });
  });

  it("a 200 carrying Status Error is a failure, not a success", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { Status: "Error", Message: "Missing name" }));
    const res = await samson.createApplication({});
    expect(res).toMatchObject({ ok: false, status: 200, error: "Samson Funding: Missing name" });
  });

  it("a 2xx without an id or a network failure is uncertain (status 0)", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { Status: "Success" }));
    expect(await samson.createApplication({})).toMatchObject({ ok: false, status: 0 });
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await samson.createApplication({})).toMatchObject({ ok: false, status: 0 });
  });

  it("uploads each file base64 to /uploadFile with its doc type; unknown codes are terminal", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("PDFBYTES", { status: 200 }))
      .mockResolvedValueOnce(json(201, { Message: "File uploaded successfully", Status: "Success" }));
    const results = await samson.uploadDocuments("006X", [doc("a"), doc("b", "articles_of_incorporation")]);
    expect(results).toEqual([
      { documentId: "a", filename: "a.pdf", stamped: false, accepted: true },
      expect.objectContaining({ documentId: "b", accepted: false, unavailable: true }),
    ]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/uploadFile`);
    expect(JSON.parse(init.body)).toEqual({
      oppId: "006X",
      fileName: "a.pdf",
      docType: "Bank Statements",
      fileData: Buffer.from("PDFBYTES").toString("base64"),
    });
  });

  it("a rejected upload stays retryable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("PDFBYTES", { status: 200 }))
      .mockResolvedValueOnce(json(400, { Status: "Error", Message: "Invalid docType" }));
    const [r] = await samson.uploadDocuments("006X", [doc("a")]);
    expect(r).toMatchObject({ accepted: false, error: "Samson Funding: Invalid docType" });
    expect(r.unavailable).toBeUndefined();
  });
});
