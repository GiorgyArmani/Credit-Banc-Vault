import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPirsConfigured, pirsCallbackUrl } from "../client";
import { pirs } from "../index";
import { getProvider, providerForLender } from "@/lib/lender-api/registry";
import type { OutboundDocument } from "@/lib/lender-api/types";

const fetchMock = vi.fn();
const API = "https://pirsportalcom-pirstest.azurewebsites.net";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function doc(id: string, filename: string, docCode: string): OutboundDocument {
  return { documentId: id, filename, url: `https://storage.example/${id}`, docCode, stamped: false };
}

/** A file of `bytes` behind every storage URL, unless a test routes its HEAD itself. */
function route(handlers: Record<string, () => Response>, bytes = 1000) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace(API, "")}`;
    const h = handlers[key];
    if (!h && key.startsWith("HEAD https://storage.example/")) {
      return new Response(null, { status: 200, headers: { "Content-Length": String(bytes) } });
    }
    if (!h) throw new Error(`unexpected ${key}`);
    return h();
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PIRS_API_USERNAME", "submissions@example.com");
  vi.stubEnv("PIRS_API_PASSWORD", "pw");
  vi.stubEnv("PIRS_API_BASE", "");
  vi.stubEnv("PIRS_WEBHOOK_TOKEN", "hook-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vault.creditbanc.io");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("pirs config + registry", () => {
  it("needs both portal credentials", () => {
    expect(isPirsConfigured()).toBe(true);
    expect(providerForLender("PIRS")?.id).toBe("pirs");
    expect(providerForLender("Pirs Capital")?.id).toBe("pirs");
    vi.stubEnv("PIRS_API_PASSWORD", "");
    expect(isPirsConfigured()).toBe(false);
    expect(providerForLender("PIRS")).toBeNull();
    expect(getProvider("pirs")).toBeNull();
  });

  it("builds the callback URL only with a token and a public https app URL", () => {
    expect(pirsCallbackUrl()).toBe("https://vault.creditbanc.io/api/webhooks/lender-api/pirs?token=hook-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(pirsCallbackUrl()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vault.creditbanc.io");
    vi.stubEnv("PIRS_WEBHOOK_TOKEN", "");
    expect(pirsCallbackUrl()).toBeUndefined();
  });
});

describe("createApplication", () => {
  it("sends Basic auth + the callback URL and returns the fund id", async () => {
    route({ "POST /api/Application/Create": () => json(201, { fundId: 190841, status: "Submitted" }) });
    const res = await pirs.createApplication({ legalName: "X" });
    expect(res).toEqual({ ok: true, externalId: "190841" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("submissions@example.com:pw").toString("base64")}`);
    expect(JSON.parse(init.body).callbackUrl).toBe("https://vault.creditbanc.io/api/webhooks/lender-api/pirs?token=hook-secret");
  });

  it("returns the sandbox's modelState as field errors on a 400", async () => {
    route({
      "POST /api/Application/Create": () =>
        json(400, {
          message: "The request is invalid.",
          modelState: { "applicationViewModel.TaxID": ["The field TaxID must match the regular expression '^[0-9]\\d?-\\d{7}$'."] },
        }),
    });
    const res = await pirs.createApplication({});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.fieldErrors).toEqual({ TaxID: ["The field TaxID must match the regular expression '^[0-9]\\d?-\\d{7}$'."] });
    expect(res.error).toContain("TaxID");
  });

  it("treats a 2xx without a fund id as unknown, not a rejection", async () => {
    route({ "POST /api/Application/Create": () => json(201, {}) });
    expect(await pirs.createApplication({})).toMatchObject({ ok: false, status: 0 });
  });
});

describe("uploadDocuments", () => {
  it("attaches each file by URL with our filename and a description", async () => {
    route({
      "POST /api/Attachments/Create?fundId=190841": () =>
        json(201, [{ description: "Bank statement", fileName: "Jan.pdf", url: "" }]),
    });
    const out = await pirs.uploadDocuments("190841", [doc("d1", "Jan.pdf", "bank_statement"), doc("d2", "App.pdf", "signed_application")]);
    expect(out.map((r) => r.accepted)).toEqual([true, true]);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0][1].body)).toEqual([
      { fileName: "Jan.pdf", description: "Bank statement", url: "https://storage.example/d1" },
    ]);
  });

  it("reports a per-file exception inside a 2xx as a failure", async () => {
    route({ "POST /api/Attachments/Create?fundId=5": () => json(200, [{ fileName: "a.pdf", url: "", exception: "Could not download" }]) });
    const [r] = await pirs.uploadDocuments("5", [doc("d1", "a.pdf", "bank_statement")]);
    expect(r).toMatchObject({ accepted: false, error: "Could not download" });
  });

  it("never sends a file over PIRS's 25 MB limit", async () => {
    route({}, 25 * 1024 * 1024 + 1);
    const [r] = await pirs.uploadDocuments("5", [doc("d1", "big.pdf", "bank_statement")]);
    expect(r).toMatchObject({ accepted: false, unavailable: true, error: expect.stringContaining("25 MB") });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("sends a file whose size can't be read and lets PIRS decide", async () => {
    route({
      "HEAD https://storage.example/d1": () => new Response(null, { status: 403 }),
      "POST /api/Attachments/Create?fundId=5": () => json(201, [{ fileName: "a.pdf", url: "" }]),
    });
    const [r] = await pirs.uploadDocuments("5", [doc("d1", "a.pdf", "bank_statement")]);
    expect(r.accepted).toBe(true);
  });
});

describe("fetchStatus", () => {
  it("strips the SSN and skips Options while in progress", async () => {
    route({
      "GET /api/Application/Get/190841": () =>
        json(200, { fundId: 190841, status: "Submitted", owner1: { ownerInfo: { ssn: "123-45-6789" } } }),
    });
    const res = await pirs.fetchStatus!("190841");
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.raw)).not.toContain("123-45-6789");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches Options once approved", async () => {
    route({
      "GET /api/Application/Get/7": () => json(200, { fundId: 7, status: "Offer" }),
      "GET /api/Application/Options/7": () => json(200, { options: [{ tier: "B", maxAdvanceAmount: 25000 }], originationFee: 10 }),
    });
    const res = await pirs.fetchStatus!("7");
    expect(pirs.interpretStatus(res.raw)).toMatchObject({ kind: "approved", stage: "Offer" });
  });

  it("explains the 500 PIRS answers for an unknown fund id", async () => {
    route({ "GET /api/Application/Get/1": () => new Response("<html>error</html>", { status: 500 }) });
    expect(await pirs.fetchStatus!("1")).toEqual({ ok: false, error: "PIRS could not load this fund id" });
  });
});

describe("webhook", () => {
  const req = (q: string) => new Request(`https://vault.creditbanc.io/api/webhooks/lender-api/pirs${q}`, { method: "POST" });

  it("accepts only our token", async () => {
    expect(await pirs.webhook!.verify(req("?token=hook-secret"))).toBe(true);
    expect(await pirs.webhook!.verify(req("?token=nope"))).toBe(false);
    expect(await pirs.webhook!.verify(req(""))).toBe(false);
    vi.stubEnv("PIRS_WEBHOOK_TOKEN", "");
    expect(await pirs.webhook!.verify(req("?token=hook-secret"))).toBe(false);
  });

  it("takes the fund id from the pushed ApplicationResponse", () => {
    expect(pirs.webhook!.extractExternalId({ fundId: 190841, status: "Offer" })).toBe("190841");
    expect(pirs.webhook!.extractExternalId({ status: "Offer" })).toBeNull();
  });
});
