import { describe, expect, it } from "vitest";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { searchClients } from "@/lib/client-search";
import { DEFAULT_DEAL, matchLender, type Lender } from "@/lib/lender-matching";

/** A fake PostgREST builder over `rows` that honours .range(). */
function fakeQuery(rows: number[]) {
  return () => ({
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
  });
}

describe("fetchAllRows", () => {
  it("reads past the 1000-row cap", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const { data, error } = await fetchAllRows<number>(fakeQuery(rows));
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data[2499]).toBe(2499);
  });

  it("stops on an exact multiple of the page size", async () => {
    const { data } = await fetchAllRows<number>(fakeQuery(Array.from({ length: 2000 }, (_, i) => i)));
    expect(data).toHaveLength(2000);
  });

  it("returns the error and the rows read so far", async () => {
    let calls = 0;
    const build = () => ({
      range: async () => (calls++ === 0 ? { data: new Array(1000).fill(1), error: null } : { data: null, error: { message: "boom" } }),
    });
    const { data, error } = await fetchAllRows(build);
    expect(error?.message).toBe("boom");
    expect(data).toHaveLength(1000);
  });
});

describe("searchClients", () => {
  const rows = [
    {
      id: "v1",
      client_name: "Dileny Tavarez",
      company_name: "2860 Sunrise LLC",
      business_profiles: [{ company_name: "2860 Sunrise LLC" }, { company_name: "427 Sunrise Realty LLC" }],
    },
    { id: "v2", client_name: "Bob Forbes", company_name: "Ameritech Slope Constructors", business_profiles: [] },
  ];

  it("finds a client by a secondary business name and shows that name", () => {
    const hits = searchClients(rows, "427 sunrise");
    expect(hits).toEqual([{ id: "v1", client_name: "Dileny Tavarez", company_name: "427 Sunrise Realty LLC" }]);
  });

  it("keeps the primary name when the primary or the person matches", () => {
    expect(searchClients(rows, "sunrise")[0].company_name).toBe("2860 Sunrise LLC");
    expect(searchClients(rows, "dileny")[0].company_name).toBe("2860 Sunrise LLC");
  });

  it("returns nothing for a blank query", () => {
    expect(searchClients(rows, "  ")).toEqual([]);
  });
});

describe("matchLender (shared by Lender Match and the Add Lender picker)", () => {
  const lender = {
    id: "l1",
    lender_name: "Test Lender",
    min_fico: 650,
    restricted_states: "CA, NY",
    max_funding: 100000,
  } as unknown as Lender;

  it("flags every guideline the deal misses", () => {
    const r = matchLender(lender, { ...DEFAULT_DEAL, fico: 600, state: "CA", capitalRequested: 250000 });
    expect(r.passed).toBe(false);
    expect(r.flags).toHaveLength(3);
  });

  it("does not flag what the deal has no data for", () => {
    expect(matchLender(lender, { ...DEFAULT_DEAL }).passed).toBe(true);
  });
});
