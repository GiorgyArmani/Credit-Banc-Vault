import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider, providerForLender } from "@/lib/lender-api/registry";
import { forwardFinancing } from "@/lib/lender-api/providers/forward-financing";

beforeEach(() => {
  vi.stubEnv("FORWARD_FINANCING_USERNAME", "partner@example.com");
  vi.stubEnv("FORWARD_FINANCING_SECRET", "s3cret");
});
afterEach(() => vi.unstubAllEnvs());

describe("registry", () => {
  it("matches the FF lender name case- and whitespace-insensitively", () => {
    expect(providerForLender("  forward FINANCING ")?.id).toBe("forward_financing");
    expect(providerForLender("Forward Financing LLC")).toBeNull();
    expect(providerForLender(null)).toBeNull();
  });

  it("hides providers that are not configured", () => {
    vi.stubEnv("FORWARD_FINANCING_SECRET", "");
    expect(providerForLender("Forward Financing")).toBeNull();
    expect(getProvider("forward_financing")).toBeNull();
  });

  it("looks providers up by id", () => {
    expect(getProvider("forward_financing")?.displayName).toBe("Forward Financing");
    expect(getProvider("nope")).toBeNull();
  });
});

describe("forward financing webhook", () => {
  const req = (ip: string | null) =>
    new Request("https://vault.example/api/webhooks/lender-api/forward_financing", {
      method: "POST",
      headers: ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {},
    });

  it("accepts FF's IPs and rejects others", async () => {
    expect(await forwardFinancing.webhook!.verify(req("44.199.142.45"))).toBe(true);
    expect(await forwardFinancing.webhook!.verify(req("1.2.3.4"))).toBe(false);
    expect(await forwardFinancing.webhook!.verify(req(null))).toBe(false);
  });

  it("can disable the IP check for local testing", async () => {
    vi.stubEnv("FORWARD_FINANCING_WEBHOOK_IP_CHECK", "off");
    expect(await forwardFinancing.webhook!.verify(req("1.2.3.4"))).toBe(true);
  });

  it("extracts lead_id", () => {
    expect(forwardFinancing.webhook!.extractExternalId({ lead_id: "abc", event_type: "Approved" })).toBe("abc");
    expect(forwardFinancing.webhook!.extractExternalId({ lead_id: 42 })).toBe("42");
    expect(forwardFinancing.webhook!.extractExternalId({})).toBeNull();
  });
});
