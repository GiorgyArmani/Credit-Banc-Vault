// src/app/api/refer/[code]/submit/route.ts
//
// PUBLIC (no auth) — an affiliate's referral link points at /r/[code], a
// conversational pre-qualification stepper that POSTs here. We:
//   1. validate the affiliate code is active,
//   2. evaluate the pre-qual answers SERVER-SIDE (can't be bypassed),
//   3. for QUALIFIED leads: upsert the contact into GHL WITHOUT assignedTo (the
//      GHL round-robin calendar assigns the owner when they book) + store an
//      `affiliate_leads` row recording the affiliate + the answers,
//   4. for DISQUALIFIED leads: store the row (status=disqualified) with no GHL
//      push; the client redirects them to the thanks-for-applying page.
// See [[ghl_integration_contract]], [[role_model]], [[affiliate_program]].
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ghlUpsertContact, ghlResolveFieldId } from "@/lib/ghl-api";
import { evaluatePrequal } from "@/lib/referral-prequal";
import { formatPhoneUS, isValidUsPhone, toE164 } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json().catch(() => ({}));

    // Honeypot: bots fill hidden fields. Silently accept (200) without storing.
    if (body.company_website) {
      return NextResponse.json({ ok: true, qualified: false });
    }

    const fullName = String(body.full_name || "").trim();
    const [firstName, ...restName] = fullName.split(/\s+/);
    const lastName = restName.join(" ");
    const email = String(body.email || "").trim().toLowerCase();
    const rawPhone = String(body.phone || "").trim();
    const businessName = String(body.business_name || "").trim();

    const loanAmount = String(body.loan_amount || "").trim();
    const ficoBand = String(body.fico_band || "").trim();
    const monthlyRevenue = String(body.monthly_revenue || "").trim();
    const timeInBusiness = String(body.time_in_business || "").trim();

    if (!firstName || !email || !rawPhone) {
      return NextResponse.json(
        { message: "Please provide your name, email, and phone." },
        { status: 400 }
      );
    }
    // Public form — sanitize before anything is stored or pushed to GHL, so a
    // referred lead lines up with the vault client it later becomes.
    if (!isValidUsPhone(rawPhone)) {
      return NextResponse.json(
        { message: "Please enter a valid 10-digit US phone number." },
        { status: 400 }
      );
    }
    const phone = formatPhoneUS(rawPhone);
    const phoneE164 = toE164(rawPhone)!;
    if (!loanAmount || !ficoBand || !monthlyRevenue || !timeInBusiness) {
      return NextResponse.json(
        { message: "Please answer all the pre-qualification questions." },
        { status: 400 }
      );
    }

    const db = createAdminClient();

    // 1. Resolve the affiliate by referral code.
    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, status, referral_code, first_name, last_name")
      .eq("referral_code", code)
      .maybeSingle();

    if (!affiliate || affiliate.status !== "active") {
      return NextResponse.json(
        { message: "This referral link is no longer active." },
        { status: 404 }
      );
    }

    // 2. Evaluate qualification server-side (source of truth).
    const { qualified, reason } = evaluatePrequal({
      loan_amount: loanAmount,
      fico_band: ficoBand,
      monthly_revenue: monthlyRevenue,
      time_in_business: timeInBusiness,
    });

    // 3. Duplicate guard: same email already a lead or an existing client.
    const [{ data: existingLead }, { data: existingClient }] = await Promise.all([
      db.from("affiliate_leads").select("id").eq("email", email).maybeSingle(),
      db.from("client_data_vault").select("id").eq("client_email", email).maybeSingle(),
    ]);
    const isDuplicate = Boolean(existingLead || existingClient);

    const answerCols = {
      loan_amount: loanAmount,
      fico_band: ficoBand,
      monthly_revenue: monthlyRevenue,
      time_in_business: timeInBusiness,
    };

    // Disqualified → store (unless dup) and tell the client to redirect out.
    if (!qualified) {
      if (!isDuplicate) {
        await db.from("affiliate_leads").insert({
          affiliate_id: affiliate.id,
          first_name: firstName,
          last_name: lastName || null,
          email,
          phone,
          business_name: businessName || null,
          status: "disqualified",
          qualified: false,
          disqualified_reason: reason,
          source: "referral_link",
          ...answerCols,
        });
      }
      return NextResponse.json({ ok: true, qualified: false, reason });
    }

    // Qualified duplicate → let them book again, but don't create a second row
    // or re-push to GHL.
    if (isDuplicate) {
      return NextResponse.json({ ok: true, qualified: true, duplicate: true });
    }

    // 4. Qualified new lead → push to GHL (no assignedTo; the round-robin calendar
    //    assigns the owner at booking). Never block capture on a GHL hiccup.
    let ghlContactId: string | null = null;
    try {
      const locationId = process.env.GHL_LOCATION_ID;
      if (locationId) {
        // Stamp the affiliate onto {{contact.affiliate_partner}} (PUBLIC affiliate
        // program — distinct from AFFILIATE_ASSIGNED / referral_partner).
        const affiliatePartnerValue =
          [affiliate.first_name, affiliate.last_name].filter(Boolean).join(" ").trim() ||
          affiliate.referral_code;
        const affiliateFieldId =
          process.env.GHL_CF_AFFILIATE_PARTNER ||
          (await ghlResolveFieldId(locationId, "contact.affiliate_partner"));
        const customFields = affiliateFieldId
          ? [{ id: affiliateFieldId, value: affiliatePartnerValue }]
          : undefined;

        ghlContactId = await ghlUpsertContact({
          firstName,
          lastName: lastName || null,
          name: fullName,
          email,
          phone: phoneE164,
          companyName: businessName || null,
          country: "US",
          locationId,
          // Attribution tags only. No `vault_pre_approval` here — that tag fires
          // a GHL automation meant for real vault signups, and a referral lead
          // has only pre-qualified, not signed up.
          tags: ["vault-affiliate-referral", `vault-affiliate:${affiliate.referral_code}`],
          customFields,
        });
      } else {
        console.warn("[refer/submit] Missing GHL_LOCATION_ID — storing lead without GHL contact");
      }
    } catch (ghlErr) {
      console.error("[refer/submit] GHL upsert failed (lead stored anyway):", ghlErr);
    }

    // 5. Store the qualified pending lead with attribution + answers.
    const { error: insertErr } = await db.from("affiliate_leads").insert({
      affiliate_id: affiliate.id,
      first_name: firstName,
      last_name: lastName || null,
      email,
      phone,
      business_name: businessName || null,
      status: "qualified",
      qualified: true,
      ghl_contact_id: ghlContactId,
      source: "referral_link",
      ...answerCols,
    });

    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true, qualified: true });
  } catch (err: any) {
    console.error("refer/submit error:", err);
    return NextResponse.json(
      { message: err?.message || "Server error. Please try again." },
      { status: 500 }
    );
  }
}
