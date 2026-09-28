// src/lib/lender-api/providers/smartbiz/__tests__/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBusiness,
  describeSmartBizError,
  getSmartBizConfig,
  isDuplicateBusinessError,
  isSmartBizConfigured,
  searchSubmissionByReference,
  uploadSubmissionDocument,
} from "../client";

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/vnd.api+json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SMARTBIZ_PARTNER_ID", "123");
  vi.stubEnv("SMARTBIZ_TOKEN", "test1test1test1");
  vi.stubEnv("SMARTBIZ_API_BASE", "");
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("smartbiz config", () => {
  it("needs both partner id and token", () => {
    vi.stubEnv("SMARTBIZ_TOKEN", "");
    expect(isSmartBizConfigured()).toBe(false);
  });
  it("defaults to the documented host", () => {
    expect(getSmartBizConfig()?.apiBase).toBe("https://partner-api-service.smartbizloans.com");
  });
  it("trims the base and adds https:// when the scheme is missing", () => {
    vi.stubEnv("SMARTBIZ_API_BASE", " partner-api-service.smartbizloans.com/ ");
    expect(getSmartBizConfig()?.apiBase).toBe("https://partner-api-service.smartbizloans.com");
  });
});

describe("smartbiz requests", () => {
  it("sends Basic base64(partner_id:token) — their documented example", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { id: "b-1" } }));
    await createBusiness({} as never);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://partner-api-service.smartbizloans.com/v3/business/");
    expect(init.headers.Authorization).toBe("Basic MTIzOnRlc3QxdGVzdDF0ZXN0MQ==");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("reads JSON:API errors", () => {
    expect(describeSmartBizError(400, { errors: [{ status: 400, title: "Bad Request", detail: "Email already in use" }] })).toEqual({
      error: "Bad Request: Email already in use",
    });
  });

  it("reads FastAPI 422 errors into field errors", () => {
    expect(describeSmartBizError(422, { detail: [{ loc: ["body", "industry"], msg: "field required", type: "missing" }] })).toEqual({
      error: "SmartBiz rejected 1 field",
      fieldErrors: { industry: ["field required"] },
    });
  });

  it("a network failure is status 0 (uncertain)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await createBusiness({} as never)).status).toBe(0);
  });

  it("searches by client reference id", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [{ id: "s-9", type: "submission" }], meta: {} }));
    const res = await searchSubmissionByReference("ref-1");
    expect(res.data?.data?.[0]?.id).toBe("s-9");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      filter: { client_reference_id: "ref-1" },
      options: { pagination: { page: 1, size: 10 } },
    });
  });

  it("uploads a document as multipart with document_type and tax_year", async () => {
    fetchMock.mockResolvedValueOnce(new Response("null", { status: 202 }));
    const res = await uploadSubmissionDocument("s-1", { document_type: "last_years_business_tax_return", tax_year: 2025 }, {
      bytes: new TextEncoder().encode("pdf").buffer as ArrayBuffer,
      filename: "2025.pdf",
      contentType: "application/pdf",
    });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://partner-api-service.smartbizloans.com/v3/submission/s-1/documents");
    const fd = init.body as FormData;
    expect(fd.get("document_type")).toBe("last_years_business_tax_return");
    expect(fd.get("tax_year")).toBe("2025");
    expect(fd.get("file")).toBeInstanceOf(Blob);
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
});

describe("duplicate business", () => {
  it.each([
    "Bad Request: A business with this email already exists",
    "Bad Request: TIN is already associated with another business",
    "Bad Request: duplicate business",
  ])("recognises %s", (e) => {
    expect(isDuplicateBusinessError(400, e)).toBe(true);
  });
  it("does not read a TIN format error as a duplicate", () => {
    expect(isDuplicateBusinessError(400, "Bad Request: invalid TIN")).toBe(false);
    expect(isDuplicateBusinessError(422, "email already exists")).toBe(false);
  });
});
