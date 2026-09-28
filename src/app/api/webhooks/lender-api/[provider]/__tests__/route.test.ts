import { beforeEach, describe, expect, it, vi } from "vitest";

const getProvider = vi.fn();
const findSubmissionByExternalId = vi.fn();
const refreshSubmissionStatus = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/lender-api/registry", () => ({ getProvider: (id: string) => getProvider(id) }));
vi.mock("@/lib/lender-api/submissions", () => ({
  findSubmissionByExternalId: (...a: unknown[]) => findSubmissionByExternalId(...a),
  refreshSubmissionStatus: (...a: unknown[]) => refreshSubmissionStatus(...a),
  applyPushedStatus: vi.fn(),
}));

import { POST } from "../route";

const call = () =>
  POST(new Request("https://vault.example/api/webhooks/lender-api/x", { method: "POST", body: "{}" }), {
    params: Promise.resolve({ provider: "x" }),
  });

function provider(webhook: Record<string, unknown>) {
  return {
    id: "x",
    fetchStatus: vi.fn(),
    webhook: { verify: vi.fn().mockResolvedValue(true), extractExternalId: vi.fn().mockReturnValue(null), ...webhook },
  };
}

beforeEach(() => {
  getProvider.mockReset();
  findSubmissionByExternalId.mockReset();
  refreshSubmissionStatus.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lender-api webhook route — resolveExternalId", () => {
  it("a failed lookup (resolver throws) answers 503 so the lender retries", async () => {
    getProvider.mockReturnValue(provider({ resolveExternalId: vi.fn().mockRejectedValue(new Error("SmartBiz search failed")) }));
    const res = await call();
    expect(res.status).toBe(503);
    expect(findSubmissionByExternalId).not.toHaveBeenCalled();
  });

  it("an unknown reference (resolver returns null) is acknowledged with 200", async () => {
    getProvider.mockReturnValue(provider({ resolveExternalId: vi.fn().mockResolvedValue(null) }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(findSubmissionByExternalId).not.toHaveBeenCalled();
  });

  it("a resolved id is re-fetched like any provider", async () => {
    getProvider.mockReturnValue(provider({ resolveExternalId: vi.fn().mockResolvedValue("s-1") }));
    findSubmissionByExternalId.mockResolvedValue({ id: "sub-1" });
    refreshSubmissionStatus.mockResolvedValue({ httpStatus: 200 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(findSubmissionByExternalId).toHaveBeenCalledWith({}, "x", "s-1");
    expect(refreshSubmissionStatus).toHaveBeenCalled();
  });

  it("a provider without a resolver still answers 400 when the body has no id", async () => {
    getProvider.mockReturnValue(provider({}));
    expect((await call()).status).toBe(400);
  });
});
