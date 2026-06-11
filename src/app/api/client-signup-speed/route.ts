// src/app/api/client-signup-speed/route.ts
//
// SPEED FORM signup — the fast-track alternative to /api/client-signup.
//
// The rep fills a one-page form (the highlighted fields of the paper FUNDING
// APPLICATION) while on the phone with the client, including the documents
// they'll need. This endpoint then:
//   - creates the auth user + vault row (signup_flow = 'speed')
//   - does NOT stamp data_vault_submitted_at — the client still completes
//     onboarding Step 1 (Tax ID / SSN / industry / addresses) before the
//     SignWell application signing step
//   - parks the selected doc codes in pending_document_requests — documents
//     are NOT seeded and NO requested_* tags are applied here
//   - returns the magic link so the rep can have the client sign during the call
//
// The document request goes out ONLY after the client signs the application:
// the SignWell webhook calls releaseSpeedFormDocs() (src/lib/speed-form.ts).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';
import { send_client_welcome_email } from '@/lib/email';
import { syncUnifiedClientData, generateSecurePassword } from '@/lib/user-management';
import { ghlSearchContacts, ghlUpdateContact } from '@/lib/ghl-api';
import { generateOnboardingMagicLink, pushMagicLinkToGhl } from '@/lib/magic-link';

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** Same upsert helper as /api/client-signup (GHL API v2 /upsert endpoint). */
async function ghl_upsert_contact(contact_data: any): Promise<string> {
  const ghl_api_key = process.env.GHL_API_KEY;
  const ghl_location_id = process.env.GHL_LOCATION_ID;

  if (!ghl_api_key || !ghl_location_id) {
    throw new Error('GHL_API_KEY or GHL_LOCATION_ID not configured in environment variables');
  }

  const upsert_response = await fetch(
    'https://services.leadconnectorhq.com/contacts/upsert',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(contact_data)
    }
  );

  if (!upsert_response.ok) {
    const error_text = await upsert_response.text();
    console.error('❌ GHL upsert error:', {
      status: upsert_response.status,
      statusText: upsert_response.statusText,
      error: error_text
    });
    throw new Error(`Error creating/updating GHL contact (${upsert_response.status}): ${error_text}`);
  }

  const response_data = await upsert_response.json();
  const contact_id = response_data.contact?.id || response_data.id;

  if (!contact_id) {
    console.error('❌ GHL response missing contact ID:', response_data);
    throw new Error('GHL response does not include a valid contact ID');
  }

  return contact_id;
}

