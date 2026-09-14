// src/app/admin/partner-plus/page.tsx
//
// Admin view of Partner+ — paying external advisors. Read-mostly by design: one
// row per rep, plus the two levers that would otherwise only be reachable by
// hand-written SQL against production (active, billing_exempt). Money details
// link out to Stripe.
//
// Proxy already gates /admin to admins; re-checked defensively.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeDashboardCustomerUrl } from "@/lib/stripe";
import { hasDeskAccess } from "@/lib/partner-plus-billing";
import { PartnerPlusManager, type PartnerPlusRow } from "./_components/partner-plus-manager";

export const dynamic = "force-dynamic";

export default async function AdminPartnerPlusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const db = createAdminClient();
  const { data, error } = await db
    .from("external_advisors")
    .select(
      "id, user_id, first_name, last_name, email, phone, company_name, stripe_customer_id, subscription_status, current_period_end, cancel_at_period_end, billing_exempt, active, provisioning_error, w9_signed_at, voided_check_uploaded_at, onboarding_completed_at, created_at"
    )
    .order("created_at", { ascending: false });

  const rows: PartnerPlusRow[] = (data ?? []).map((r) => ({
    ...r,
    has_access: hasDeskAccess(r),
    stripe_url: r.stripe_customer_id ? stripeDashboardCustomerUrl(r.stripe_customer_id) : null,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">Partner+</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900">Paying external advisors</h1>
        <p className="mt-1 text-sm text-slate-500">
          $100/month per login. Deactivate cuts off a desk regardless of payment; comp opens one with no subscription.
          Invoices, refunds and cards live in Stripe.
        </p>
      </div>
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Could not load Partner+ accounts ({error.message}). Has migration 20260914_partner_plus been applied?
        </div>
      ) : (
        <PartnerPlusManager rows={rows} />
      )}
    </div>
  );
}
