// src/app/desk/billing/page.tsx
//
// Billing for a rep in good standing. A LOCKED rep never renders this body:
// /desk/layout.tsx shows the same panel as a takeover on every /desk URL. The
// proxy also sends locked page requests here, which is why it must stay
// reachable (src/proxy.ts exempts it from the freeze).

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getExternalAdvisorState } from "@/lib/external-advisor-onboarding";
import { hasDeskAccess } from "@/lib/partner-plus-billing";
import { DeskBillingPanel } from "../_components/desk-billing-panel";

export const dynamic = "force-dynamic";

export default async function DeskBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const rep = await getExternalAdvisorState(user.id);
  // Admins walking the desk have no subscription to show.
  if (!rep) redirect("/desk/deals");

  return (
    <DeskBillingPanel
      firstName={rep.first_name}
      locked={!hasDeskAccess(rep)}
      subscriptionStatus={rep.subscription_status}
      currentPeriodEnd={rep.current_period_end}
      cancelAtPeriodEnd={rep.cancel_at_period_end}
      billingExempt={rep.billing_exempt}
      active={rep.active}
      hasStripeCustomer={!!rep.stripe_customer_id}
    />
  );
}
