import { describe, expect, it } from "vitest";
import { resolveTab, withTabParam } from "@/components/client-file/tab-param";

describe("resolveTab", () => {
  const advisor = ["overview", "documents", "notes"] as const;
  it("accepts an allowed tab", () => expect(resolveTab("documents", advisor)).toBe("documents"));
  it("falls back to overview for a tab the role cannot see", () => expect(resolveTab("lenders", advisor)).toBe("overview"));
  it("falls back for junk and missing", () => {
    expect(resolveTab("nope", advisor)).toBe("overview");
    expect(resolveTab(null, advisor)).toBe("overview");
  });
  it("falls back to overview even for an empty list", () => expect(resolveTab("notes", [])).toBe("overview"));
});

describe("withTabParam", () => {
  it("adds the tab and keeps other params", () =>
    expect(withTabParam("?from=pipeline", "documents")).toBe("?from=pipeline&tab=documents"));
  it("replaces an existing tab", () => expect(withTabParam("?tab=notes", "documents")).toBe("?tab=documents"));
  it("overview removes the param", () => expect(withTabParam("?from=pipeline&tab=notes", "overview")).toBe("?from=pipeline"));
  it("empty result has no question mark", () => expect(withTabParam("?tab=notes", "overview")).toBe(""));
});
