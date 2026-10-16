import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isArfConfigured } from "../client";
import { arf } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();
const BASE = "https://partners.dragin.example";
const TOKEN = "isop_a1B2c3D4.k9L0mN1oP2";
const JOB = "EXTDS-3f8a1c92-5b7d-4e21-9a6f-0c4d8e2b1f37";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function bytes(content: string): Response {
  return new Response(Buffer.from(content), { status: 200 });
}

function doc(id: string, filename: string, docCode = "business_bank_statements"): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

const APP = doc("app", "application.pdf", "signed_application");

async function partsOf(init: { body: FormData }) {
  const out: Array<[string, string]> = [];
  for (const [key, value] of init.body.entries()) {
    out.push([key, typeof value === "string" ? value : `${value.name}:${await value.text()}`]);
  }
  return out;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ARF_API_BASE", `${BASE}/`);
  vi.stubEnv("ARF_API_TOKEN", TOKEN);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("arf client", () => {
  it("needs the base URL and the token (no default host)", () => {
    vi.stubEnv("ARF_API_BASE", "");
    expect(isArfConfigured()).toBe(false);
    expect(providerForLender("ARF")).toBeNull();
    vi.stubEnv("ARF_API_BASE", BASE);
    vi.stubEnv("ARF_API_TOKEN", "");
    expect(isArfConfigured()).toBe(false);
  });

  it("matches the lender row and nothing longer", () => {
    expect(providerForLender(" arf ")?.id).toBe("arf");
    expect(providerForLender("ARF Capital Partners")).toBeNull();
  });

  it("sends every file as a `files` part with our reference as the idempotency key", async () => {
    fetchMock
      .mockResolvedValueOnce(bytes("APP"))
      .mockResolvedValueOnce(bytes("JUNE"))
      .mockResolvedValueOnce(json(202, { jobId: JOB, status: "queued" }));

    const r = await arf.createApplication({ referenceId: "cb-assign-1-1" }, { documents: [APP, doc("s1", "statement-june.pdf")] });

    expect(r).toEqual({
      ok: true,
      externalId: JOB,
      attachments: [
        { documentId: "app", filename: "application.pdf", stamped: false, accepted: true },
        { documentId: "s1", filename: "statement-june.pdf", stamped: false, accepted: true },
      ],
    });
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe(`${BASE}/api/v1/external/deal-submission`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers["Idempotency-Key"]).toBe("cb-assign-1-1");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(await partsOf(init)).toEqual([
      ["files", "application.pdf:APP"],
      ["files", "statement-june.pdf:JUNE"],
    ]);
  });

  it("refuses to send a packet with no signed application, before calling ARF", async () => {
    fetchMock.mockResolvedValueOnce(bytes("JUNE"));
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [doc("s1", "statement-june.pdf")] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error).toContain("signed application");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses when the application itself could not be read", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(bytes("JUNE"));
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP, doc("s1", "statement-june.pdf")] });
    expect(r.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends without an unreadable supporting file and leaves it retryable", async () => {
    fetchMock
      .mockResolvedValueOnce(bytes("APP"))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(json(202, { jobId: JOB, status: "queued" }));

    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP, doc("s1", "statement-june.pdf")] });

    expect(r.ok).toBe(true);
    expect(r.attachments?.[1]).toEqual({
      documentId: "s1",
      filename: "statement-june.pdf",
      stamped: false,
      accepted: false,
      error: "Could not read the file (HTTP 500)",
    });
  });

  it("a 4xx is a clean rejection; a 5xx, a timeout and a 202 without a job id are uncertain", async () => {
    fetchMock.mockResolvedValueOnce(bytes("APP")).mockResolvedValueOnce(json(400, { detail: "files is required" }));
    expect(await arf.createApplication({ referenceId: "r" }, { documents: [APP] })).toEqual({
      ok: false,
      error: "files is required",
      status: 400,
    });

    fetchMock.mockResolvedValueOnce(bytes("APP")).mockResolvedValueOnce(json(503, {}));
    expect((await arf.createApplication({ referenceId: "r" }, { documents: [APP] })).status).toBe(503);

    fetchMock.mockResolvedValueOnce(bytes("APP")).mockRejectedValueOnce(new Error("timeout"));
    expect((await arf.createApplication({ referenceId: "r" }, { documents: [APP] })).status).toBe(0);

    fetchMock.mockResolvedValueOnce(bytes("APP")).mockResolvedValueOnce(json(202, { status: "queued" }));
    expect(await arf.createApplication({ referenceId: "r" }, { documents: [APP] })).toEqual({
      ok: false,
      error: "ARF did not return a job id",
      status: 0,
    });
  });

  it("explains a bare 401", async () => {
    fetchMock.mockResolvedValueOnce(bytes("APP")).mockResolvedValueOnce(new Response("", { status: 401 }));
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP] });
    expect(r).toEqual({ ok: false, error: "ARF rejected our API credential", status: 401 });
  });
});

