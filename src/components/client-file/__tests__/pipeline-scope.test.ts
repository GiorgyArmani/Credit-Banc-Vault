import { describe, expect, it } from "vitest";
import { latestPipelineStatus, scopePipelineHistory } from "../pipeline-scope";

const primary = { id: "biz-1", is_primary: true };
const second = { id: "biz-2", is_primary: false };

const history = [
  { status: "created", created_at: "2026-09-01T00:00:00Z", business_profile_id: null },
  { status: "documents_received", created_at: "2026-09-05T00:00:00Z", business_profile_id: "biz-1" },
  { status: "documents_requested", created_at: "2026-09-10T00:00:00Z", business_profile_id: "biz-2" },
];

describe("scopePipelineHistory", () => {
  it("keeps every row on a single-business file", () => {
    expect(scopePipelineHistory(history, primary, 1)).toHaveLength(3);
  });

  it("gives the primary business its own rows plus unstamped ones", () => {
    expect(scopePipelineHistory(history, primary, 2).map((r) => r.status)).toEqual([
      "created",
      "documents_received",
    ]);
  });

  it("gives a second business only its own rows", () => {
    expect(scopePipelineHistory(history, second, 2).map((r) => r.status)).toEqual(["documents_requested"]);
  });

  it("keeps every row when no business is selected yet", () => {
    expect(scopePipelineHistory(history, null, 2)).toHaveLength(3);
  });
});

describe("latestPipelineStatus", () => {
  it("picks the newest row regardless of order", () => {
    expect(latestPipelineStatus([...history].reverse())).toBe("documents_requested");
  });

  it("reads a business with no steps as created", () => {
    expect(latestPipelineStatus([])).toBe("created");
  });
});
