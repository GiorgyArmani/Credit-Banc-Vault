import { describe, expect, it } from "vitest";
import { buildUwQueue, type UwQueueRows } from "@/lib/uw-queue";

const NOW = new Date("2026-11-09T12:00:00Z").getTime();
const vault = (id: string, user_id: string, over: Partial<UwQueueRows["vaults"][number]> = {}) => ({
  id, user_id, client_name: `Client ${id}`, client_email: `${id}@x.com`, company_name: `Co ${id}`,
  company_state: "TX", credit_score: "700", capital_requested: 100000, created_at: "2026-10-30T12:00:00Z",
  advisor_id: "adv1", advisors: [{ first_name: "Ana", last_name: "Diaz" }],
  business_profiles: [{ company_name: `Co ${id}` }, { company_name: "Second Biz" }], ...over,
});
const empty: UwQueueRows = { vaults: [], submissions: [], history: [], dynamicDocs: [], uploads: [], approvals: [], waitingLenders: [] };

describe("buildUwQueue", () => {
  it("buckets by newest pipeline status, then the submission lock", () => {
    const q = buildUwQueue({
      ...empty,
      vaults: [vault("a", "ua"), vault("b", "ub"), vault("c", "uc"), vault("d", "ud")],
      submissions: [
        { user_id: "ua", status: "locked", submitted_at: "2026-11-01T12:00:00Z" },
        { user_id: "ub", status: "locked", submitted_at: null },
      ],
      // Newest first: b was funded after being declined.
      history: [
        { client_vault_id: "b", status: "funded" },
        { client_vault_id: "b", status: "declined" },
        { client_vault_id: "c", status: "declined" },
      ],
    }, NOW);
    const by = Object.fromEntries(q.leads.map((l) => [l.id, l.bucket]));
    expect(by).toEqual({ a: "ready", b: "funded", c: "declined", d: "active" });
    expect(q.leads.find((l) => l.id === "a")!.age_days).toBe(8);
    expect(q.leads.find((l) => l.id === "d")!.pipeline_status).toBe("created");
  });

  it("counts required docs as approved / awaiting review, ignoring Lender Documentation", () => {
    const q = buildUwQueue({
      ...empty,
      vaults: [vault("a", "ua")],
      dynamicDocs: [
        { user_id: "ua", required_documents: { code: "bank" } },
        { user_id: "ua", required_documents: [{ code: "dl" }] },
        { user_id: "ua", required_documents: { code: "tax" } },
        { user_id: "ua", required_documents: { code: "lender_documentation" } },
      ],
      uploads: [
        { user_id: "ua", category: "bank", doc_code: null },
        { user_id: "ua", category: null, doc_code: "dl" },
      ],
      approvals: [{ client_vault_id: "a", doc_code: "bank" }],
    }, NOW);
    expect(q.leads[0]).toMatchObject({ docs_total: 3, docs_approved: 1, docs_awaiting_review: 1 });
  });

  it("summarises waiting lenders, business names and advisors", () => {
    const q = buildUwQueue({
      ...empty,
      vaults: [vault("a", "ua"), vault("b", "ub", { advisor_id: null, advisors: null })],
      waitingLenders: [
        { client_id: "a", submitted_at: "2026-11-02T12:00:00Z", assigned_at: null, created_at: "2026-10-01T12:00:00Z" },
        { client_id: "a", submitted_at: null, assigned_at: "2026-10-29T12:00:00Z", created_at: "2026-10-01T12:00:00Z" },
      ],
    }, NOW);
    expect(q.leads[0]).toMatchObject({ lenders_waiting: 2, lender_wait_days: 11, business_names: "Co a Second Biz", advisor_name: "Ana Diaz" });
    expect(q.leads[1]).toMatchObject({ lenders_waiting: 0, advisor_name: "Unknown Advisor" });
    expect(q.advisors).toEqual([{ id: "adv1", name: "Ana Diaz" }]);
  });
});