describe("arf additional documents", () => {
  it("attaches later files to the original job", async () => {
    fetchMock.mockResolvedValueOnce(bytes("AUG")).mockResolvedValueOnce(json(202, { jobId: "EXTDD-1", status: "queued" }));

    const results = await arf.uploadDocuments(JOB, [doc("s2", "statement-august.pdf")]);

    expect(results).toEqual([{ documentId: "s2", filename: "statement-august.pdf", stamped: false, accepted: true }]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${BASE}/api/v1/external/deal-documents`);
    expect(await partsOf(init)).toEqual([
      ["jobId", JOB],
      ["files", "statement-august.pdf:AUG"],
    ]);
  });

  it("a 409 means the original is still processing: retry later, nothing lost", async () => {
    fetchMock
      .mockResolvedValueOnce(bytes("AUG"))
      .mockResolvedValueOnce(json(409, { detail: "The original submission is still being processed" }, { "Retry-After": "120" }));

    const results = await arf.uploadDocuments(JOB, [doc("s2", "statement-august.pdf")]);

    expect(results[0]).toMatchObject({ accepted: false, error: "ARF is still processing the original submission. Retry in 2 minutes." });
    expect(results[0].unavailable).toBeUndefined();
  });

  it("does not call ARF when no file could be read", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const results = await arf.uploadDocuments(JOB, [doc("s2", "statement-august.pdf")]);
    expect(results[0]).toMatchObject({ accepted: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("arf status", () => {
  it("polls the job and reads the HTTP code", async () => {
    fetchMock.mockResolvedValueOnce(json(202, { jobId: JOB, status: "processing" }));
    expect(await arf.fetchStatus!(JOB)).toEqual({ ok: true, raw: { jobId: JOB, status: "processing" } });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/external/jobs/${JOB}`);

    fetchMock.mockResolvedValueOnce(json(200, { jobId: JOB, status: "submitted" }));
    expect(await arf.fetchStatus!(JOB)).toEqual({ ok: true, raw: { jobId: JOB, status: "submitted" } });
  });

  it("a 500 is a job needing attention, not a failed request", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { detail: "processing failed" }));
    const r = await arf.fetchStatus!(JOB);
    expect(r).toEqual({ ok: true, raw: { jobId: JOB, status: "failed" } });
    expect(arf.interpretStatus(r.raw).kind).toBe("needs_info");
  });

  it("a 404 or a gateway error is a failed request", async () => {
    fetchMock.mockResolvedValueOnce(json(404, {}));
    expect(await arf.fetchStatus!(JOB)).toEqual({ ok: false, error: "ARF has no job with this id under our credential" });
    fetchMock.mockResolvedValueOnce(json(502, {}));
    expect((await arf.fetchStatus!(JOB)).ok).toBe(false);
  });

  it("has no webhook: ARF never calls back", () => {
    expect(arf.webhook).toBeUndefined();
  });
});

describe("arf packet limits (guide §8)", () => {
  /** Storage answers `size` bytes per file; ARF answers 202. */
  function serve(size: (id: string) => number) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("https://storage.example/")) {
        const id = String(url).split("/").pop() as string;
        return new Response(Buffer.alloc(size(id)), { status: 200 });
      }
      return json(202, { jobId: JOB, status: "queued" });
    });
  }
  const sentNames = async () => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/deal-submission"));
    return (await partsOf(call![1])).map(([, v]) => v.split(":")[0]);
  };

  it("never sends a file type ARF rejects, and never fetches it", async () => {
    serve(() => 10);
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP, doc("x", "pl.xlsx"), doc("h", "IMG_1.HEIC")] });
    expect(r.ok).toBe(true);
    expect(await sentNames()).toEqual(["application.pdf"]);
    expect(r.attachments?.filter((a) => !a.accepted).every((a) => a.unavailable && /convert this file to PDF/.test(a.error ?? ""))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => /\/(x|h)$/.test(String(url)))).toBe(false);
  });

  it("accepts every image type in the guide, any case", async () => {
    serve(() => 10);
    const names = ["a.JPG", "b.jpeg", "c.png", "d.tif", "e.TIFF", "f.gif", "g.bmp"];
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP, ...names.map((n, i) => doc(`i${i}`, n))] });
    expect(r.attachments?.every((a) => a.accepted)).toBe(true);
  });

  it("refuses a file over 25 MB as terminal", async () => {
    serve((id) => (id === "big" ? 25 * 1024 * 1024 + 1 : 10));
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP, doc("big", "big.pdf")] });
    expect(r.attachments?.[1]).toMatchObject({ accepted: false, unavailable: true, error: expect.stringContaining("25 MB") });
  });

  it("puts the application first and leaves what doesn't fit in 30 files retryable", async () => {
    serve(() => 10);
    const statements = Array.from({ length: 30 }, (_, i) => doc(`s${i}`, `s${i}.pdf`));
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [...statements, APP] });
    const names = await sentNames();
    expect(names).toHaveLength(30);
    expect(names[0]).toBe("application.pdf");
    const left = r.attachments?.filter((a) => !a.accepted) ?? [];
    expect(left).toHaveLength(1);
    expect(left[0].unavailable).toBeUndefined();
    expect(left[0].error).toContain("Retry failed files");
  });

  it("keeps a request under 150 MB", async () => {
    serve((id) => (id === "app" ? 10 : 20 * 1024 * 1024));
    const statements = Array.from({ length: 8 }, (_, i) => doc(`s${i}`, `s${i}.pdf`));
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [APP, ...statements] });
    expect(await sentNames()).toHaveLength(8); // app + 7 × 20 MB = 140 MB; the 8th would pass 150
    expect(r.attachments?.filter((a) => !a.accepted)).toHaveLength(1);
  });

  it("a non-PDF application is refused before calling ARF", async () => {
    serve(() => 10);
    const r = await arf.createApplication({ referenceId: "r" }, { documents: [doc("app", "application.docx", "signed_application")] });
    expect(r).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("convert this file to PDF") });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
