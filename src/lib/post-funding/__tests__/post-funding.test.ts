import { describe, it, expect, beforeAll } from "vitest";
import { POST_FUNDING_STEPS, nextAction } from "../steps";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "../unsubscribe";
import { resolveSignature } from "../signatures";
import { generate_post_funding_email_html, generate_post_funding_email_text } from "@/lib/email";

const DAY = 86_400_000;
const funded = new Date("2026-01-01T15:00:00Z");
const at = (days: number) => new Date(funded.getTime() + days * DAY);
const none = new Set<number>();

describe("post-funding schedule", () => {
  it("is 9 steps on days 0, 7, 30 then every 30 to 210", () => {
    expect(POST_FUNDING_STEPS.map((s) => s.day)).toEqual([0, 7, 30, 60, 90, 120, 150, 180, 210]);
    expect(POST_FUNDING_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("sends Email 1 the moment the round funds", () => {
    expect(nextAction(funded, none, funded)).toEqual({ kind: "send", step: 1, skip: [] });
  });

  it("waits for the next step's day once the previous one is recorded", () => {
    const action = nextAction(funded, new Set([1]), at(3));
    expect(action).toMatchObject({ kind: "wait", step: 2, skip: [] });
    expect(action.kind === "wait" && action.dueAt.toISOString()).toBe(at(7).toISOString());
    expect(nextAction(funded, new Set([1]), at(7))).toEqual({ kind: "send", step: 2, skip: [] });
  });

  it("never sends a step late: a round seen mid-sequence skips the closed windows", () => {
    // Funded 73 days ago and never emailed → only Email 4 (window 60–90).
    expect(nextAction(funded, none, at(73))).toEqual({ kind: "send", step: 4, skip: [1, 2, 3] });
    // Day 6.9 without Email 1 still sends it; day 7 skips it for Email 2.
    expect(nextAction(funded, none, at(6.9))).toMatchObject({ kind: "send", step: 1 });
    expect(nextAction(funded, none, at(7))).toEqual({ kind: "send", step: 2, skip: [1] });
  });

  it("sends at most one step per run even after a long outage", () => {
    expect(nextAction(funded, new Set([1, 2]), at(95))).toEqual({ kind: "send", step: 5, skip: [3, 4] });
  });

  it("gives the last step a 30-day window, then is done", () => {
    const allButLast = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(nextAction(funded, allButLast, at(239))).toMatchObject({ kind: "send", step: 9 });
    expect(nextAction(funded, allButLast, at(240))).toEqual({ kind: "done", skip: [9] });
    expect(nextAction(funded, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]), at(400))).toEqual({ kind: "done", skip: [] });
  });
});

describe("post-funding copy", () => {
  it("contains no markup characters (the HTML template interpolates it unescaped)", () => {
    for (const s of POST_FUNDING_STEPS) {
      const blocks = [...s.body("NAME"), ...(s.postscript?.("NAME") ?? [])];
      for (const b of blocks) {
        const text = b.kind === "button" ? b.label : `${b.text} ${b.inline?.label ?? ""}`;
        expect(text, `step ${s.step}`).not.toMatch(/[<>&"]/);
      }
    }
  });
});

describe("post-funding signatures", () => {
  it("uses the advisor's own signature, case-insensitively", () => {
    const { signature, isFallback } = resolveSignature("Paul@CreditBanc.io");
    expect(signature.name).toBe("Paul Katsaros");
    expect(isFallback).toBe(false);
  });

  it("always signs an external advisor's clients as Luigi, even if they had a signature", () => {
    const { signature, isFallback } = resolveSignature("paul@creditbanc.io", { isExternal: true });
    expect(signature.name).toBe("Luigi Rosabianca");
    expect(isFallback).toBe(true);
    const html = generate_post_funding_email_html({
      step: 1,
      client_name: "Ann",
      client_email: "ann@example.com",
      advisor_email: "paul@creditbanc.io",
      advisor_is_external: true,
      unsubscribe_url: "https://x/u",
      one_click_unsubscribe_url: "https://x/a",
    });
    expect(html).toContain("Luigi Rosabianca");
    expect(html).not.toContain("Paul Katsaros");
  });

  it("falls back to Luigi for external partners and unassigned files", () => {
    for (const email of ["someone@cpa-firm.com", null, ""]) {
      const { signature, isFallback } = resolveSignature(email);
      expect(signature.name).toBe("Luigi Rosabianca");
      expect(isFallback).toBe(true);
    }
  });
});

describe("unsubscribe token", () => {
  beforeAll(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
  });
  const id = "5de894cf-48bb-4597-bac6-12e5e2c7f1d4";

  it("round-trips to the client it was minted for", () => {
    expect(verifyUnsubscribeToken(makeUnsubscribeToken(id))).toBe(id);
  });

  it("rejects a tampered or foreign token", () => {
    const other = "0767df23-3155-4a41-8c46-c866a5b47771";
    const [, sig] = makeUnsubscribeToken(id).split(".");
    expect(verifyUnsubscribeToken(`${other}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${id}.nope`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });
});

describe("post-funding email rendering", () => {
  const base = {
    client_name: "Tom <b>O'Neill</b> Jr",
    client_email: "tom@example.com",
    advisor_email: "grant@creditbanc.io",
    unsubscribe_url: "https://vault.example/unsubscribe/x",
    one_click_unsubscribe_url: "https://vault.example/api/unsubscribe/x",
  };

  it("escapes the client's name in HTML but not in text", () => {
    const html = generate_post_funding_email_html({ ...base, step: 1 });
    expect(html).toContain("Hi Tom,");
    const injected = generate_post_funding_email_html({ ...base, client_name: "<script>x</script>", step: 1 });
    expect(injected).not.toContain("<script>");
    expect(injected).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(generate_post_funding_email_text({ ...base, client_name: "Tom O'Neill", step: 1 })).toContain("Hi Tom,");
  });

  it("signs with the advisor's signature and links buttons to their booking page", () => {
    const html = generate_post_funding_email_html({ ...base, step: 4 });
    expect(html).toContain("T. Grant Dearborn");
    expect(html).toContain('href="https://www.creditbanc.io/schedule/grant-dearborn"');
    // P.S. renders below the signature.
    expect(html.indexOf("P.S.")).toBeGreaterThan(html.indexOf("signature_tbl"));
    expect(html).toContain(base.unsubscribe_url);
  });

  it("renders every step in both formats", () => {
    for (const s of POST_FUNDING_STEPS) {
      const text = generate_post_funding_email_text({ ...base, step: s.step });
      expect(text).toContain("T. Grant Dearborn");
      expect(text).toContain(base.unsubscribe_url);
      expect(generate_post_funding_email_html({ ...base, step: s.step })).toContain(s.preheader);
    }
  });
});
