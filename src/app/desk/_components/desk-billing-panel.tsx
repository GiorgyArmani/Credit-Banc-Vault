// The Partner+ billing card. Server-rendered from the rep's external_advisors
// row; the only interactive piece is the portal button.
//
// Rendered from TWO places:
//   /desk/layout.tsx    — as a TAKEOVER when the desk is locked (every /desk URL)
//   /desk/billing       — inside the desk chrome, for a rep in good standing
//
// No card data lives here. "Manage billing" opens the Stripe Billing Portal.

import { ManageBillingButton } from "./manage-billing-button";

export interface DeskBillingPanelProps {
  firstName: string;
  locked: boolean;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingExempt: boolean;
  active: boolean;
  hasStripeCustomer: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed — retrying",
  unpaid: "Unpaid",
  canceled: "Canceled",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  paused: "Paused",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function DeskBillingPanel(props: DeskBillingPanelProps) {
  const periodEnd = formatDate(props.currentPeriodEnd);
  const status = props.subscriptionStatus;
  // A canceled or expired subscription can't be revived from the portal.
  const needsNewSubscription = status === "canceled" || status === "incomplete_expired";

  let headline = "Billing";
  let body: React.ReactNode = null;

  if (!props.active) {
    headline = "Your desk is paused";
    body = "Access to this account has been paused by Credit Banc. Contact us if you think this is a mistake.";
  } else if (props.billingExempt) {
    body = "Your Partner+ access is complimentary — there's nothing to pay.";
  } else if (props.locked && needsNewSubscription) {
    headline = "Your subscription has ended";
    body =
      "Your desk is paused. Your clients and any deals already in underwriting are unaffected. Contact us to reactivate your Partner+ subscription.";
  } else if (props.locked) {
    headline = "Your desk is paused";
    body =
      "We couldn't collect your Partner+ payment. Update your card and your desk reopens as soon as the payment goes through. Your clients and deals in underwriting are unaffected.";
  } else if (status === "past_due") {
    body =
      "Your last payment failed and we're retrying it. Your desk stays open for now — update your card to avoid a pause.";
  } else if (props.cancelAtPeriodEnd && periodEnd) {
    body = `Your subscription is set to cancel. You keep full access until ${periodEnd}.`;
  } else if (periodEnd) {
    body = `Your subscription renews on ${periodEnd} at $100/month.`;
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-14 md:py-20">
      <div className="rounded-3xl border border-black/5 bg-white p-8 shadow-sm md:p-10">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-cb-mint">Partner+</p>
        <h1 className="font-manrope text-3xl font-extrabold tracking-tight text-cb-ink">{headline}</h1>
        {body && <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/60">{body}</p>}

        <dl className="mt-8 grid grid-cols-2 gap-4 rounded-2xl bg-cb-cream/60 p-5 text-sm">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray">Status</dt>
            <dd className="mt-1 font-semibold text-cb-ink">
              {props.billingExempt ? "Complimentary" : STATUS_LABEL[status ?? ""] ?? "No subscription"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray">
              {props.cancelAtPeriodEnd ? "Access until" : "Current period ends"}
            </dt>
            <dd className="mt-1 font-semibold text-cb-ink">{periodEnd ?? "—"}</dd>
          </div>
        </dl>

        {props.hasStripeCustomer && props.active && !props.billingExempt && (
          <div className="mt-8">
            <ManageBillingButton label={props.locked && !needsNewSubscription ? "Update payment method" : "Manage billing"} />
          </div>
        )}

        {(needsNewSubscription || !props.active) && (
          <p className="mt-6 text-sm text-cb-ink/60">
            Questions? Email{" "}
            <a href="mailto:support@creditbanc.io" className="font-semibold text-cb-ink underline">
              support@creditbanc.io
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}
