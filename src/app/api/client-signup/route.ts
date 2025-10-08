// src/app/api/client-signup/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ClientSignupSchema } from "@/schema";
import { ghlUpsertContact, ghlAddTags } from "@/lib/ghl-api";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Clean up empty owners before validation
    if (body.owners && Array.isArray(body.owners)) {
      body.owners = body.owners.filter((owner: any) => {
        const has_first_name = owner.first_name && owner.first_name.trim() !== "";
        const has_last_name = owner.last_name && owner.last_name.trim() !== "";
        return has_first_name && has_last_name;
      });
    }
    
    // Parse and validate
    const p = ClientSignupSchema.parse(body);

    // ---------- 1) GHL CONTACT
    const first_name = p.first_name.trim();
    const last_name = p.last_name.trim() || null;

    const cf = (id_env: string, value: any) =>
      process.env[id_env] ? { id: process.env[id_env]!, value } : null;

    const custom_fields = [
      cf("GHL_CF_FUNDING_GOAL", p.amount_requested),
      cf("GHL_CF_LEGAL_ENTITY", p.legal_entity_type),
      cf("GHL_CF_INDUSTRY", p.industry_1 || p.industry_2 || p.industry_3 || ""),
      cf("GHL_CF_BUSINESS_START", p.business_start_date),
      cf("GHL_CF_MONTHLY_REV", p.avg_monthly_deposits),
      cf("GHL_CF_ANNUAL_REV", p.annual_revenue),
      cf("GHL_CF_CREDIT_SCORE", p.credit_score),
      cf("GHL_CF_SBSS_SCORE", p.sbss_score ?? ""),
      cf("GHL_CF_USE_OF_FUNDS", p.use_of_funds),
      cf("GHL_CF_EMPLOYEES", p.employees_count ?? ""),
    ].filter(Boolean) as Array<{ id: string; value: any }>;

    const ghl_contact_id = await ghlUpsertContact({
      locationId: process.env.GHL_LOCATION_ID!,
      firstName: first_name,
      lastName: last_name,
      email: p.email,
      phone: p.phone,
      companyName: p.company_legal_name,
      city: p.city,
      state: p.state,
      postalCode: p.zip,
      country: "US",
      tags: ['vault-user'],
      customFields: custom_fields,
    });

    // ---------- 2) SUPABASE USER
    const { data: existing_user_row } = await admin
      .from("users")
      .select("id")
      .eq("email", p.email.toLowerCase())
      .maybeSingle();

    let user_id = existing_user_row?.id as string | undefined;
    let action_link: string | undefined;

    const redirect_to = `${process.env.NEXT_PUBLIC_APP_URL}/auth/set-password`;

    if (!user_id) {
      const { data: created, error: create_err } = await admin.auth.admin.createUser({
        email: p.email,
        email_confirm: false,
        user_metadata: {
          full_name: `${p.first_name} ${p.last_name}`,
          company: p.company_legal_name,
          must_set_password: true,
        },
      });
      if (create_err) throw create_err;
      user_id = created.user!.id;

      const { error: invite_err } = await admin.auth.admin.inviteUserByEmail(p.email, { redirectTo: redirect_to });
      if (invite_err) throw invite_err;

      const { data: link_data } = await admin.auth.admin.generateLink({ 
        type: "invite", 
        email: p.email, 
        options: { redirectTo: redirect_to }
      });
      action_link = (link_data as any)?.properties?.action_link;
    } else {
      const { error: reset_err } = await admin.auth.resetPasswordForEmail(p.email, { redirectTo: redirect_to });
      if (reset_err) throw reset_err;

      const { data: link_data } = await admin.auth.admin.generateLink({ 
        type: "recovery", 
        email: p.email, 
        options: { redirectTo: redirect_to }
      });
      action_link = (link_data as any)?.properties?.action_link;

      await admin.auth.admin.updateUserById(user_id, { 
        user_metadata: { must_set_password: true } 
      });
    }

    // ---------- 3) USERS + BUSINESS_PROFILE
    await admin.from("users").upsert({
      id: user_id!,
      email: p.email.toLowerCase(),
      first_name: p.first_name,
      last_name: p.last_name,
      role: "free",
    });

    const { data: bp } = await admin
      .from("business_profiles")
      .upsert({
        user_id: user_id!,
        business_name: p.company_legal_name,
        industry: p.industry_1 ?? p.industry_2 ?? p.industry_3 ?? null,
        monthly_revenue: String(p.avg_monthly_deposits),
        annual_revenue_last_year: String(p.annual_revenue),
        business_model: p.legal_entity_type,
        primary_goal: p.use_of_funds,
        business_start_date: p.business_start_date,
        credit_score: p.credit_score,
      })
      .select("id")
      .single();
    const profile_id = bp!.id;

    // ---------- 4) OWNERS (only if we have any)
    if (p.owners && p.owners.length > 0) {
      await admin.from("business_owners").insert(
        p.owners.map((o) => ({
          profile_id,
          full_name: `${o.first_name} ${o.last_name}`,
          ownership_pct: o.ownership_pct,
        }))
      );
    }

    // ---------- 5) OUTSTANDING LOANS
    const L = p.outstanding_loans;
    const loans = [
      L?.loan1 ? { position: 1, ...L.loan1 } : null,
      L?.loan2 ? { position: 2, ...L.loan2 } : null,
      L?.loan3 ? { position: 3, ...L.loan3 } : null,
    ].filter(Boolean) as any[];

    if (loans.length) {
      await admin
        .from("outstanding_loans")
        .insert(loans.map((l) => ({ profile_id, ...l })));
    }

    // ---------- 6) APPLICATION FLAGS
    await admin.from("application_flags").upsert({
      profile_id,
      defaulted_on_mca: p.defaulted_on_mca ?? false,
      reduced_mca_payments: p.reduced_mca_payments ?? false,
      owns_real_estate: p.owns_real_estate ?? false,
      personal_cc_debt_over_75k: p.personal_cc_debt_over_75k ?? false,
      personal_cc_debt_amount: p.personal_cc_debt_amount ?? null,
      foreclosures_or_bankruptcies_3y: p.foreclosures_or_bankruptcies_3y ?? false,
      bk_fc_months_ago: p.bk_fc_months_ago ?? null,
      bk_fc_type: p.bk_fc_type ?? null,
      tax_liens: p.tax_liens ?? false,
      tax_liens_type: p.tax_liens_type ?? null,
      tax_liens_amount: p.tax_liens_amount ?? null,
      tax_liens_on_plan: p.tax_liens_on_plan ?? false,
      judgements_explain: p.judgements_explain ?? null,
      how_soon_funds: p.how_soon_funds ?? null,
      employees_count: p.employees_count ?? null,
      additional_info: p.additional_info ?? null,
    });

    // ---------- 7) INTEGRATIONS
    await admin
      .from("integrations")
      .upsert({ 
        profile_id, 
        ghl_contact_id, 
        last_push_at: new Date().toISOString() 
      });

    // ---------- 8) VAULT STATE
    await admin
      .from("user_vault_profiles")
      .upsert({ 
        user_id: user_id!, 
        current_product_tag: "Pre-Approval" 
      });

    // ---------- 9) EVENTS
    if (p.has_previous_debt) {
      await admin.from("events").insert({
        profile_id,
        type: "rule_override",
        payload: { require_debt_schedule: true },
        actor: p.advisor_id ?? null,
      });
    }

    await admin.from("events").insert({
      profile_id,
      type: "client_signup",
      payload: {
        amount_requested: p.amount_requested,
      },
      actor: p.advisor_id ?? null,
    });

    // ---------- 10) TAGS IN GHL
    const doc_tags = p.documents_requested.map((d) =>
      d.toLowerCase().replace(/\s+/g, "_")
    );
    const state_tags = ["portal_created", "vault_pre_approval"];
    await ghlAddTags(ghl_contact_id, [...doc_tags, ...state_tags]);
    
    await admin.from("events").insert({
      profile_id,
      type: "tags_applied",
      payload: { tags: [...doc_tags, ...state_tags] },
    });

    return NextResponse.json({
      ok: true,
      profile_id,
      user_id,
      ghl_contact_id,
      invite_link: action_link,
    });
    
  } catch (e: any) {
    console.error("Client signup error:", e);
    return NextResponse.json({ 
      error: String(e.message ?? e) 
    }, { status: 400 });
  }
}