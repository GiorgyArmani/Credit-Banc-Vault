import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { CLIENT_SCOPED_DOC_CODES } from "@/lib/document-scope";
import { signWell } from "@/lib/signwell";
import { CLIENT_API_ROLES, isScopedAdvisorRole } from "@/lib/auth/roles";

// GET /api/advisor/clients/[id]/businesses
//   List every business_profiles row for this client.
//
// POST /api/advisor/clients/[id]/businesses
//   Create a new business under this client (mirrors client signup but without
//   the personal/identity fields). Atomic-ish multi-table write:
//     1. business_profiles  — the per-business entity
//     2. funding_deals      — the per-application deal (capital, loan type, etc.)
//     3. client_open_positions — existing debt on this business
//     4. client_dynamic_documents — doc requests scoped to this business

async function getAuthedAdvisorContext(clientVaultId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = userRow?.role;
  if (!role || !(CLIENT_API_ROLES as readonly string[]).includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: client, error: clientErr } = await admin
    .from("client_data_vault")
    .select("id, advisor_id, user_id")
    .eq("id", clientVaultId)
    .maybeSingle();

  if (clientErr || !client) {
    return { error: NextResponse.json({ error: "Client not found" }, { status: 404 }) };
  }

  // Scope gate: advisors and external partner advisors are bounded to files they
  // own or follow. Admin and underwriting work every file and skip it.
  if (isScopedAdvisorRole(role)) {
    const { data: me } = await admin
      .from("advisors")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return { error: NextResponse.json({ error: "Advisor profile missing" }, { status: 403 }) };

    const isOwner = client.advisor_id === me.id;
    const { data: followerRow } = await admin
      .from("client_followers")
      .select("id")
      .eq("client_vault_id", clientVaultId)
      .eq("advisor_id", me.id)
      .maybeSingle();
    const isFollower = !!followerRow;

    if (!isOwner && !isFollower) {
      return { error: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
    }
  }

  return { admin, client, role, actorUserId: user.id };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthedAdvisorContext(id);
  if ("error" in ctx) return ctx.error;

  const { data, error } = await ctx.admin
    .from("business_profiles")
    .select("id, client_vault_id, is_primary, display_order, company_name, business_name, industry, company_city, company_state, company_zip_code, avg_monthly_deposits, avg_annual_revenue, employees_count, legal_entity_type, business_start_date, is_home_based, created_at")
    .eq("client_vault_id", id)
    .order("is_primary", { ascending: false })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ businesses: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthedAdvisorContext(id);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const company_name = (body.company_name ?? "").trim();
  if (!company_name) {
    return NextResponse.json({ error: "company_name is required" }, { status: 400 });
  }

  // 1. business_profiles
  const { count } = await ctx.admin
    .from("business_profiles")
    .select("id", { count: "exact", head: true })
    .eq("client_vault_id", id);

  const businessPayload = {
    client_vault_id: id,
    user_id: ctx.client.user_id,
    is_primary: false,
    display_order: count ?? 0,
    company_name,
    business_name: company_name,
    legal_entity_type: body.legal_entity_type ?? null,
    business_start_date: body.business_start_date ?? null,
    company_city: body.company_city ?? null,
    company_state: body.company_state ?? null,
    company_zip_code: body.company_zip_code ?? null,
    avg_monthly_deposits: numericOrNull(body.avg_monthly_deposits),
    avg_annual_revenue: numericOrNull(body.avg_annual_revenue),
    employees_count: numericOrNull(body.employees_count),
    is_home_based: body.is_home_based ?? false,
    industry: body.industry ?? null,
    // Legacy mirror columns.
    city: body.company_city ?? null,
    state: body.company_state ?? null,
    zip: body.company_zip_code ?? null,
    phone: body.phone ?? null,
  };

  const { data: business, error: bpErr } = await ctx.admin
    .from("business_profiles")
    .insert(businessPayload)
    .select("id, client_vault_id, is_primary, display_order, company_name, legal_entity_type, business_start_date, company_city, company_state, company_zip_code, avg_monthly_deposits, avg_annual_revenue, employees_count, is_home_based, industry")
    .single();

  if (bpErr || !business) {
    return NextResponse.json({ error: bpErr?.message || "Failed to create business" }, { status: 500 });
  }

  // 2. funding_deals — ALWAYS create one for a new business. The funding ask
  //    fields are nullable here, so we accept a fully-blank deal as the home
  //    for the Signwell contract that follows. Without a deal there's no
  //    canonical row to hold contract_url / signwell_envelope_id / pipeline
  //    history for this business, and the new-business + sign-contract flows
  //    fall on the floor.
  let funding_deal: any = null;
  const capital_requested = numericOrNull(body.capital_requested);
  const proposed_loan_type = body.proposed_loan_type ?? null;
  const loan_purpose = body.loan_purpose ?? null;
  const funding_eta = body.funding_eta ?? null;

  {
    const { data: deal, error: dealErr } = await ctx.admin
      .from("funding_deals")
      .insert({
        business_profile_id: business.id,
        display_order: 0,
        capital_requested,
        proposed_loan_type,
        loan_purpose,
        funding_eta,
      })
      .select("id, business_profile_id, capital_requested, proposed_loan_type, loan_purpose, funding_eta")
      .single();
    if (dealErr) {
      console.error("Failed to create funding_deal:", dealErr);
    } else {
      funding_deal = deal;
    }
  }

  // 2.5. Kick off a Signwell envelope for this new business. The client will
  //      see a pending-contract banner on their next dashboard load and can
  //      sign without re-running the onboarding flow. Non-fatal: a Signwell
  //      outage (or missing API key in dev) must not roll back the business
  //      creation — the advisor can retry from the client detail page later.
  if (funding_deal?.id) {
    try {
      await generateSignwellEnvelopeForBusiness({
        admin: ctx.admin,
        clientVaultId: id,
        businessId: business.id,
        fundingDealId: funding_deal.id,
      });
    } catch (sigErr: any) {
      console.error("Signwell envelope creation failed (non-fatal):", sigErr?.message ?? sigErr);
    }
  }

  // 3. client_open_positions — existing debt on this business.
  const openPositions: any[] = Array.isArray(body.open_positions) ? body.open_positions : [];
  const VALID_FREQUENCIES = new Set(["Daily", "Weekly", "Bi-Weekly", "Monthly"]);
  const intOrNull = (v: any): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  };
  const positionsToInsert = openPositions
    .filter((p) => (p?.lender_name ?? "").toString().trim() && (p?.loan_type ?? "").toString().trim())
    .slice(0, 5)
    .map((p, idx) => {
      const freq = typeof p.payment_frequency === "string" ? p.payment_frequency.trim() : "";
      return {
        client_vault_id: id,
        business_profile_id: business.id,
        position_number: idx + 1,
        lender_name: String(p.lender_name).trim(),
        loan_type: String(p.loan_type).trim(),
        initial_balance: numericOrNull(p.initial_balance),
        current_balance: numericOrNull(p.current_balance),
        payment_amount: numericOrNull(p.payment_amount),
        payment_frequency: VALID_FREQUENCIES.has(freq) ? freq : null,
        term_remaining: intOrNull(p.term_remaining),
        // Legacy free-text column — mirror cadence so old readers don't blank.
        payment_term: VALID_FREQUENCIES.has(freq) ? freq : (p.payment_term ?? null),
      };
    });

  if (positionsToInsert.length > 0) {
    const { error: posErr } = await ctx.admin.from("client_open_positions").insert(positionsToInsert);
    if (posErr) console.error("Failed to insert open_positions:", posErr);
  }

  // 4. client_dynamic_documents — doc requests for THIS business.
  //    body.requested_doc_codes: string[] of required_documents.code values.
  //    Client-scoped doc codes (driver's license, MyScoreIQ, PFS) are stripped
  //    server-side: they belong to the person, not the business, and the
  //    primary business already collected them at signup. Letting them through
  //    would create a redundant "Awaiting Upload" entry on this new tab.
  const docCodes: string[] = (
    Array.isArray(body.requested_doc_codes) ? body.requested_doc_codes : []
  ).filter((code: string) => !CLIENT_SCOPED_DOC_CODES.includes(code as any));
  if (docCodes.length > 0) {
    const { data: docDefs } = await ctx.admin
      .from("required_documents")
      .select("id, code")
      .in("code", docCodes);

    if (docDefs && docDefs.length > 0) {
      const docRows = docDefs.map((d: any) => ({
        user_id: ctx.client.user_id,
        document_id: d.id,
        business_profile_id: business.id,
        funding_deal_id: funding_deal?.id ?? null,
        is_active: true,
        requested_at: new Date().toISOString(),
        requested_via: "advisor_add_business",
      }));
      const { error: docErr } = await ctx.admin
        .from("client_dynamic_documents")
        .upsert(docRows, { onConflict: "business_profile_id, document_id" });
      if (docErr) console.error("Failed to insert dynamic_documents:", docErr);
    }
  }

  // 5. Notify the client + advisor (+ followers) by email. Best-effort: a
  //    send failure must not roll back the business creation. The client gets
  //    To:, advisor + followers get CC: so everyone is in the loop.
  try {
    await sendNewBusinessEmail({
      admin: ctx.admin,
      clientVaultId: id,
      business,
      funding_deal,
      requestedDocCodes: docCodes,
    });
  } catch (emailErr) {
    console.error("New-business email failed (non-fatal):", emailErr);
  }

  return NextResponse.json({ business, funding_deal }, { status: 201 });
}

