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

// Default password for all new clients
const DEFAULT_PASSWORD = "CBvault2025!";

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
    
    const p = ClientSignupSchema.parse(body);

    // ---------- 1) GHL CONTACT WITH ALL CUSTOM FIELDS
    const first_name = p.first_name.trim();
    const last_name = p.last_name.trim() || null;

    const cf = (id_env: string, value: any) =>
      process.env[id_env] ? { id: process.env[id_env]!, value } : null;

    const custom_fields = [
      // Core fields
      cf("GHL_CF_FUNDING_GOAL", p.amount_requested),
      cf("GHL_CF_LEGAL_ENTITY", p.legal_entity_type),
      cf("GHL_CF_BUSINESS_START", p.business_start_date),
      cf("GHL_CF_MONTHLY_REV", p.avg_monthly_deposits),
      cf("GHL_CF_ANNUAL_REV", p.annual_revenue),
      cf("GHL_CF_CREDIT_SCORE", p.credit_score),
      cf("GHL_CF_SBSS_SCORE", p.sbss_score ?? ""),
      cf("GHL_CF_USE_OF_FUNDS", p.use_of_funds),
      cf("GHL_CF_EMPLOYEES", p.employees_count ?? ""),
      cf("GHL_CF_BUSINESS_NAME", p.company_legal_name),
      cf("GHL_CF_ZIP", p.zip),
      cf("GHL_CF_STATE", p.state),
      
      // Industry fields
      cf("GHL_CF_PREFERRED_INDUSTRIES", p.industry_1 || ""),
      
      // Owner information
      cf("GHL_CF_HOW_MANY_COMPANY_OWNERS_ARE_THERE", p.owners?.length?.toString() || "0"),
      ...(p.owners && p.owners[0] ? [
        cf("GHL_CF_FIRST_OWNER", `${p.owners[0].first_name} ${p.owners[0].last_name}`),
        cf("GHL_CF_1ST_OWNER_PERCENTAGE", p.owners[0].ownership_pct)
      ] : []),
      ...(p.owners && p.owners[1] ? [
        cf("GHL_CF_SECOND_OWNER", `${p.owners[1].first_name} ${p.owners[1].last_name}`),
        cf("GHL_CF_2ND_OWNER_PERCENTAGE", p.owners[1].ownership_pct)
      ] : []),
      ...(p.owners && p.owners[2] ? [
        cf("GHL_CF_THIRD_OWNER", `${p.owners[2].first_name} ${p.owners[2].last_name}`),
        cf("GHL_CF_3RD_OWNER_PERCENTAGE", p.owners[2].ownership_pct)
      ] : []),
      
      // Outstanding loans
      ...(p.outstanding_loans?.loan1 ? [
        cf("GHL_CF_BALANCE_LOAN_1", p.outstanding_loans.loan1.balance),
        cf("GHL_CF_LENDER_LOAN_1", p.outstanding_loans.loan1.lender_name),
        cf("GHL_CF_TERM_LOAN_1", p.outstanding_loans.loan1.term)
      ] : []),
      ...(p.outstanding_loans?.loan2 ? [
        cf("GHL_CF_BALANCE_LOAN_2", p.outstanding_loans.loan2.balance),
        cf("GHL_CF_LENDER_LOAN_2", p.outstanding_loans.loan2.lender_name),
        cf("GHL_CF_TERM_LOAN_2", p.outstanding_loans.loan2.term)
      ] : []),
      ...(p.outstanding_loans?.loan3 ? [
        cf("GHL_CF_BALANCE_LOAN_3", p.outstanding_loans.loan3.balance),
        cf("GHL_CF_LENDER_LOAN_3", p.outstanding_loans.loan3.lender_name),
        cf("GHL_CF_TERM_LOAN_3", p.outstanding_loans.loan3.term)
      ] : []),
      
      // Risk flags
      cf("GHL_CF_MCA_DEFAULTS", p.defaulted_on_mca ? "Yes" : "No"),
      cf("GHL_CF_OWNS_REAL_ESTATE", p.owns_real_estate ? "Yes" : "No"),
      cf("GHL_CF_REDUCED_MCA_PAYMENTS", p.reduced_mca_payments ? "Yes" : "No"),
      cf("GHL_CF_PERSONAL_DEBT_OVER_75K", p.personal_cc_debt_over_75k ? "Yes" : "No"),
      cf("GHL_CF_PERSONAL_DEBT_AMOUNT", p.personal_cc_debt_amount ?? ""),
      cf("GHL_CF_FORECLOSURES_OR_BANKRUPTCIES_3Y", p.foreclosures_or_bankruptcies_3y ? "Yes" : "No"),
      cf("GHL_CF_BK_FC_MONTHS_AGO", p.bk_fc_months_ago ?? ""),
      cf("GHL_CF_BK_FC_TYPE", p.bk_fc_type ?? ""),
      cf("GHL_CF_TAX_LIENS", p.tax_liens ? "Yes" : "No"),
      cf("GHL_CF_TAX_LIEN_TYPE", p.tax_liens_type ?? ""),
      cf("GHL_CF_TAX_LIEN_PAYMENT_PLAN", p.tax_liens_on_plan ? "Yes" : "No"),
      cf("GHL_CF_HOW_SOON_FUNDS", p.how_soon_funds ?? ""),
      cf("GHL_CF_ADDITIONAL_INFO", p.additional_info ?? ""),
      cf("GHL_CF_JUDGEMENT_EXPLANATION", p.judgements_explain ?? ""),
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

    // ---------- 2) SUPABASE USER WITH DEFAULT PASSWORD
    const { data: existing_user_row } = await admin
      .from("users")
      .select("id")
      .eq("email", p.email.toLowerCase())
      .maybeSingle();

    let user_id = existing_user_row?.id as string | undefined;
    let login_url = `${process.env.NEXT_PUBLIC_APP_URL}/auth/sign-in`;

    if (!user_id) {
      // Create user with default password
      const { data: created, error: create_err } = await admin.auth.admin.createUser({
        email: p.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true, // Auto-confirm so they can login immediately
        user_metadata: {
          full_name: `${p.first_name} ${p.last_name}`,
          company: p.company_legal_name,
          should_change_password: true, // Flag to show password change prompt
        },
      });
      if (create_err) throw create_err;
      user_id = created.user!.id;

      // Send welcome email with login instructions
      // You can integrate with your email service here
      
    } else {
      // Update existing user
      await admin.auth.admin.updateUserById(user_id, { 
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { 
          should_change_password: true,
          full_name: `${p.first_name} ${p.last_name}`,
          company: p.company_legal_name,
        } 
      });
    }

    // ---------- 3) USERS TABLE
    await admin.from("users").upsert({
      id: user_id!,
      email: p.email.toLowerCase(),
      first_name: p.first_name,
      last_name: p.last_name,
      role: "free",
    });

    // ---------- 4) BUSINESS_PROFILE WITH ALL FIELDS
    const { data: bp } = await admin
      .from("business_profiles")
      .upsert({
        user_id: user_id!,
        business_name: p.company_legal_name,
        industry: p.industry_1 ?? null,
        legal_entity_type: p.legal_entity_type,
        city: p.city,
        state: p.state,
        zip: p.zip,
        phone: p.phone,
        monthly_revenue: String(p.avg_monthly_deposits),
        annual_revenue_last_year: String(p.annual_revenue),
        business_model: p.legal_entity_type,
        primary_goal: p.use_of_funds,
        business_start_date: p.business_start_date,
        credit_score: p.credit_score,
        amount_requested: p.amount_requested,
        use_of_funds: p.use_of_funds,
        avg_monthly_deposits: p.avg_monthly_deposits,
        sbss_score: p.sbss_score,
      })
      .select("id")
      .single();
    const profile_id = bp!.id;

    // ---------- 5) BUSINESS OWNERS
    if (p.owners && p.owners.length > 0) {
      await admin.from("business_owners").insert(
        p.owners.map((o) => ({
          profile_id,
          full_name: `${o.first_name} ${o.last_name}`,
          ownership_pct: o.ownership_pct,
        }))
      );
    }

    // ---------- 6) OUTSTANDING LOANS
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

    // ---------- 7) APPLICATION FLAGS WITH ALL FIELDS
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

    // ---------- 8) INTEGRATIONS
    await admin
      .from("integrations")
      .upsert({ 
        profile_id, 
        ghl_contact_id, 
        last_push_at: new Date().toISOString(),
      });

    // ---------- 9) VAULT STATE
    await admin
      .from("user_vault_profiles")
      .upsert({ 
        user_id: user_id!, 
        current_product_tag: "Pre-Approval" 
      });

    // ---------- 10) EVENTS
    await admin.from("events").insert({
      profile_id,
      type: "client_signup",
      payload: {
        amount_requested: p.amount_requested,
        legal_entity_type: p.legal_entity_type,
        credit_score: p.credit_score,
      },
      actor: p.advisor_id ?? null,
    });

    // ---------- 11) TAGS IN GHL
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
      login_url,
      credentials: {
        email: p.email,
        password: DEFAULT_PASSWORD,
      }
    });
    
  } catch (e: any) {
    console.error("Client signup error:", e);
    return NextResponse.json({ 
      error: String(e.message ?? e) 
    }, { status: 400 });
  }
}