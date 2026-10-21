import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeKaajError, isYesLeasingConfigured } from "../client";
import { yesLeasing } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();
const BASE = "https://api.kaaj.example";
const TOKEN = "kaaj_partner_test";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function bytes(content: string | Buffer): Response {
  return new Response(typeof content === "string" ? Buffer.from(content) : content, { status: 200 });
}

function doc(id: string, filename: string, docCode = "business_bank_statements"): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

async function partsOf(init: { body: FormData }) {
  const out: Array<[string, string]> = [];
  for (const [key, value] of init.body.entries()) {
    out.push([key, typeof value === "string" ? value : `${value.name}:${await value.text()}`]);
  }
  return out;
}

const OK = { success: true, app_id: "Kaaj-app-1", upload_id: 42, file_count: 2 };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("KAAJ_API_BASE", `${BASE}/`);
  vi.stubEnv("KAAJ_API_TOKEN", TOKEN);
  vi.stubEnv("KAAJ_USER_EMAIL", "");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("yes leasing client", () => {
  it("needs the base URL and the token (no default host — Kaaj has no sandbox)", () => {
    vi.stubEnv("KAAJ_API_BASE", "");
    expect(isYesLeasingConfigured()).toBe(false);
    expect(providerForLender("YES Leasing")).toBeNull();
    vi.stubEnv("KAAJ_API_BASE", BASE);
    vi.stubEnv("KAAJ_API_TOKEN", "");
    expect(isYesLeasingConfigured()).toBe(false);
  });

  it("matches the lender row's spellings and nothing longer", () => {
    expect(providerForLender("YES Leasing")?.id).toBe("yes_leasing");
    expect(providerForLender(" yes leasing ")?.id).toBe("yes_leasing");
    expect(providerForLender("yesleasing")?.id).toBe("yes_leasing");
    expect(providerForLender("YES Leasing Partners")).toBeNull();
  });

  it("sends every file plus Kaaj's lender name, bearer auth, and returns the app id", async () => {
    vi.stubEnv("KAAJ_USER_EMAIL", "uw@creditbanc.example");
    fetchMock.mockResolvedValueOnce(bytes("APP")).mockResolvedValueOnce(bytes("JUNE")).mockResolvedValueOnce(json(200, OK));

    const r = await yesLeasing.createApplication(
      { referenceId: "cb-1" },
      { documents: [doc("app", "application.pdf", "signed_application"), doc("s1", "june.pdf")] }
    );

    expect(r).toEqual({
      ok: true,
      externalId: "Kaaj-app-1",
      initialStatus: { status: "delivered", uploadId: 42, fileCount: 2 },
      attachments: [
        { documentId: "app", filename: "application.pdf", stamped: false, accepted: true },
        { documentId: "s1", filename: "june.pdf", stamped: false, accepted: true },
      ],
    });
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe(`${BASE}/partner-portal/ingest`);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(await partsOf(init)).toEqual([
      ["lender_name", "yesleasing"],
      ["user_email", "uw@creditbanc.example"],
      ["files", "application.pdf:APP"],
      ["files", "june.pdf:JUNE"],
    ]);
  });

  it("leaves user_email out when unset (Kaaj's default uploader)", async () => {
    fetchMock.mockResolvedValueOnce(bytes("A")).mockResolvedValueOnce(json(200, OK));
    await yesLeasing.createApplication({ referenceId: "cb-1" }, { documents: [doc("a", "a.pdf")] });
    expect((await partsOf(fetchMock.mock.calls[1][1])).map(([k]) => k)).toEqual(["lender_name", "files"]);
  });

  it("skips encrypted PDFs and oversized files as terminal, and still sends the rest", async () => {
    const encrypted = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\ntrailer\n<< /Encrypt 5 0 R >>");
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    fetchMock
      .mockResolvedValueOnce(bytes(encrypted))
      .mockResolvedValueOnce(bytes(big))
      .mockResolvedValueOnce(bytes("OK"))
      .mockResolvedValueOnce(json(200, OK));

    const r = await yesLeasing.createApplication(
      { referenceId: "cb-1" },
      { documents: [doc("e", "locked.pdf"), doc("b", "huge.pdf"), doc("g", "good.pdf")] }
    );

    expect(r.ok).toBe(true);
    expect(r.attachments).toEqual([
      { documentId: "g", filename: "good.pdf", stamped: false, accepted: true },
      expect.objectContaining({ documentId: "e", accepted: false, unavailable: true, error: expect.stringMatching(/password/) }),
      expect.objectContaining({ documentId: "b", accepted: false, unavailable: true, error: expect.stringMatching(/50 MB/) }),
    ]);
    expect(await partsOf(fetchMock.mock.calls[3][1])).toContainEqual(["files", "good.pdf:OK"]);
  });

  it("refuses cleanly, before calling Kaaj, when no file can go", async () => {
    const r = await yesLeasing.createApplication({ referenceId: "cb-1" }, { documents: [] });
    expect(r).toEqual({ ok: false, status: 422, error: expect.stringMatching(/application, invoice and bank statements/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 2xx without an app_id as uncertain (status 0), never a rejection", async () => {
    fetchMock.mockResolvedValueOnce(bytes("A")).mockResolvedValueOnce(json(200, { success: true }));
    const r = await yesLeasing.createApplication({ referenceId: "cb-1" }, { documents: [doc("a", "a.pdf")] });
    expect(r).toEqual({ ok: false, status: 0, error: expect.stringMatching(/no app_id/) });
  });

  it("passes a 4xx through as a clean rejection with Kaaj's message", async () => {
    fetchMock.mockResolvedValueOnce(bytes("A")).mockResolvedValueOnce(json(403, { detail: "No active partnerships found for your lender key." }));
    const r = await yesLeasing.createApplication({ referenceId: "cb-1" }, { documents: [doc("a", "a.pdf")] });
    expect(r).toEqual({ ok: false, status: 403, error: "No active partnerships found for your lender key." });
  });

  it("names our own config problems in Kaaj's 400s", () => {
    expect(describeKaajError(400, { detail: { error: "Invalid lender_name: 'x'.", valid_lender_names: ["a"] } })).toMatch(/lender name/);
    expect(describeKaajError(400, { detail: { error: "User not found", available_users: [] } })).toMatch(/KAAJ_USER_EMAIL/);
    expect(describeKaajError(401, null)).toBe("Kaaj rejected our API token");
    // Real 422 shape, seen live 2026-10-21.
    expect(describeKaajError(422, { detail: [{ type: "missing", loc: ["body", "files"], msg: "Field required", input: null }] })).toBe(
      "Kaaj rejected the request — files: Field required"
    );
  });

  it("never retries files later — Kaaj can't add them to an application", async () => {
    const r = await yesLeasing.uploadDocuments("Kaaj-app-1", [doc("a", "a.pdf")]);
    expect(r).toEqual([expect.objectContaining({ documentId: "a", accepted: false, unavailable: true })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no status API: the stored status only ever reads as delivered", () => {
    expect(yesLeasing.fetchStatus).toBeUndefined();
    expect(yesLeasing.interpretStatus({ status: "delivered" })).toEqual({ kind: "in_progress", stage: "Delivered to YES Leasing" });
  });
});