async function ghl_add_tags(contact_id: string, tags: string[]): Promise<void> {
  const ghl_api_key = process.env.GHL_API_KEY;
  if (!ghl_api_key) throw new Error('GHL_API_KEY is not configured');
  if (!tags || tags.length === 0) return;

  const response = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contact_id}/tags`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ tags })
    }
  );

  if (!response.ok) {
    const error_text = await response.text();
    console.error('❌ Error adding GHL tags:', { status: response.status, contact_id, tags, error: error_text });
    throw new Error(`Error adding GHL tags: ${error_text}`);
  }
}

function create_custom_field(field_id_env: string, value: any, fallback_id?: string) {
  if (value === undefined || value === null || value === '') return null;
  const field_id = process.env[field_id_env] || fallback_id;
  if (!field_id) {
    console.warn(`⚠️ Custom field ID not found in .env and no fallback: ${field_id_env}`);
    return null;
  }
  return { id: field_id, value: String(value) };
}

function is_valid_email(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function is_valid_positive_number(value: any): boolean {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0;
}

/** Valid doc codes the speed form may request — mirrors the full form's DOC_TAG_MAP. */
const VALID_DOC_CODES = new Set([
  'business_bank_statements',
  'tax_returns',
  'profit_loss',
  'balance_sheets',
  'debt_schedule',
  'ar_report',
  'drivers_license',
  'voided_check',
]);

export async function POST(request: Request) {
  try {
    console.log('⚡ Starting SPEED FORM client signup...');

    // ========== STEP 1: PARSE AND VALIDATE ==========
    const body = await request.json();

    const required_fields: [string, string][] = [
      ['client_name', 'Client Full Name'],
      ['company_name', 'Company Name'],
      ['client_phone', 'Cell Phone #'],
      ['client_email', 'Email Address'],
      ['legal_entity_type', 'Type of Business Entity'],
      ['business_start_date', 'Business Start Date'],
      ['company_city', 'Business City'],
      ['company_state', 'Business State'],
      ['company_zip_code', 'Zip Code'],
      ['avg_annual_revenue', 'Gross Annual Revenue'],
      ['avg_monthly_deposits', 'Monthly Bank Deposit Volume'],
      ['capital_requested', 'Funding Amount Requested'],
      ['credit_score', 'Approximate Credit Score'],
      ['loan_purpose', 'Use of Funds'],
      ['proposed_loan_type', 'Proposed Loan Type'],
    ];

    const missing = required_fields
      .filter(([key]) => !body[key] || !String(body[key]).trim())
      .map(([, label]) => label);

    if (missing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Missing required fields: ${missing.join(', ')}` },
        { status: 400 }
      );
    }

    if (!is_valid_email(body.client_email)) {
      return NextResponse.json(
        { success: false, error: 'The provided email is not valid' },
        { status: 400 }
      );
    }

    if (!is_valid_positive_number(body.capital_requested)) {
      return NextResponse.json(
        { success: false, error: 'Funding amount requested must be a number greater than 0' },
        { status: 400 }
      );
    }

    // Documents the client will owe after signing — held until then.
    // (Overridden to business bank statements only for setters, below.)
    let pending_doc_codes: string[] = Array.from(new Set(
      (Array.isArray(body.documents_requested) ? body.documents_requested : [])
        .filter((code: any) => typeof code === 'string' && VALID_DOC_CODES.has(code))
    ));

    if (pending_doc_codes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Select at least one document to request.' },
        { status: 400 }
      );
    }

    const client_name = String(body.client_name).trim();
    console.log('✅ Speed form validations passed');

    // ========== STEP 1.5: RESOLVE ADVISOR FROM SESSION (REQUIRED) ==========
    // Same rule as /api/client-signup: the session is the only source of truth.
    const session_supabase = await createServerSupabaseClient();
    const { data: { user: session_user }, error: session_err } =
      await session_supabase.auth.getUser();

    if (session_err || !session_user) {
      console.error('❌ client-signup-speed: no authenticated session', session_err);
      return NextResponse.json(
        { success: false, error: 'Authentication required to create a client.' },
        { status: 401 }
      );
    }

    // Resolve the session user's role. Setters (appointment setters) are NOT
    // advisors — they have a create-only fast-funding dashboard, and every
    // client they create is assigned to a fixed advisor stored on their own
    // users.setter_advisor_id. Everyone else resolves the advisor from their
    // own advisors row, exactly as before. See [[role_model]].
    const { data: session_user_row } = await supabase_admin
      .from('users')
      .select('role, setter_advisor_id')
      .eq('id', session_user.id)
      .maybeSingle();

    let advisor_row:
      | {
          id: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          ghl_user_id: string | null;
          user_id: string | null;
        }
      | null = null;

    if (session_user_row?.role === 'setter') {
      // ----- SETTER: assign to the advisor linked on the setter's user row -----
      if (!session_user_row.setter_advisor_id) {
        console.error(`❌ client-signup-speed: setter ${session_user.id} has no setter_advisor_id`);
        return NextResponse.json(
          { success: false, error: 'Your setter account is not linked to an advisor yet. Contact an admin.' },
          { status: 403 }
        );
      }
      const { data: target_advisor } = await supabase_admin
        .from('advisors')
        .select('id, first_name, last_name, email, phone, ghl_user_id, user_id')
        .eq('id', session_user_row.setter_advisor_id)
        .maybeSingle();
      advisor_row = target_advisor ?? null;
      if (!advisor_row) {
        console.error(
          `❌ client-signup-speed: setter ${session_user.id} linked advisor ${session_user_row.setter_advisor_id} not found`
        );
        return NextResponse.json(
          { success: false, error: 'The advisor linked to your setter account no longer exists. Contact an admin.' },
          { status: 403 }
        );
      }
      console.log(`✅ Setter ${session_user.id} → assigning client to advisor ${advisor_row.id}`);

      // Setters never choose docs or loan type — force the house defaults
      // server-side regardless of payload. The trimmed setter form already
      // sends these; this guarantees it even if the request is crafted. The
      // assigned advisor refines the client afterward.
      pending_doc_codes = ['business_bank_statements'];
      body.proposed_loan_type = 'other';
    } else {
      // ----- ADVISOR/ADMIN: resolve the advisor from the session (REQUIRED) -----
      const { data: by_user } = await supabase_admin
        .from('advisors')
        .select('id, first_name, last_name, email, phone, ghl_user_id, user_id')
        .eq('user_id', session_user.id)
        .maybeSingle();
      advisor_row = by_user ?? null;

      if (!advisor_row && session_user.email) {
        const { data: by_email } = await supabase_admin
          .from('advisors')
          .select('id, first_name, last_name, email, phone, ghl_user_id, user_id')
          .ilike('email', session_user.email)
          .maybeSingle();
        advisor_row = by_email ?? null;

        if (advisor_row && !advisor_row.user_id) {
          await supabase_admin
            .from('advisors')
            .update({ user_id: session_user.id })
            .eq('id', advisor_row.id);
          console.log(`🔧 Linked advisor ${advisor_row.id} to user_id ${session_user.id}`);
        }
      }

      if (!advisor_row) {
        console.error(
          `❌ client-signup-speed: session user ${session_user.id} (${session_user.email}) has no advisors row`
        );
        return NextResponse.json(
          {
            success: false,
            error:
              'No advisor record found for the current user. Contact an admin to link your advisor profile before creating clients.',
          },
          { status: 403 }
        );
      }
    }

    const advisor_id = advisor_row.id;
    const advisor_name =
      `${advisor_row.first_name ?? ''} ${advisor_row.last_name ?? ''}`.trim() || 'Unknown';
    console.log(`✅ Advisor resolved: ${advisor_id} (${advisor_name})`);

    // ========== STEP 2: CREATE/UPDATE USER IN AUTH ==========
    const { data: existing_user } = await supabase_admin.auth.admin
      .listUsers()
      .then(res => ({
        data: res.data.users.find(u => u.email === body.client_email.toLowerCase())
      }));

    let user_id = existing_user?.id;

    // ========== STEP 2.0: DUPLICATE-CLIENT GUARD (same as standard flow) ==========
    {
      if (existing_user) {
        const { data: emailDup } = await supabase_admin
          .from('client_data_vault')
          .select('id, client_name')
          .eq('user_id', existing_user.id)
          .maybeSingle();
        if (emailDup) {
          console.warn(`🚫 Duplicate client blocked (email): ${body.client_email} already belongs to ${emailDup.client_name} (${emailDup.id})`);
          return NextResponse.json({
            success: false,
            error: `A client already exists with this email — ${emailDup.client_name}. To add another business for them, open their profile and use “Add Another Business” instead of creating a new client.`,
            duplicate: { client_vault_id: emailDup.id, client_name: emailDup.client_name, matched_on: 'email' },
          }, { status: 409 });
        }
      }

      const normalizedPhone = (body.client_phone || '').replace(/\D/g, '');
      if (normalizedPhone.length >= 10) {
        const { data: phoneCandidates } = await supabase_admin
          .from('client_data_vault')
          .select('id, client_name, client_phone, user_id');
        const phoneDup = (phoneCandidates || []).find(
          (v: { client_phone: string | null; user_id: string | null }) =>
            (v.client_phone || '').replace(/\D/g, '') === normalizedPhone && v.user_id !== user_id
        );
        if (phoneDup) {
          console.warn(`🚫 Duplicate client blocked (phone): ${body.client_phone} already belongs to ${phoneDup.client_name} (${phoneDup.id})`);
          return NextResponse.json({
            success: false,
            error: `A client already exists with this phone number — ${phoneDup.client_name}. To add another business for them, open their profile and use “Add Another Business” instead of creating a new client.`,
            duplicate: { client_vault_id: phoneDup.id, client_name: phoneDup.client_name, matched_on: 'phone' },
          }, { status: 409 });
        }
      }
    }

    const temporary_password = generateSecurePassword();

    if (!user_id) {
      const { data: created_user, error: create_error } = await supabase_admin.auth.admin.createUser({
        email: body.client_email.toLowerCase(),
        password: temporary_password,
        email_confirm: true,
        user_metadata: {
          full_name: client_name,
          company: body.company_name,
          should_change_password: true,
          created_by: 'advisor',
          advisor_name: advisor_name
        },
      });

      if (create_error) {
        console.error('❌ Error creating user:', create_error);
        throw new Error(`Error creating user in Auth: ${create_error.message}`);
      }

      user_id = created_user.user!.id;
      console.log(`✅ New user created in Auth: ${user_id}`);
    } else {
      await supabase_admin.auth.admin.updateUserById(user_id, {
        password: temporary_password,
        email_confirm: true,
        user_metadata: {
          should_change_password: true,
          full_name: client_name,
          company: body.company_name,
          updated_by: 'advisor',
          advisor_name: advisor_name
        }
      });
      console.log(`✅ Existing user updated in Auth: ${user_id}`);
    }

    // ========== STEP 2.5: SYNC TO UNIFIED TABLES ==========
    await syncUnifiedClientData(supabase_admin, {
      userId: user_id,
      email: body.client_email,
      clientName: client_name,
      companyName: body.company_name,
      role: 'free',
      phone: body.client_phone,
      state: body.company_state,
      city: body.company_city,
      zipCode: body.company_zip_code,
      advisorId: advisor_id,
      advisorName: advisor_name,
    });
    console.log(`✅ User sync completed for ${user_id}`);

    // ========== STEP 3: GHL CONTACT (custom fields subset the speed form captures) ==========
    const custom_fields = [
      create_custom_field('GHL_CF_CLIENTS_NAME', client_name, 'htTNeG6SjgBb816NXzrM'),
      create_custom_field('GHL_CF_BUSINESS_NAME', body.company_name, '4wCc6YtOB59baJTrMOsZ'),
      create_custom_field('GHL_CF_CLIENTS_PHONE', body.client_phone, 'BUdnGXCgH53LOYqZdEam'),
      create_custom_field('GHL_CF_CLIENT_EMAIL', body.client_email, 'QSNzz62RcqhaEgqyP8hg'),
      create_custom_field('GHL_CF_COMPANY_STATE', body.company_state, 'qjSxhRyhQUzlGkyCHeV4'),
      create_custom_field('GHL_CF_COMPANY_CITY', body.company_city, 'sD6tg1NRCj9uHsc7xdZW'),
      create_custom_field('GHL_CF_COMPANY_ZIP', body.company_zip_code, 'el0Wrlnb8pH30cfMkEhw'),
      create_custom_field('GHL_CF_CAPITAL_REQUESTED', body.capital_requested, 'e3a1kLHpSXOtJcXvch9E'),
      create_custom_field('GHL_CF_LOAN_PURPOSE', body.loan_purpose, 'bI6KKdbP0spHXNOa463U'),
      create_custom_field('GHL_CF_PROPOSED_LOAN_TYPE', body.proposed_loan_type, 'geBSb3HaQsXl7mTjKkH6'),
      create_custom_field('GHL_CF_AVG_MONTHLY_DEPOSITS', body.avg_monthly_deposits, 'jO6EKKiJWP0WhJG5TnGS'),
      create_custom_field('GHL_CF_ANNUAL_REVENUE', body.avg_annual_revenue, '3rXoSHebmerVIqMA1l8X'),
      create_custom_field('GHL_CF_LEGAL_ENTITY_TYPE', body.legal_entity_type, 'FugwTFOGp9pKo5SwHesK'),
      create_custom_field('GHL_CF_BUSINESS_START_DATE', body.business_start_date, '4qvVNBqq2ZSz0MtaUwdy'),
      create_custom_field('GHL_CF_NUMBER_OF_OWNERS', 'One', 'wfXQNMs2DhSqrYYqq5A7'),
      create_custom_field('GHL_CF_OWNER_1_NAME', client_name, 'PaOPABkLZL3ZWxZxFrTV'),
      create_custom_field('GHL_CF_OWNER_1_PCT', '100', 'DsjleQk3ABfV8AjtNTD1'),
      create_custom_field('GHL_CF_CREDIT_SCORE', body.credit_score, 'G8suhHNaeaujGmC0fvk8'),
    ].filter(Boolean);

    const advisor_ghl_user_id: string | null = advisor_row.ghl_user_id || null;
    const advisor_email: string | null = advisor_row.email || null;
    const advisor_phone: string | null = advisor_row.phone || null;

    console.log('🔍 Searching for existing GHL contact...');
    const existingContacts = await ghlSearchContacts({
      email: body.client_email.toLowerCase(),
      phone: body.client_phone,
      name: client_name,
      locationId: process.env.GHL_LOCATION_ID!
    });

    let ghl_contact_id: string;

    // The speed form captures a single full name — split it for GHL's
    // first/last fields. Address/state are collected later in onboarding Step 1.
    const [ghl_first_name, ...ghl_last_parts] = client_name.split(' ');
    const ghl_contact_payload: any = {
      firstName: ghl_first_name || client_name,
      lastName: ghl_last_parts.join(' ') || '',
      email: body.client_email.toLowerCase(),
      phone: body.client_phone || '',
      companyName: body.company_name,
      city: body.company_city || '',
      state: body.company_state,
      postalCode: body.company_zip_code,
      country: 'US',
      customFields: custom_fields
    };
    if (advisor_ghl_user_id) {
      ghl_contact_payload.assignedTo = advisor_ghl_user_id;
    }

    if (existingContacts.length > 0) {
      ghl_contact_id = existingContacts[0].id;
      console.log(`✅ Found existing GHL contact: ${ghl_contact_id}`);
      await ghlUpdateContact(ghl_contact_id, ghl_contact_payload);
      console.log(`✅ GHL contact updated with speed form data: ${ghl_contact_id}`);
    } else {
      console.log('📝 No existing contact found, creating new GHL contact...');
      try {
        ghl_contact_id = await ghl_upsert_contact({
          locationId: process.env.GHL_LOCATION_ID,
          tags: ['vault-user'],
          ...ghl_contact_payload,
        });
        console.log(`✅ GHL contact created: ${ghl_contact_id}`);
      } catch (ghl_error: any) {
        // Same "duplicated contacts" collision handling as the standard flow
        if (ghl_error.message.includes('duplicated contacts')) {
          console.log('⚠️ GHL duplicate contact detected. Extracting ID...');
          const error_json_str = ghl_error.message.split('): ')[1];
          const error_json = JSON.parse(error_json_str);
          if (error_json.meta?.contactId) {
            ghl_contact_id = error_json.meta.contactId;
            console.log(`✅ Linked to existing GHL contact via error metadata: ${ghl_contact_id}`);
            await ghlUpdateContact(ghl_contact_id, ghl_contact_payload);
          } else {
            throw ghl_error;
          }
        } else {
          throw ghl_error;
        }
      }
    }

    // ========== STEP 4: SAVE TO CLIENT_DATA_VAULT ==========
    // The speed form collects everything onboarding Step 1 would have asked for
    // (EIN, SSN, industry, addresses), so data_vault_submitted_at is stamped
    // now — the client's magic link drops them straight on the application
    // signing step.
    const now_iso = new Date().toISOString();
    const vault_data: any = {
      user_id: user_id,
      advisor_name: advisor_name,
      advisor_id: advisor_id,
      ghl_contact_id: ghl_contact_id || null,
      ghl_last_sync_at: ghl_contact_id ? now_iso : null,
      ghl_sync_error: !ghl_contact_id ? 'GHL sync failed during signup' : null,

      // Speed-flow control
      signup_flow: 'speed',
      pending_document_requests: pending_doc_codes,
      pending_docs_released_at: null,

      // Basic client information
      client_name: client_name,
      company_name: body.company_name,
      client_phone: body.client_phone,
      client_email: body.client_email.toLowerCase(),

      // Business information
      business_start_date: body.business_start_date,

      // Location — collected on the speed form so the SignWell application is
      // filled with real values (no Unknown/00000 placeholders).
      company_city: body.company_city,
      company_state: body.company_state,
      company_zip_code: body.company_zip_code,

      // Financial information
      capital_requested: parseFloat(body.capital_requested),
      loan_purpose: body.loan_purpose,
      proposed_loan_type: body.proposed_loan_type,
      avg_monthly_deposits: parseFloat(body.avg_monthly_deposits),
      avg_annual_revenue: parseFloat(body.avg_annual_revenue),
      credit_score: body.credit_score,
      legal_entity_type: body.legal_entity_type,

      // Owner 1 — only name + ownership. EIN/SSN/industry/addresses/DOB are
      // collected from the client in onboarding Step 1, not here.
      number_of_owners: 'One',
      owner_1_name: client_name,
      owner_1_ownership_pct: 100,

      // NOT NULL columns the speed form deliberately doesn't ask — neutral
      // defaults; refined later from onboarding Step 1 / the client profile.
      is_home_based: false,
      employees_count: 1,
      has_existing_loans: false,
      has_defaulted_mca: false,
      owns_real_estate: false,
      has_reduced_mca_payments: false,
      has_bankruptcy_foreclosure_3y: false,
      has_tax_liens: false,
      has_active_judgements: false,
      funding_eta: 'Immediately',
      additional_notes: body.additional_notes || 'Created via Speed Form',

      // Metadata — data_vault_submitted_at is intentionally NOT set, so the
      // client lands on onboarding Step 1 before signing the application.
      status: 'active',
      submitted_at: now_iso,
      updated_at: now_iso,
      contract_completed: false,
      contract_completed_at: null,
    };

    let vault_id: string;
    const { data: vault_entry, error: vault_error } = await supabase_admin
      .from('client_data_vault')
      .upsert(vault_data, { onConflict: 'user_id' })
      .select('id')
      .single();

    if (vault_error) {
      if (vault_error.code === '23505' && vault_error.message.includes('ghl_contact_id') && vault_data.ghl_contact_id) {
        console.log('⚠️ Conflict detected on ghl_contact_id, re-routing upsert...');
        const { data: retry_entry, error: retry_error } = await supabase_admin
          .from('client_data_vault')
          .upsert(vault_data, { onConflict: 'ghl_contact_id' })
          .select('id')
          .single();

        if (retry_error) {
          console.error('❌ Error saving to client_data_vault on retry:', retry_error);
          throw new Error(`Error saving to client_data_vault (retry): ${retry_error.message}`);
        }
        vault_id = retry_entry!.id;
      } else {
        console.error('❌ Error saving to client_data_vault:', vault_error);
        throw new Error(`Error saving to client_data_vault: ${vault_error.message}`);
      }
    } else {
      vault_id = vault_entry!.id;
    }
    console.log(`✅ Data saved to client_data_vault: ${vault_id}`);

    // ========== STEP 4.5: SEED INITIAL PIPELINE STATUS ==========
    await supabase_admin.from('loan_status_history').insert({
      client_vault_id: vault_id,
      status: 'created',
      changed_by: advisor_id || null,
      changed_by_role: 'advisor',
      note: 'Client created via Speed Form',
    });

    // ========== STEP 5: RESET DOC STATE — NOTHING IS SEEDED YET ==========
    // The doc codes are parked in pending_document_requests; the SignWell
    // webhook releases them after the client signs the application. Clearing
    // any leftovers here covers the re-signup case.
    await supabase_admin.from('client_dynamic_documents').delete().eq('user_id', user_id);
    await supabase_admin.from('submissions').upsert({
      user_id: user_id,
      status: 'draft',
      updated_at: now_iso
    }, { onConflict: 'user_id' });
    console.log(`⏸️ ${pending_doc_codes.length} doc request(s) parked until the client signs the application`);

    // ========== STEP 6: APPLY GHL TAGS (no requested_* tags yet!) ==========
    const credit_tag_map: Record<string, string> = {
      '700+': 'credit-excellent',
      '600-700': 'credit-very-good',
      '500-600': 'credit-fair',
      '400-500': 'credit-poor',
    };
    const tags_to_apply = [...new Set([
      'vault-user',
      'portal_created',
      'vault_pre_approval',
      'speed-form',
      ...(credit_tag_map[body.credit_score] ? [credit_tag_map[body.credit_score]] : []),
    ])];

    await ghl_add_tags(ghl_contact_id, tags_to_apply);
    console.log(`✅ Tags applied to GHL contact: ${tags_to_apply.join(', ')}`);

    // ========== STEP 7: MAGIC LINK (the rep shares it during the call) ==========
    const magic_link = await generateOnboardingMagicLink(body.client_email.toLowerCase());
    if (magic_link) {
      await pushMagicLinkToGhl(ghl_contact_id, magic_link);
    } else {
      console.error('⚠️ Magic link generation failed — welcome email will fall back to the login URL');
    }

    // ========== STEP 8: WELCOME EMAIL (no doc list — docs come after signing) ==========
    try {
      await send_client_welcome_email({
        client_name: client_name,
        client_email: body.client_email.toLowerCase(),
        magic_link: magic_link || undefined,
        advisor_name: advisor_name,
        advisor_email: advisor_email || 'support@creditbanc.io',
        advisor_phone: advisor_phone || undefined,
        advisor_cc_email: advisor_email || undefined,
        requested_documents: [],
        login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`,
      });
      console.log(`✅ Welcome email sent to ${body.client_email}`);
    } catch (email_error: any) {
      console.error('⚠️ Error sending welcome email (non-fatal):', email_error);
    }

    // ========== STEP 9: SUCCESS ==========
    console.log('⚡ Speed form signup completed successfully');

    return NextResponse.json({
      success: true,
      data: {
        vault_id: vault_id,
        user_id: user_id,
        ghl_contact_id: ghl_contact_id,
        pending_documents: pending_doc_codes,
        tags_applied: tags_to_apply
      },
      credentials: {
        email: body.client_email.toLowerCase(),
        magic_link: magic_link || null,
        login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`
      },
      message: 'Client registered via speed form. Document requests will go out once the application is signed.'
    }, { status: 201 });

  } catch (error: any) {
    console.error('❌ Speed form signup error:', error);

    let status_code = 500;
    let error_message = error.message || 'Internal server error';

    if (error.message?.includes('GHL')) {
      status_code = 502;
      error_message = `GoHighLevel integration error: ${error.message}`;
    } else if (error.message?.includes('Auth')) {
      error_message = `Authentication error: ${error.message}`;
    } else if (error.message?.includes('client_data_vault')) {
      error_message = `Error saving data: ${error.message}`;
    }

    return NextResponse.json(
      {
        success: false,
        error: error_message,
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          full_error: error
        } : undefined
      },
      { status: status_code }
    );
  }
}
