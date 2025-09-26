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
    const p = ClientSignupSchema.parse(body);

    // ---------- 1) GHL CONTACT
    const firstName = p.first_name.trim();
    const lastName = p.last_name.trim() || null;

    const cf = (idEnv: string, value: any) =>
      process.env[idEnv] ? { id: process.env[idEnv]!, value } : null;

    const customFields = [
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
      firstName,
      lastName,
      email: p.email,
      phone: p.phone,
      companyName: p.company_legal_name,
      city: p.city,
      state: p.state,
      postalCode: p.zip,
      country: "US",
      tags: [],
      customFields,
    });

    // ---------- 2) SUPABASE USER (SIN password + invite/magic link)
    const { data: existingUserRow } = await admin
      .from("users")
      .select("id")
      .eq("email", p.email.toLowerCase())
      .maybeSingle();

    let userId = existingUserRow?.id as string | undefined;
    let action_link: string | undefined;

    if (!userId) {
      // Crear user en Auth sin password
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: p.email,
          email_confirm: true,
          user_metadata: {
            full_name: `${p.first_name} ${p.last_name}`,
            company: p.company_legal_name,
            must_set_password: true,
          },
        });
      if (createErr) throw createErr;
      userId = created.user!.id;

      // Invite link inicial
      const { data: linkData, error: linkErr } =
        await admin.auth.admin.generateLink({
          type: "invite",
          email: p.email,
          options: {
            redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/set-password`,
          },
        });
      if (linkErr) throw linkErr;
      action_link = (linkData as any)?.properties?.action_link;
    } else {
      // Ya existía → forzar must_set_password y mandar magic link
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: { must_set_password: true },
      });

      const { data: linkData, error: linkErr } =
        await admin.auth.admin.generateLink({
          type: "magiclink",
          email: p.email,
          options: {
            redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/set-password`,
          },
        });
      if (linkErr) throw linkErr;
      action_link = (linkData as any)?.properties?.action_link;
    }

    // Bienvenida vía n8n (si está configurado)
    if (process.env.N8N_WEBHOOK_WELCOME && action_link) {
      fetch(process.env.N8N_WEBHOOK_WELCOME, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: p.email,
          full_name: `${p.first_name} ${p.last_name}`,
          portal_url: action_link,
        }),
      }).catch(() => {});
    }

    // ---------- 3) USERS + BUSINESS_PROFILE
    await admin.from("users").upsert({
      id: userId!,
      email: p.email.toLowerCase(),
      first_name: p.first_name,
      last_name: p.last_name,
      role: "free",
    });

    const { data: bp } = await admin
      .from("business_profiles")
      .upsert({
        user_id: userId!,
        business_name: p.company_legal_name,
        industry: p.industry_1 ?? p.industry_2 ?? p.industry_3 ?? null,
        monthly_revenue: String(p.avg_monthly_deposits),
        annual_revenue_last_year: String(p.annual_revenue),
        business_model: p.legal_entity_type,
        primary_goal: p.use_of_funds,
      })
      .select("id")
      .single();
    const profile_id = bp!.id;

    // ---------- 4) OWNERS / LOANS / FLAGS
    if (p.owners?.length) {
      await admin.from("business_owners").insert(
        p.owners.map((o) => ({
          profile_id,
          full_name: `${o.first_name} ${o.last_name}`,
          ownership_pct: o.ownership_pct,
        }))
      );
    }

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

    await admin.from("application_flags").upsert({
      profile_id,
      defaulted_on_mca: p.defaulted_on_mca ?? null,
      reduced_mca_payments: p.reduced_mca_payments ?? null,
      owns_real_estate: p.owns_real_estate ?? null,
      personal_cc_debt_over_75k: p.personal_cc_debt_over_75k ?? null,
      foreclosures_or_bankruptcies_3y: p.foreclosures_or_bankruptcies_3y ?? null,
      tax_liens: p.tax_liens ?? null,
      how_soon_funds: p.how_soon_funds ?? null,
      employees_count: p.employees_count ?? null,
      additional_info: p.additional_info ?? null,
    });

    // ---------- 5) Integrations
    await admin
      .from("integrations")
      .upsert({ profile_id, ghl_contact_id, last_push_at: new Date().toISOString() });

    // ---------- 6) Vault state & eventos
    await admin
      .from("user_vault_profiles")
      .upsert({ user_id: userId!, current_product_tag: "Pre-Approval" });

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
        // proposed_loan_type: p.proposed_loan_type, // <- añádelo si lo reintroduces en el schema
      },
      actor: p.advisor_id ?? null,
    });

    // ---------- 7) Tags en GHL
    const docTags = p.documents_requested.map((d) =>
      d.toLowerCase().replace(/\s+/g, "_")
    );
    const stateTags = ["portal_created", "vault_pre_approval"];
    await ghlAddTags(ghl_contact_id, [...docTags, ...stateTags]);
    await admin.from("events").insert({
      profile_id,
      type: "tags_applied",
      payload: { tags: [...docTags, ...stateTags] },
    });

    return NextResponse.json({
      ok: true,
      profile_id,
      user_id: userId,
      ghl_contact_id,
      invite_link: action_link,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 400 });
  }
}
