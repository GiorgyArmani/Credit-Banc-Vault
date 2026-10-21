import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { shareCompanyName } from "@/lib/share-links";

const client = { company_name: "First Business LLC" };

describe("shareCompanyName", () => {
  it("names the link's OWN business, not the client's first one", () => {
    expect(shareCompanyName({ company_name: "Second Business Inc", business_name: "Second Biz" }, client)).toBe("Second Business Inc");
  });

  it("falls back to the business's trade name", () => {
    expect(shareCompanyName({ company_name: "  ", business_name: "Second Biz" }, client)).toBe("Second Biz");
  });

  it("uses the client record when the link has no business", () => {
    expect(shareCompanyName(null, client)).toBe("First Business LLC");
  });

  it("never renders blank", () => {
    expect(shareCompanyName(null, { company_name: null })).toBe("Business");
  });
});