async function sendNewBusinessEmail(args: {
  admin: any;
  clientVaultId: string;
  business: any;
  funding_deal: any | null;
  requestedDocCodes: string[];
}) {
  const { admin, clientVaultId, business, funding_deal, requestedDocCodes } = args;

  // Resolve client identity + assigned advisor in one query.
  const { data: client } = await admin
    .from("client_data_vault")
    .select(`
      client_name, client_email, advisor_id,
      advisors:advisor_id (first_name, last_name, email, phone)
    `)
    .eq("id", clientVaultId)
    .maybeSingle();

  if (!client || !client.client_email) {
    console.warn("Skipping new-business email: client or client_email missing");
    return;
  }

  // Resolve follower advisor emails (CC list).
  const { data: followers } = await admin
    .from("client_followers")
    .select("advisors:advisor_id (email)")
    .eq("client_vault_id", clientVaultId);
  const advisor_cc_emails = (followers ?? [])
    .map((f: any) => f?.advisors?.email)
    .filter((e: any): e is string => typeof e === "string" && e.length > 0);

  // Human-readable doc labels for the email body.
  let requested_document_labels: string[] = [];
  if (requestedDocCodes.length > 0) {
    const { data: docDefs } = await admin
      .from("required_documents")
      .select("code, label")
      .in("code", requestedDocCodes);
    requested_document_labels = (docDefs ?? []).map((d: any) => d.label || d.code);
  }

  const advisor_name = client.advisors
    ? `${client.advisors.first_name ?? ""} ${client.advisors.last_name ?? ""}`.trim() || "Your Advisor"
    : "Your Advisor";
  const advisor_email: string =
    client.advisors?.email ||
    process.env.SMTP_FROM_EMAIL ||
    process.env.SMTP_USER ||
    "noreply@creditbanc.io";

  const login_url = `${process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io"}/dashboard`;

  const { send_new_business_added_notification } = await import("@/lib/email");
  await send_new_business_added_notification({
    client_name: client.client_name,
    client_email: client.client_email,
    advisor_name,
    advisor_email,
    advisor_phone: client.advisors?.phone || undefined,
    advisor_cc_emails,
    business: {
      company_name: business.company_name,
      legal_entity_type: business.legal_entity_type,
      industry: business.industry,
      company_city: business.company_city,
      company_state: business.company_state,
      business_start_date: business.business_start_date,
      employees_count: business.employees_count,
    },
    funding: funding_deal
      ? {
          capital_requested: funding_deal.capital_requested,
          proposed_loan_type: funding_deal.proposed_loan_type,
          loan_purpose: funding_deal.loan_purpose,
          funding_eta: funding_deal.funding_eta,
        }
      : undefined,
    requested_documents: requested_document_labels,
    login_url,
  });
}

function numericOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Creates a Signwell envelope tied to a specific business + funding deal and
 * stamps the resulting signing URL + envelope ID onto the funding_deal row.
 *
 * Field source: business_profiles for company info, client_data_vault for
 * the human's identity (name, email, SSN, address). The Signwell template
 * itself stays the same as the primary onboarding flow — only the field
 * source switches. Personal Term Loan template path is preserved for the
 * minority of deals on that product.
 *
 * Best-effort: every error bubbles up to the caller's catch so a failed
 * envelope creation doesn't block the business creation transaction.
 */
async function generateSignwellEnvelopeForBusiness(args: {
  admin: any;
  clientVaultId: string;
  businessId: string;
  fundingDealId: string;
}): Promise<void> {
  const { admin, clientVaultId, businessId, fundingDealId } = args;

  // Pull the client identity (for SSN/email/owner name) and the business
  // (for company fields). One read each — they're keyed lookups.
  const { data: vault } = await admin
    .from("client_data_vault")
    .select(
      "id, client_name, client_email, client_phone, ssn, ein, home_address, business_address, owner_1_ownership_pct"
    )
    .eq("id", clientVaultId)
    .maybeSingle();
  if (!vault || !vault.client_email) {
    console.warn("Signwell skip: client/vault not found or missing email");
    return;
  }

  const { data: biz } = await admin
    .from("business_profiles")
    .select("id, company_name, company_city, company_state, company_zip_code, legal_entity_type, business_start_date, industry, phone, avg_annual_revenue, avg_monthly_deposits")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz) {
    console.warn("Signwell skip: business_profile not found");
    return;
  }

  const { data: deal } = await admin
    .from("funding_deals")
    .select("id, capital_requested, proposed_loan_type, loan_purpose")
    .eq("id", fundingDealId)
    .maybeSingle();

  const isPersonalTermLoan = (deal?.proposed_loan_type || "") === "Personal Term Loan";
  const templateId = isPersonalTermLoan
    ? process.env.SIGNWELL_PTL_TEMPLATE_ID
    : process.env.SIGNWELL_TEMPLATE_ID;
  if (!templateId) {
    console.warn(`Signwell skip: ${isPersonalTermLoan ? "SIGNWELL_PTL_TEMPLATE_ID" : "SIGNWELL_TEMPLATE_ID"} not set`);
    return;
  }

  const firstName = (vault.client_name || "").split(" ")[0] || "";
  const lastName = (vault.client_name || "").split(" ").slice(1).join(" ") || "";
  const today = new Date();
  const agreementDay = today.getDate().toString();
  const agreementMonth = today.toLocaleString("default", { month: "long" });

  let fields: Record<string, string>;
  if (isPersonalTermLoan) {
    fields = {
      application_client_firstname: firstName,
      application_client_lastname: lastName,
      application_client_ssn: vault.ssn || "",
      application_email: vault.client_email,
      funding_amount_requested: (deal?.capital_requested ?? "").toString(),
    };
  } else {
    fields = {
      application_business_name: biz.company_name ?? "",
      application_dba: "",
      application_taxid: vault.ein ?? "",
      application_state_of_incorporation: biz.company_state ?? "",
      application_business_start_date: biz.business_start_date ?? "",
      application_industry: biz.industry ?? "",
      application_address: vault.business_address ?? "",
      application_city: biz.company_city ?? "",
      application_state: biz.company_state ?? "",
      application_zip_code: biz.company_zip_code ?? "",
      physical_location_phone: vault.client_phone ?? "",
      preferred_contact_phone: vault.client_phone ?? "",
      application_cell: vault.client_phone ?? "",
      application_fax: "",
      application_email: vault.client_email,
      application_website: "",
      gross_annual_revenue: (biz.avg_annual_revenue ?? "").toString(),
      avg_monthly_cc_sales: (biz.avg_monthly_deposits ?? "").toString(),
      funding_amount_requested: (deal?.capital_requested ?? "").toString(),
      monthly_bank_deposit: (biz.avg_monthly_deposits ?? "").toString(),
      use_of_funds: deal?.loan_purpose ?? "",

      application_client_firstname: firstName,
      application_client_lastname: lastName,
      application_client_ownership: (vault.owner_1_ownership_pct ?? "").toString(),
      application_client_dob: "",
      application_client_ssn: vault.ssn ?? "",
      application_client_email2: vault.client_email,
      application_client_street_address: vault.home_address ?? "",
      application_client_city: "",
      application_client_state: "",
      application_client_zipcode: "",
      application_client_homephone: vault.client_phone ?? "",
      application_client_cellphone: vault.client_phone ?? "",
      application_client_name: vault.client_name ?? "",

      agreement_day: agreementDay,
      agreement_month: agreementMonth,
    };
  }

  const { signingUrl, embeddedSigningUrl, documentId } = await signWell.createDocument({
    templateId,
    recipientEmail: vault.client_email,
    recipientName: vault.client_name || vault.client_email,
    fields,
  });

  const baseUrl = embeddedSigningUrl || signingUrl;
  const contractUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}doc_id=${documentId}`;

  const { error: updErr } = await admin
    .from("funding_deals")
    .update({
      contract_url: contractUrl,
      signwell_envelope_id: documentId,
    })
    .eq("id", fundingDealId);
  if (updErr) {
    console.error("Failed to stamp contract on funding_deal:", updErr.message);
  }
}
