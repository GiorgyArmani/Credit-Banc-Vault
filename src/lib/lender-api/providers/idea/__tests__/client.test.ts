import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, isIdeaConfigured } from "../client";
import { idea } from "../index";
import { providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();
const API = "https://partner.api.ideafinancial.net";

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const token = () => json(200, { token_type: "Bearer", access_token: "tok-1", expires_in: 3600, refresh_token: "r" });
const empty = (status: number) => new Response(null, { status });

function doc(id: string, filename: string, docCode: string): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

/** Routes by URL + method so the order of calls doesn't matter. */
function route(handlers: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace(API, "")}`;
    if (String(url).includes("oauth")) return token();
    if (String(url).startsWith("https://storage.example/")) return new Response(new Uint8Array([37, 80, 68, 70]));
    const h = handlers[key];
    if (!h) throw new Error(`unexpected ${key}`);
    return h();
  });
}

function calls(prefix: string) {
  return fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace(API, "")}`.startsWith(prefix));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("IDEA_CLIENT_ID", "id-1");
  vi.stubEnv("IDEA_CLIENT_SECRET", "secret-1");
  vi.stubEnv("IDEA_AGENT_ID", "1331650");
  vi.stubEnv("IDEA_API_BASE", "");
  vi.stubEnv("IDEA_TOKEN_URL", "");
  fetchMock.mockReset();
  __testing.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("idea config + registry", () => {
  it("needs the key pair and an agent id", () => {
    expect(isIdeaConfigured()).toBe(true);
    vi.stubEnv("IDEA_AGENT_ID", "");
    expect(isIdeaConfigured()).toBe(false);
    expect(providerForLender("IDEA")).toBeNull();
  });

  it("matches however the lender row spells the name", () => {
    for (const name of ["IDEA", "Idea Financial", " idea "]) expect(providerForLender(name)?.id).toBe("idea");
    expect(providerForLender("Ideal Capital")).toBeNull();
  });
});

describe("idea createApplication", () => {
  it("files under the configured agent and returns the numeric id as a string", async () => {
    route({ "POST /v1/applications": () => json(201, { id: 714702 }) });
    const res = await idea.createApplication({ business: {}, owners: [] });
    expect(res).toEqual({ ok: true, externalId: "714702" });
    const [, init] = calls("POST /v1/applications")[0];
    expect(JSON.parse(init.body).agentId).toBe(1331650);
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("reads a 400 as a clean rejection with field errors", async () => {
    route({
      "POST /v1/applications": () =>
        json(400, { title: "One or more validation errors occurred.", status: 400, errors: { "business.ein": ["'ein' must not be empty."] } }),
    });
    const res = await idea.createApplication({});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.fieldErrors).toEqual({ "business.ein": ["'ein' must not be empty."] });
    expect(res.error).toContain("business.ein");
  });

  it("treats a 2xx without an id as unknown, not a rejection", async () => {
    route({ "POST /v1/applications": () => json(201, {}) });
    expect((await idea.createApplication({})).status).toBe(0);
  });

  it("refreshes the token once on a 401", async () => {
    let n = 0;
    route({ "POST /v1/applications": () => (n++ === 0 ? empty(401) : json(201, { id: 5 })) });
    expect((await idea.createApplication({})).externalId).toBe("5");
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("oauth"))).toHaveLength(2);
  });
});

describe("idea uploadDocuments", () => {
  it("uploads multipart with Idea's fields, then pushes a draft", async () => {
    route({
      "POST /v1/applications/714702/files": () => json(201, { id: 1 }),
      "GET /v1/applications/714702": () => json(200, { id: 714702, status: "draft" }),
      "POST /v1/applications/714702/push": () => empty(204),
    });
    const res = await idea.uploadDocuments("714702", [
      doc("a", "signed app.pdf", "signed_application"),
      doc("b", "stmt.pdf", "business_bank_statements"),
      doc("c", "dl.png", "drivers_license"),
    ]);
    expect(res.map((r) => r.accepted)).toEqual([true, true, false]);
    expect(res[2]).toMatchObject({ unavailable: true });

    const form = calls("POST /v1/applications/714702/files")[0][1].body as FormData;
    expect(form.get("documentType")).toBe("application");
    expect(form.get("fileName")).toBe("signed app.pdf");
    expect(form.get("fileExtension")).toBe(".pdf");
    expect(form.get("mimeType")).toBe("application/pdf");
    expect(form.get("fileSize")).toBe("4");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(calls("POST /v1/applications/714702/push")).toHaveLength(1);
  });

  it("never pushes from submission-incomplete", async () => {
    route({
      "POST /v1/applications/7/files": () => json(201, { id: 1 }),
      "GET /v1/applications/7": () => json(200, { id: 7, status: "submission-incomplete" }),
    });
    await idea.uploadDocuments("7", [doc("b", "stmt.pdf", "business_bank_statements")]);
    expect(calls("POST /v1/applications/7/push")).toHaveLength(0);
  });

  it("a refused push doesn't fail the files", async () => {
    route({
      "POST /v1/applications/7/files": () => json(201, { id: 1 }),
      "GET /v1/applications/7": () => json(200, { id: 7, status: "draft" }),
      "POST /v1/applications/7/push": () => json(400, { message: "Signed Application document has to be uploaded to proceed." }),
    });
    const res = await idea.uploadDocuments("7", [doc("b", "stmt.pdf", "business_bank_statements")]);
    expect(res[0].accepted).toBe(true);
  });
});

describe("idea fetchStatus", () => {
  it("strips owners and keeps the push refusal on a draft", async () => {
    route({
      "GET /v1/applications/7": () =>
        json(200, { id: 7, status: "draft", owners: [{ ssn: "589-12-3456" }], business: { ein: "123456789" } }),
      "POST /v1/applications/7/push": () => json(400, { message: "Signed Application document has to be uploaded to proceed." }),
    });
    const res = await idea.fetchStatus!("7");
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.raw)).not.toContain("589-12-3456");
    expect(res.raw).toMatchObject({ status: "draft", pushError: "Signed Application document has to be uploaded to proceed." });
  });

  it("finishes a stuck push and returns the new status", async () => {
    let pushed = false;
    route({
      "GET /v1/applications/7": () => json(200, { id: 7, status: pushed ? "processing" : "draft" }),
      "POST /v1/applications/7/push": () => {
        pushed = true;
        return empty(204);
      },
    });
    const res = await idea.fetchStatus!("7");
    expect(res.raw).toMatchObject({ status: "processing" });
    expect((res.raw as Record<string, unknown>).pushError).toBeUndefined();
  });

  it("never pushes past Draft — from Contract Ready a push sends the contract to the customer", async () => {
    for (const status of ["submission-incomplete", "offer", "closing-incomplete", "contract-ready"]) {
      fetchMock.mockReset();
      route({
        "GET /v1/applications/7": () => json(200, { id: 7, status }),
        "POST /v1/applications/7/files": () => json(201, { id: 1 }),
      });
      await idea.fetchStatus!("7");
      await idea.uploadDocuments("7", [doc("b", "stmt.pdf", "business_bank_statements")]);
      expect(calls("POST /v1/applications/7/push")).toHaveLength(0);
    }
  });

  it("does not push once Idea is reviewing", async () => {
    route({ "GET /v1/applications/7": () => json(200, { id: 7, status: "processing" }) });
    await idea.fetchStatus!("7");
    expect(calls("POST /v1/applications/7/push")).toHaveLength(0);
  });
});
