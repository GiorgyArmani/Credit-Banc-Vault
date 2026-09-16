import { describe, expect, it, vi } from "vitest";

// These modules build Supabase clients / read env at import time.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/lender-response-history", () => ({ openAttempt: vi.fn(), closeAttempt: vi.fn() }));
vi.mock("@/lib/notifications/lender-pipeline", () => ({ notifyAdminsOfLenderPipelineEvent: vi.fn() }));
vi.mock("@/lib/slack-api", () => ({ slackPostMessage: vi.fn() }));

import { submitGuard } from "@/lib/lender-assignment-transitions";

describe("submitGuard", () => {
  const ok = { decision: "approved", admin_review: "pending", status: "pending" };

  it("allows an approved, not-removed, pending row", () => {
    expect(submitGuard(ok)).toEqual({ ok: true });
  });

  it.each([
    [null, 404, "Assignment not found."],
    [{ ...ok, decision: "rejected" }, 409, "Assignment was not approved by the matching engine."],
    [{ ...ok, admin_review: "rejected" }, 409, "This lender was removed from the file."],
    [{ ...ok, status: "submitted" }, 409, 'Assignment status is already "submitted".'],
  ])("refuses %j", (row, httpStatus, error) => {
    expect(submitGuard(row)).toEqual({ ok: false, httpStatus, error });
  });
});
