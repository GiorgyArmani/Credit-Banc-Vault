// src/app/partner/welcome/page.tsx
//
// The invite link's landing page, for both kinds of referral partner.
//
//   referral_partner  — magic link → choose a password → portal. Same as it
//                       always was: they share a link, there is no paperwork.
//   partner_advisor   — magic link → password → CONTACT NUMBER → SIGN A W-9 →
//                       UPLOAD A VOIDED CHECK → deal desk. They submit deals and
//                       get paid on funded files, so we need a W-9 on file and
//                       somewhere to send the money before the desk opens — and
//                       their clients see them as their advisor, so we need a
//                       number to put on the client's contact card.
//
// A gated partner_advisor is intercepted by /partner/layout.tsx and never
// reaches this component — the layout renders the same screen as a takeover on
// every /partner/* URL, so there is nowhere to click around it. This page is
// what a referrals-only partner lands on, and what a finished partner bounces
// off when they reuse their invite link as a sign-in link.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPartnerOnboardingState, syncPartnerW9 } from "@/lib/partner-onboarding";
import { isValidUsPhone } from "@/lib/phone";
import { PartnerOnboardingScreen } from "./_components/partner-onboarding-screen";

export const dynamic = "force-dynamic";

export default async function PartnerWelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const partner = await getPartnerOnboardingState(user.id);

  // Not a partner (an admin poking around, or a login that was never linked).
  // The dashboard renders its own explanation for that case.
  if (!partner) redirect("/partner/dashboard");

  const isDealDesk = partner.deal_desk_enabled === true;

  // Referrals-only partners are done the moment they have a password.
  if (!isDealDesk && partner.password_set_at) redirect("/partner/dashboard");
  // Deal-desk partners are done when the compliance gate says so.
  if (isDealDesk && partner.onboarding_completed_at) redirect("/partner/deals");

  // Catch the partner who signed in SignWell and then closed the tab: there is
  // no webhook for the W-9, so a page load is what notices. Cheap — it no-ops
  // unless a document exists and is still unsigned.
  let w9Signed = !!partner.w9_signed_at;
  if (isDealDesk && !w9Signed && partner.w9_document_id) {
    const { signed } = await syncPartnerW9(partner);
    w9Signed = signed;
  }

  const firstName = (partner.name || "").trim().split(/\s+/)[0] || "there";

  return (
    <PartnerOnboardingScreen
      email={user.email ?? ""}
      firstName={firstName}
      isDealDesk={isDealDesk}
      passwordSet={!!partner.password_set_at}
      phone={partner.phone}
      // A number already on the record satisfies the step, but only if it is a
      // number we would actually print on a client's contact card. A partial
      // one typed into the CRM is worse than none — the client dials it.
      phoneSet={isValidUsPhone(partner.phone)}
      w9Signed={w9Signed}
      voidedCheckFilename={partner.voided_check_filename}
    />
  );
}
