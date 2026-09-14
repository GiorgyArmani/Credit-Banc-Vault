import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// The module under test pulls in Supabase, Stripe, SMTP and GHL clients at
// import time. None of that is exercised by the pure helpers below.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), stripeDashboardCustomerUrl: vi.fn() }));
vi.mock("@/lib/magic-link", () => ({ generateDeskMagicLink: vi.fn() }));
vi.mock("@/lib/partner-plus-email", () => ({
  send_partner_plus_payment_failed_email: vi.fn(),
  send_partner_plus_provisioning_error_notification: vi.fn(),
  send_partner_plus_welcome_email: vi.fn(),
}));

import { hasDeskAccess, invoiceSubscriptionId, isPastDue } from "@/lib/partner-plus-billing";

const row = (over: Partial<{ active: boolean; billing_exempt: boolean; subscription_status: string | null }>) => ({
  active: true,
  billing_exempt: false,
  subscription_status: "active" as string | null,
  ...over,
});

describe("hasDeskAccess — must match private.partner_plus_has_access()", () => {
  it.each(["active", "trialing", "past_due"])("opens the desk for %s", (status) => {
    expect(hasDeskAccess(row({ subscription_status: status }))).toBe(true);
  });

  it.each(["unpaid", "canceled", "incomplete", "incomplete_expired", "paused", null])(
    "locks the desk for %s",
    (status) => {
      expect(hasDeskAccess(row({ subscription_status: status }))).toBe(false);
    }
  );

  it("opens a comped account with no subscription", () => {
    expect(hasDeskAccess(row({ billing_exempt: true, subscription_status: null }))).toBe(true);
  });

  it("locks a deactivated account even when paid or comped", () => {
    expect(hasDeskAccess(row({ active: false }))).toBe(false);
    expect(hasDeskAccess(row({ active: false, billing_exempt: true }))).toBe(false);
  });

  it("locks when there is no row", () => {
    expect(hasDeskAccess(null)).toBe(false);
  });
});

describe("isPastDue", () => {
  it("is true only for a paying, active, past_due account", () => {
    expect(isPastDue(row({ subscription_status: "past_due" }))).toBe(true);
    expect(isPastDue(row({ subscription_status: "past_due", billing_exempt: true }))).toBe(false);
    expect(isPastDue(row({ subscription_status: "active" }))).toBe(false);
  });
});

describe("invoiceSubscriptionId (dahlia invoice shape)", () => {
  it("reads parent.subscription_details.subscription as an id or an expanded object", () => {
    const asId = { parent: { subscription_details: { subscription: "sub_123" } } } as unknown as Stripe.Invoice;
    const expanded = {
      parent: { subscription_details: { subscription: { id: "sub_456" } } },
    } as unknown as Stripe.Invoice;
    expect(invoiceSubscriptionId(asId)).toBe("sub_123");
    expect(invoiceSubscriptionId(expanded)).toBe("sub_456");
  });

  it("falls back to the legacy top-level subscription (old-API-version webhook payloads)", () => {
    const legacy = { parent: undefined, subscription: "sub_legacy" } as unknown as Stripe.Invoice;
    expect(invoiceSubscriptionId(legacy)).toBe("sub_legacy");
  });

  it("returns null for an invoice not tied to a subscription", () => {
    expect(invoiceSubscriptionId({ parent: null } as unknown as Stripe.Invoice)).toBeNull();
  });
});
