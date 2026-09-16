import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, createLead, getDealStatus, isFfConfigured } from "../client";

const fetchMock = vi.fn();
const sleepMock = vi.fn(async (_ms: number) => {});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const tokenOk = (value = "tok-1") => json(200, { access_token: value, token_type: "bearer", expires_in: 600 });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("FORWARD_FINANCING_USERNAME", "partner@example.com");
  vi.stubEnv("FORWARD_FINANCING_SECRET", "s3cret");
  vi.stubEnv("FORWARD_FINANCING_API_BASE", "");
  vi.stubEnv("FORWARD_FINANCING_TOKEN_URL", "");
  __testing.reset();
  __testing.setSleep(sleepMock);
  fetchMock.mockReset();
  sleepMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("forward financing client", () => {
  it("is not configured without the secret", () => {
    vi.stubEnv("FORWARD_FINANCING_SECRET", "");
    expect(isFfConfigured()).toBe(false);
  });

  it("uses a password grant with FF's fixed client id, defaulting to staging", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(200, { stage: "Working" }));

    const r = await getDealStatus("lead-1");

    expect(r).toEqual({ ok: true, status: 200, data: { stage: "Working" }, error: null });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://access.staging.forwardfinancing.com/application/o/token/");
    expect(Object.fromEntries(new URLSearchParams(tokenInit.body))).toEqual({
      grant_type: "password",
      client_id: "partner-api",
      username: "partner@example.com",
      password: "s3cret",
      scope: "openid email profile",
    });
    const [apiUrl, apiInit] = fetchMock.mock.calls[1];
    expect(apiUrl).toBe("https://api.staging.forwardfinancing.com/v1/deal_status/lead-1");
    expect(apiInit.headers.Authorization).toBe("Bearer tok-1");
  });

  it("caches the token across requests", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(200, {}));
    await getDealStatus("a");
    await getDealStatus("b");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes the token once on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-1"))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(tokenOk("tok-2"))
      .mockResolvedValueOnce(json(200, { stage: "Working" }));
    const r = await getDealStatus("a");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer tok-2");
  });

  it("reports rejected credentials without calling the API", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_grant" }));
    const r = await getDealStatus("a");
    expect(r).toEqual({
      ok: false,
      status: 401,
      data: null,
      error: "Forward Financing rejected our credentials (invalid_grant)",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits 2s and retries on 429", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(201, { message: "ok", id: "lead-9" }));
    const r = await createLead({ lead: {} } as any);
    expect(r.data).toEqual({ message: "ok", id: "lead-9" });
    expect(sleepMock).toHaveBeenCalledWith(2000);
  });

  it("spaces request starts by up to 1s", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(200, {}));
    await getDealStatus("a");
    expect(sleepMock.mock.calls.some(([ms]) => ms > 0 && ms <= 1000)).toBe(true);
  });

  it("turns 422 field errors into a readable message and keeps the body", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(422, { errors: { ssn: ["is invalid"] } }));
    const r = await createLead({ lead: {} } as any);
    expect(r).toMatchObject({ ok: false, status: 422, error: "Validation failed: ssn is invalid" });
    expect(r.data).toEqual({ errors: { ssn: ["is invalid"] } });
  });
});
