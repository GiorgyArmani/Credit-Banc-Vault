import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBittyConfigured } from "../client";
import { bitty } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";
import type { BittySubmission } from "../mapping";

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const file = (bytes: string) => new Response(bytes, { status: 200 });

const payload = { leadid: "cb-a-1", legal_name: "Doe Plumbing LLC", owners: [] } as unknown as BittySubmission;

function doc(id: string, filename: string, docCode: string | null = "business_bank_statements"): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("BITTY_API_KEY", "bitty-key");
  vi.stubEnv("BITTY_API_BASE", "");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bitty client", () => {
  it("is hidden without an API key", () => {
    vi.stubEnv("BITTY_API_KEY", "");
    expect(isBittyConfigured()).toBe(false);
    expect(providerForLender("Bitty")).toBeNull();
  });

  it("matches the lender name UW assigns", () => {
    expect(providerForLender(" bitty ")?.id).toBe("bitty");
  });

  it("posts to development with the key in the body and development: true", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, message: "Declined", id: 5, reason: ["Minimum Revenue"] }));
    const r = await bitty.createApplication(payload, { documents: [] });

    expect(r).toMatchObject({ ok: true, externalId: "5" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dev.bittyadvance.com/api/submit");
    const body = JSON.parse(init.body);
    expect(body.apikey).toBe("bitty-key");
    expect(body.development).toBe(true);
    expect(body.leadid).toBe("cb-a-1");
    expect(body).not.toHaveProperty("files");
  });

  it("only drops the development flag on the production base", async () => {
    vi.stubEnv("BITTY_API_BASE", "https://broker.bittyadvance.com");
    fetchMock.mockResolvedValueOnce(json(200, { success: true, message: "Approved", id: 9 }));
    await bitty.createApplication(payload, { documents: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://broker.bittyadvance.com/api/submit");
    expect(JSON.parse(init.body)).not.toHaveProperty("development");
  });

  it("sends files inline as typed base64 and reports each one", async () => {
    fetchMock
      .mockResolvedValueOnce(file("pdf-bytes"))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }))
      .mockResolvedValueOnce(json(200, { success: true, message: "Approved", id: 9 }));

    const r = await bitty.createApplication(payload, {
      documents: [doc("d1", "March.pdf"), doc("d2", "April.pdf"), doc("d3", "Model.xlsx", null)],
    });

    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body.files).toEqual([{ file: Buffer.from("pdf-bytes").toString("base64"), file_name: "March.pdf", type: 2 }]);
    expect(r.attachments).toEqual([
      { documentId: "d1", filename: "March.pdf", stamped: false, accepted: true },
      expect.objectContaining({ documentId: "d2", accepted: false, unavailable: true }),
      expect.objectContaining({ documentId: "d3", accepted: false, unavailable: true, error: "Bitty does not accept .xlsx files" }),
    ]);
  });

  it("caps files at 20", async () => {
    const docs = Array.from({ length: 21 }, (_, i) => doc(`d${i}`, `f${i}.pdf`));
    for (let i = 0; i < 20; i++) fetchMock.mockResolvedValueOnce(file("x"));
    fetchMock.mockResolvedValueOnce(json(200, { success: true, message: "Approved", id: 9 }));

    const r = await bitty.createApplication(payload, { documents: docs });
    expect(JSON.parse(fetchMock.mock.calls[20][1].body).files).toHaveLength(20);
    expect(r.attachments?.find((a) => a.documentId === "d20")).toMatchObject({ accepted: false, unavailable: true });
  });

  it("reports a network failure as uncertain (status 0)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const r = await bitty.createApplication(payload, { documents: [] });
    expect(r).toMatchObject({ ok: false, status: 0 });
  });

  it("has no status API and settles retried files as unavailable", async () => {
    expect(bitty.fetchStatus).toBeUndefined();
    const out = await bitty.uploadDocuments("5", [doc("d1", "a.pdf")]);
    expect(out[0]).toMatchObject({ accepted: false, unavailable: true });
  });
});
