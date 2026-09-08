import { describe, it, expect } from "vitest";
import { REPORTS_READY } from "../types";

describe("reports module", () => {
  it("is wired up", () => {
    expect(REPORTS_READY).toBe(true);
  });
});
