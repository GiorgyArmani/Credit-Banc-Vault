// src/app/api/client-signup/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';
import { send_client_welcome_email } from '@/lib/email';
import { syncOutstandingDocuments } from '@/lib/outstanding-documents';
import { syncUnifiedClientData, generateSecurePassword } from '@/lib/user-management';
import { ghlSearchContacts, ghlUpdateContact, ghlAddContactFollowers, ghlAddTags } from '@/lib/ghl-api';

/**
 * Supabase admin client with elevated privileges
 * Necessary for creating users and writing to protected tables
 */
const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);


/**
 * ============================================================================
 * GHL HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Creates or updates a contact in GoHighLevel using API v2
 * Uses the /upsert endpoint to handle create or update in a single call
 * @param contact_data - Contact data
 * @returns GHL contact ID
 */
async function ghl_upsert_contact(contact_data: any): Promise<string> {
  const ghl_api_key = process.env.GHL_API_KEY;
  const ghl_location_id = process.env.GHL_LOCATION_ID;

  // Validate GHL credentials configuration
  if (!ghl_api_key || !ghl_location_id) {
    throw new Error('GHL_API_KEY or GHL_LOCATION_ID not configured in environment variables');
  }

  // Use GoHighLevel API v2 /upsert endpoint
  // This endpoint creates or updates automatically based on email
  const upsert_response = await fetch(
    'https://services.leadconnectorhq.com/contacts/upsert',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Version': '2021-07-28',  // Header requerido por GHL API v2
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(contact_data)
    }
  );

  // Handle response errors
  if (!upsert_response.ok) {
    const error_text = await upsert_response.text();
    console.error('❌ GHL upsert error:', {
      status: upsert_response.status,
      statusText: upsert_response.statusText,
      error: error_text
    });
    throw new Error(`Error creating/updating GHL contact (${upsert_response.status}): ${error_text}`);
  }

  // Parse successful response
  const response_data = await upsert_response.json();

  // API might return the ID in different formats
  // {contact: {id: "xxx"}} o {id: "xxx"}
  const contact_id = response_data.contact?.id || response_data.id;

  if (!contact_id) {
    console.error('❌ GHL response missing contact ID:', response_data);
    throw new Error('GHL response does not include a valid contact ID');
  }

  return contact_id;
}

/**
 * Adds tags to a GHL contact using API v2
 * @param contact_id - GHL contact ID
 * @param tags - Array of tags to apply
 */
async function ghl_add_tags(contact_id: string, tags: string[]): Promise<void> {
  const ghl_api_key = process.env.GHL_API_KEY;

  if (!ghl_api_key) {
    throw new Error('GHL_API_KEY no está configurado');
  }

  if (!tags || tags.length === 0) {
    return; // No tags to add
  }

  const response = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contact_id}/tags`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghl_api_key}`,
        'Version': '2021-07-28',  // Header required for GHL API v2
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ tags })
    }
  );

  if (!response.ok) {
    const error_text = await response.text();
    console.error('❌ Error adding GHL tags:', {
      status: response.status,
      contact_id,
      tags,
      error: error_text
    });
    throw new Error(`Error adding GHL tags: ${error_text}`);
  }
}

/**
 * Creates a GHL custom field object if the value exists
 * @param field_id_env - Env variable name with field ID
 * @param value - Field value
 * @param fallback_id - Optional fallback ID
 * @returns Custom field object or null
 */
function create_custom_field(field_id_env: string, value: any, fallback_id?: string) {
  // If value is null, undefined, or empty string, do not create field
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const field_id = process.env[field_id_env] || fallback_id;

  if (!field_id) {
    console.warn(`⚠️ Custom field ID not found in .env and no fallback: ${field_id_env}`);
    return null;
  }

  return {
    id: field_id,
    value: String(value) // GHL expects strings in custom fields
  };
}

/**
 * Maps frontend values to the specific strings expected by GHL (dropdowns)
 */
function map_ghl_value(field_name: string, value: any): string {
  if (!value) return value;

  // Specific mapping for Funding ETA due to GHL typos/formatting
  if (field_name === 'funding_eta') {
    const map: Record<string, string> = {
      'Immediately': 'Inmediately', // GHL has a typo
      '1–3 Weeks': '1-3 Weeks',     // Frontend uses en-dash, GHL uses hyphen
      '3 Weeks +': '3 Weeks +'
    };
    return map[value] || value;
  }

  return value;
}

/**
 * ============================================================================
 * VALIDATION HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Validates email format
 */
function is_valid_email(email: string): boolean {
  const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return email_regex.test(email);
}

/**
 * Validates number is positive and greater than 0
 */
function is_valid_positive_number(value: any): boolean {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0;
}

/**
 * Validates ownership percentages sum to exactly 100
 */
function validate_ownership_percentages(body: any): { valid: boolean; message?: string } {
  let total = 0;

  if (body.owner_1_ownership_pct) {
    total += parseFloat(body.owner_1_ownership_pct);
  }
  if (body.owner_2_ownership_pct) {
    total += parseFloat(body.owner_2_ownership_pct);
  }
  if (body.owner_3_ownership_pct) {
    total += parseFloat(body.owner_3_ownership_pct);
  }
  if (body.owner_4_ownership_pct) {
    total += parseFloat(body.owner_4_ownership_pct);
  }
  if (body.owner_5_ownership_pct) {
    total += parseFloat(body.owner_5_ownership_pct);
  }

  // Allow small rounding difference (0.01%)
  if (Math.abs(total - 100) > 0.01) {
    return {
      valid: false,
      message: `Ownership percentages must sum to 100% (currently ${total}%)`
    };
  }

  return { valid: true };
}

/**
 * ============================================================================
 * MAIN HANDLER - POST /api/client-signup
 * ============================================================================
 */
export async function POST(request: Request) {
  try {
    console.log('🚀 Starting client signup process for Credit Banc...');

    // ========== STEP 1: PARSE AND VALIDATE REQUEST ==========
    const body = await request.json();

    // Validación de campos requeridos básicos
    if (!body.client_name || !body.company_name || !body.client_email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: client_name, company_name, client_email'
        },
        { status: 400 }
      );
    }

    // Validate email format
    if (!is_valid_email(body.client_email)) {
      return NextResponse.json(
        {
          success: false,
          error: 'The provided email is not valid'
        },
        { status: 400 }
      );
    }

    // Validate capital_requested is numeric
    if (!is_valid_positive_number(body.capital_requested)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Requested capital must be a number greater than 0'
        },
        { status: 400 }
      );
    }

    // Validar porcentajes de ownership
    const ownership_validation = validate_ownership_percentages(body);
    if (!ownership_validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: ownership_validation.message
        },
        { status: 400 }
      );
    }

    console.log('✅ Basic validations passed');

    // ========== STEP 1.5: RESOLVE ADVISOR FROM SESSION (authoritative) ==========
    // The client-signup form auto-assigns body.advisor_id from a client-side
    // lookup that can silently fail if the advisor's `advisors` row isn't
    // linked to their auth user_id. When it fails, body.advisor_id arrives as
    // "" and the client ends up orphaned (no advisor_id, no GHL assignment).
    //
    // Fix: trust the session, not the payload. If the caller is authenticated
    // as an advisor, derive their advisor_id/advisor_name from the DB. Also
    // self-heal the advisors row so the client-side lookup works next time.
    try {
      const session_supabase = await createServerSupabaseClient();
      const { data: { user: session_user } } = await session_supabase.auth.getUser();

      if (session_user) {
        // Prefer user_id match; fall back to email if the advisor row isn't linked yet.
        let { data: advisor_row } = await supabase_admin
          .from('advisors')
          .select('id, first_name, last_name, email, user_id')
          .eq('user_id', session_user.id)
          .maybeSingle();

        if (!advisor_row && session_user.email) {
          const { data: by_email } = await supabase_admin
            .from('advisors')
            .select('id, first_name, last_name, email, user_id')
            .ilike('email', session_user.email)
            .maybeSingle();
          advisor_row = by_email ?? null;

          // Self-heal: attach user_id to the advisor row so the client-side
          // lookup in client-sign-up-form.tsx works on future submissions.
          if (advisor_row && !advisor_row.user_id) {
            await supabase_admin
              .from('advisors')
              .update({ user_id: session_user.id })
              .eq('id', advisor_row.id);
            console.log(`🔧 Linked advisor ${advisor_row.id} to user_id ${session_user.id}`);
          }
        }

        if (advisor_row) {
          // Override whatever the form sent — session is source of truth.
          body.advisor_id = advisor_row.id;
          body.advisor_name =
            `${advisor_row.first_name ?? ''} ${advisor_row.last_name ?? ''}`.trim() ||
            body.advisor_name ||
            'Unknown';
          console.log(`✅ Advisor resolved from session: ${advisor_row.id} (${body.advisor_name})`);
        } else {
          console.warn(
            `⚠️ Session user ${session_user.id} (${session_user.email}) has no advisors row — leaving body.advisor_id as-is.`
          );
        }
      }
    } catch (session_err) {
      // Non-fatal — fall through to the legacy body-based flow so public
      // self-signup (no session) still works.
      console.error('advisor session resolution failed (non-fatal):', session_err);
    }

    // ========== STEP 2: CREATE/UPDATE USER IN AUTH ==========
    const { data: existing_user } = await supabase_admin.auth.admin
      .listUsers()
      .then(res => ({
        data: res.data.users.find(u => u.email === body.client_email.toLowerCase())
      }));

    let user_id = existing_user?.id;

    // Generar password temporal seguro para este cliente
    const temporary_password = generateSecurePassword();

    if (!user_id) {
      // CREATE new user
      const { data: created_user, error: create_error } = await supabase_admin.auth.admin.createUser({
        email: body.client_email.toLowerCase(),
        password: temporary_password,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: body.client_name,
          company: body.company_name,
          should_change_password: true, // Flag to force password change
          created_by: 'advisor',
          advisor_name: body.advisor_name || 'Unknown'
        },
      });

      if (create_error) {
        console.error('❌ Error creating user:', create_error);
        throw new Error(`Error creating user in Auth: ${create_error.message}`);
      }

      user_id = created_user.user!.id;
      console.log(`✅ New user created in Auth: ${user_id}`);

    } else {
      // UPDATE existing user
      await supabase_admin.auth.admin.updateUserById(user_id, {
        password: temporary_password,
        email_confirm: true,
        user_metadata: {
          should_change_password: true,
          full_name: body.client_name,
          company: body.company_name,
          updated_by: 'advisor',
          advisor_name: body.advisor_name || 'Unknown'
        }
      });

      console.log(`✅ Existing user updated in Auth: ${user_id}`);
    }

    // ========== STEP 2.5: SYNC TO UNIFIED TABLES ==========
    // Ensures record exists in public.users (RBAC) and business_profiles (AI Coach)
    await syncUnifiedClientData(supabase_admin, {
      userId: user_id,
      email: body.client_email,
      clientName: body.client_name,
      companyName: body.company_name,
      role: 'free',
      industry: body.industry,
      phone: body.client_phone,
      state: body.company_state,
      city: body.company_city,
      zipCode: body.company_zip_code,
    });
    console.log(`✅ User sync completed for ${user_id}`);

    // ========== STEP 3: PREPARE GHL CUSTOM FIELDS ==========
    const custom_fields = [
      // Basic Information
      create_custom_field('GHL_CF_CLIENTS_NAME', body.client_name, 'htTNeG6SjgBb816NXzrM'),
      create_custom_field('GHL_CF_BUSINESS_NAME', body.company_name, '4wCc6YtOB59baJTrMOsZ'),
      create_custom_field('GHL_CF_CLIENTS_PHONE', body.client_phone, 'BUdnGXCgH53LOYqZdEam'),
      create_custom_field('GHL_CF_CLIENT_EMAIL', body.client_email, 'QSNzz62RcqhaEgqyP8hg'),

      // Location
      create_custom_field('GHL_CF_COMPANY_STATE', body.company_state, 'qjSxhRyhQUzlGkyCHeV4'),
      create_custom_field('GHL_CF_COMPANY_CITY', body.company_city, 'sD6tg1NRCj9uHsc7xdZW'),
      create_custom_field('GHL_CF_COMPANY_ZIP', body.company_zip_code, 'el0Wrlnb8pH30cfMkEhw'),

      // Financial Information
      create_custom_field('GHL_CF_CAPITAL_REQUESTED', body.capital_requested, 'e3a1kLHpSXOtJcXvch9E'),
      create_custom_field('GHL_CF_LOAN_PURPOSE', body.loan_purpose, 'bI6KKdbP0spHXNOa463U'),
      create_custom_field('GHL_CF_PROPOSED_LOAN_TYPE', body.proposed_loan_type, 'geBSb3HaQsXl7mTjKkH6'),
      create_custom_field('GHL_CF_AVG_MONTHLY_DEPOSITS', body.avg_monthly_deposits, 'jO6EKKiJWP0WhJG5TnGS'),
      create_custom_field('GHL_CF_ANNUAL_REVENUE', body.avg_annual_revenue, '3rXoSHebmerVIqMA1l8X'),

      // Business Structure
      create_custom_field('GHL_CF_LEGAL_ENTITY_TYPE', body.legal_entity_type, 'FugwTFOGp9pKo5SwHesK'),
      create_custom_field('GHL_CF_BUSINESS_START_DATE', body.business_start_date, '4qvVNBqq2ZSz0MtaUwdy'),
      create_custom_field('GHL_CF_IS_HOME_BASED', body.is_home_based ? 'Yes' : 'No', '7Scr3pomfCvkEdcBlN6p'),
      create_custom_field('GHL_CF_EMPLOYEES_COUNT', body.employees_count, 'ZXrrNCDpyqNJsrUgNYwZ'),
      create_custom_field('GHL_CF_INDUSTRY', body.industry, 'lATbnmBRyYEqCEIsrlpK'),

      // Propietarios
      create_custom_field('GHL_CF_NUMBER_OF_OWNERS', body.number_of_owners, 'wfXQNMs2DhSqrYYqq5A7'),
      create_custom_field('GHL_CF_OWNER_1_NAME', body.owner_1_name, 'PaOPABkLZL3ZWxZxFrTV'),
      create_custom_field('GHL_CF_OWNER_1_PCT', body.owner_1_ownership_pct, 'DsjleQk3ABfV8AjtNTD1'),
      create_custom_field('GHL_CF_OWNER_2_NAME', body.owner_2_name, 'PWvgRVEVnoOXZqlwHGlk'),
      create_custom_field('GHL_CF_OWNER_2_PCT', body.owner_2_ownership_pct, 'kOhIqvXiFoApVe11JpgW'),
      create_custom_field('GHL_CF_OWNER_3_NAME', body.owner_3_name, 'n5f1L6TCW28CU176AnGC'),
      create_custom_field('GHL_CF_OWNER_3_PCT', body.owner_3_ownership_pct, 'hVVmYAp1ky4wnQaDnLgz'),
      create_custom_field('GHL_CF_OWNER_4_NAME', body.owner_4_name, 'djN3KXuxznGF4DwQnBC7'),
      create_custom_field('GHL_CF_OWNER_4_PCT', body.owner_4_ownership_pct, 'WsU2lLJXhZKEyGyPYuXt'),
      create_custom_field('GHL_CF_OWNER_5_NAME', body.owner_5_name, '6amEjPznOPWASM3LD2Cg'),
      create_custom_field('GHL_CF_OWNER_5_PCT', body.owner_5_ownership_pct, 'dwrTeoM9FCh19ut009kp'),

      // Credit and Special Situations
      create_custom_field('GHL_CF_CREDIT_SCORE', body.credit_score, 'G8suhHNaeaujGmC0fvk8'),
      create_custom_field('GHL_CF_HAS_EXISTING_LOANS', body.has_existing_loans ? 'Yes' : 'No', 'bhzqtlWJ5iNjaAGCRKX1'),
      create_custom_field('GHL_CF_HAS_DEFAULTED_MCA', body.has_defaulted_mca ? 'Yes' : 'No', '9rJtNSsOsuFm74HQAU7T'),
      create_custom_field('GHL_CF_MCA_WAS_SATISFIED', body.mca_was_satisfied ? 'Yes' : 'No', 'NpgVJVz3j3oNuRKHNV1l'),
      create_custom_field('GHL_CF_OWNS_REAL_ESTATE', body.owns_real_estate ? 'Yes' : 'No', 'C9Inq1rXMjuUWtZd1jxH'),
      create_custom_field('GHL_CF_HAS_REDUCED_MCA_PAYMENTS', body.has_reduced_mca_payments ? 'Yes' : 'No', 'Vg4frGmISs2DPCUOX2xj'),
      create_custom_field('GHL_CF_HAS_PERSONAL_DEBT_OVER_75K', body.has_personal_debt_over_75k ? 'Yes' : 'No', 'p4FwJHQTezeVSHBXJgk7'),
      create_custom_field('GHL_CF_HAS_BANKRUPTCY_FORECLOSURE_3Y', body.has_bankruptcy_foreclosure_3y ? 'Yes' : 'No', 'E89lUpkjbxAD0BX6C9w4'),
      create_custom_field('GHL_CF_HAS_TAX_LIENS', body.has_tax_liens ? 'Yes' : 'No', 'qL8ZFm5dCNHTn5he8lXm'),
      create_custom_field('GHL_CF_HAS_ACTIVE_JUDGEMENTS', body.has_active_judgements ? 'Yes' : 'No', 'uyP4EnoflSd4AcPEewq2'),
      create_custom_field('GHL_CF_HAS_ZBL', body.has_zbl ? 'Yes' : 'No', 'MhPWorNSUnzm6z5u29sk'),

      // Timeline and Notes
      create_custom_field('GHL_CF_FUNDING_ETA', map_ghl_value('funding_eta', body.funding_eta), '3NLSSMdhnCRbV8zggguo'),
      create_custom_field('GHL_CF_ADDITIONAL_NOTES', body.additional_notes, 'FML6V2dctE8ffwvqOTrp'),

    ].filter(Boolean); // Remove null fields

    console.log(`✅ ${custom_fields.length} custom fields prepared for GHL`);

    // ========== STEP 3.5: GET ADVISOR INFORMATION ==========
    // Get advisor information including GHL user ID for assignment
    let advisor_ghl_user_id: string | null = null;
    let advisor_email: string | null = null;
    let advisor_phone: string | null = null;

    if (body.advisor_id) {
      const { data: advisor_data } = await supabase_admin
        .from('advisors')
        .select('ghl_user_id, email, phone')
        .eq('id', body.advisor_id)
        .maybeSingle();

      advisor_ghl_user_id = advisor_data?.ghl_user_id || null;
      advisor_email = advisor_data?.email || null;
      advisor_phone = advisor_data?.phone || null;

      if (advisor_ghl_user_id) {
        console.log(`✅ Advisor GHL user ID found: ${advisor_ghl_user_id}`);
      } else {
        console.log(`⚠️ Advisor does not have a GHL user ID set`);
      }
    }

    // ========== STEP 4: SEARCH FOR EXISTING GHL CONTACT ==========
    // Check if contact already exists in GHL (from bulk import or previous interaction)
    console.log('🔍 Searching for existing GHL contact...');

    const existingContacts = await ghlSearchContacts({
      email: body.client_email.toLowerCase(),
      phone: body.client_phone,
      name: body.client_name,
      locationId: process.env.GHL_LOCATION_ID!
    });

    let ghl_contact_id: string;

    if (existingContacts.length > 0) {
      // Contact exists - UPDATE it with vault data
      ghl_contact_id = existingContacts[0].id;
      console.log(`✅ Found existing GHL contact: ${ghl_contact_id} (${existingContacts[0].email})`);
      console.log(`📝 Updating existing contact with vault data...`);

      // Prepare update payload (same as create, but using UPDATE endpoint)
      const ghl_update_data: any = {
        firstName: body.client_name.split(' ')[0],
        lastName: body.client_name.split(' ').slice(1).join(' ') || '',
        email: body.client_email.toLowerCase(),
        phone: body.client_phone || '',
        companyName: body.company_name,
        city: body.company_city || '',
        state: body.company_state,
        postalCode: body.company_zip_code,
        country: 'US',
        customFields: custom_fields
      };

      // Add assignedTo if advisor has GHL user ID
      if (advisor_ghl_user_id) {
        ghl_update_data.assignedTo = advisor_ghl_user_id;
        console.log(`✅ Contact will be assigned to advisor in GHL`);
      }

      // Update the existing contact
      await ghlUpdateContact(ghl_contact_id, ghl_update_data);
      console.log(`✅ GHL contact updated with vault data: ${ghl_contact_id}`);

    } else {
      // Contact doesn't exist - CREATE new one
      console.log(`📝 No existing contact found, creating new GHL contact...`);

      const ghl_contact_data: any = {
        locationId: process.env.GHL_LOCATION_ID,
        firstName: body.client_name.split(' ')[0],
        lastName: body.client_name.split(' ').slice(1).join(' ') || '',
        email: body.client_email.toLowerCase(),
        phone: body.client_phone || '',
        companyName: body.company_name,
        city: body.company_city || '',
        state: body.company_state,
        postalCode: body.company_zip_code,
        country: 'US',
        tags: ['vault-user'], // Initial tag
        customFields: custom_fields
      };

      // Add assignedTo field if advisor has a GHL user ID
      if (advisor_ghl_user_id) {
        ghl_contact_data.assignedTo = advisor_ghl_user_id;
        console.log(`✅ Contact will be assigned to advisor in GHL`);
      }

      try {
        ghl_contact_id = await ghl_upsert_contact(ghl_contact_data);
        console.log(`✅ GHL contact created: ${ghl_contact_id}`);
      } catch (ghl_error: any) {
        // Detect "duplicated contacts" error from GHL
        if (ghl_error.message.includes('duplicated contacts')) {
          console.log('⚠️ GHL duplicate contact detected (likely phone number match). Extracting ID...');

          try {
            // Extract metadata from the error message if possible
            // Error format: "Error creating/updating GHL contact (400): {..."
            const error_json_str = ghl_error.message.split('): ')[1];
            const error_json = JSON.parse(error_json_str);

            if (error_json.meta?.contactId) {
              ghl_contact_id = error_json.meta.contactId;
              console.log(`✅ Successfully linked to existing GHL contact via error metadata: ${ghl_contact_id}`);

              // Now perform an UPDATE to ensure data is synced correctly
              const ghl_update_data: any = {
                firstName: body.client_name.split(' ')[0],
                lastName: body.client_name.split(' ').slice(1).join(' ') || '',
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
                ghl_update_data.assignedTo = advisor_ghl_user_id;
              }

              await ghlUpdateContact(ghl_contact_id, ghl_update_data);
              console.log(`✅ GHL contact updated with vault data after collision: ${ghl_contact_id}`);
            } else {
              throw ghl_error; // Re-throw if we can't find the ID
            }
          } catch (parse_err) {
            console.error('❌ Failed to parse GHL error metadata:', parse_err);
            throw ghl_error; // Re-throw original error
          }
        } else {
          throw ghl_error; // Re-throw original error
        }
      }
    }

    // ========== STEP 5: SAVE TO CLIENT_DATA_VAULT ==========
    // We try to save the record even if GHL sync had issues, 
    // to ensure the client is visible in our system.
    console.log('💾 Saving data to client_data_vault...');

    const vault_data: any = {
      // IDs and references
      user_id: user_id,
      advisor_name: body.advisor_name || 'Unknown',
      advisor_id: body.advisor_id || null,
      ghl_contact_id: ghl_contact_id || null, // Might be null if GHL failed
      ghl_last_sync_at: ghl_contact_id ? new Date().toISOString() : null,
      ghl_sync_error: !ghl_contact_id ? 'GHL sync failed during signup' : null,

      // Basic client information
      client_name: body.client_name,
      company_name: body.company_name,
      client_phone: body.client_phone,
      client_email: body.client_email.toLowerCase(),

      // Location
      company_state: body.company_state,
      company_city: body.company_city || null,
      company_zip_code: body.company_zip_code,

      // Financial information (convert strings to numbers)
      capital_requested: parseFloat(body.capital_requested),
      loan_purpose: body.loan_purpose,
      proposed_loan_type: body.proposed_loan_type,
      avg_monthly_deposits: parseFloat(body.avg_monthly_deposits),
      avg_annual_revenue: parseFloat(body.avg_annual_revenue),

      // Business structure
      legal_entity_type: body.legal_entity_type,
      business_start_date: body.business_start_date,
      is_home_based: body.is_home_based || false,
      employees_count: parseInt(body.employees_count),

      // Owners
      number_of_owners: body.number_of_owners,
      owner_1_name: body.owner_1_name,
      owner_1_ownership_pct: parseFloat(body.owner_1_ownership_pct),
      owner_2_name: body.owner_2_name || null,
      owner_2_ownership_pct: body.owner_2_ownership_pct ? parseFloat(body.owner_2_ownership_pct) : null,
      owner_3_name: body.owner_3_name || null,
      owner_3_ownership_pct: body.owner_3_ownership_pct ? parseFloat(body.owner_3_ownership_pct) : null,
      owner_4_name: body.owner_4_name || null,
      owner_4_ownership_pct: body.owner_4_ownership_pct ? parseFloat(body.owner_4_ownership_pct) : null,
      owner_5_name: body.owner_5_name || null,
      owner_5_ownership_pct: body.owner_5_ownership_pct ? parseFloat(body.owner_5_ownership_pct) : null,

      // Credit and special situations
      credit_score: body.credit_score,
      has_existing_loans: body.has_existing_loans || false,
      has_defaulted_mca: body.has_defaulted_mca || false,
      mca_was_satisfied: body.mca_was_satisfied || null,
      owns_real_estate: body.owns_real_estate || false,
      has_reduced_mca_payments: body.has_reduced_mca_payments || false,
      has_personal_debt_over_75k: body.has_personal_debt_over_75k || null,
      has_bankruptcy_foreclosure_3y: body.has_bankruptcy_foreclosure_3y || false,
      has_tax_liens: body.has_tax_liens || false,
      has_active_judgements: body.has_active_judgements || false,
      has_zbl: body.has_zbl || null,

      // Timeline and notes
      funding_eta: body.funding_eta,
      additional_notes: body.additional_notes,

      // Metadata
      status: 'active',
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      contract_completed: body.contract_completed || false,
      contract_completed_at: body.contract_completed ? new Date().toISOString() : null,
    };

    // First try to upsert based on user_id
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
        console.log(`✅ Data saved to client_data_vault (conflict resolved): ${vault_id}`);
      } else {
        console.error('❌ Error saving to client_data_vault:', vault_error);
        throw new Error(`Error saving to client_data_vault: ${vault_error.message}`);
      }
    } else {
      vault_id = vault_entry!.id;
      console.log(`✅ Data saved to client_data_vault: ${vault_id}`);
    }

    // ========== STEP 5.2: SAVE OPEN POSITIONS ==========
    // If the client has existing loans, persist each position to client_open_positions
    const open_positions: any[] = body.open_positions || [];
    if (body.has_existing_loans && open_positions.length > 0) {
      // Delete any previously stored positions for this vault entry (handles re-signups)
      await supabase_admin
        .from('client_open_positions')
        .delete()
        .eq('client_vault_id', vault_id);

      // Build insert records, filtering out rows without a lender name
      const position_records = open_positions
        .filter((p: any) => p.lender_name?.trim())
        .map((p: any, index: number) => ({
          client_vault_id: vault_id,
          position_number: index + 1,
          lender_name: p.lender_name.trim(),
          loan_type: p.loan_type || '',
          current_balance: p.current_balance ? parseFloat(p.current_balance) : null,
          payment_amount: p.payment_amount ? parseFloat(p.payment_amount) : null,
          payment_term: p.payment_term?.trim() || null,
        }));

      if (position_records.length > 0) {
        const { error: positions_error } = await supabase_admin
          .from('client_open_positions')
          .insert(position_records);

        if (positions_error) {
          console.error('⚠️ Error saving open positions:', positions_error);
          // Non-fatal: do not throw, rest of signup continues
        } else {
          console.log(`✅ Saved ${position_records.length} open position(s) for vault ${vault_id}`);
        }
      }
    }


    // Transitioning to a FULLY DYNAMIC vault.

    // For re-signups/re-onboarding: Clear existing dynamic document requirements 
    // and reset submission status to ensure a clean slate.
    await supabase_admin.from('client_dynamic_documents').delete().eq('user_id', user_id);
    await supabase_admin.from('submissions').upsert({
      user_id: user_id,
      status: 'draft',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    // We insert "Standard" documents + any "Requested" documents via GHL tags.
    const LABEL_TO_CODE_MAP: Record<string, string> = {
      'Business Bank Statements': 'business_bank_statements',
      'Driver\'s License': 'drivers_license',
      'Voided Check': 'voided_check',
      'Business/Personal Tax Returns': 'tax_returns',
      'Profit & Loss Statement': 'profit_loss',
      'Balance Sheet': 'balance_sheets',
      'A/R Report': 'ar_report',
      'Debt Schedule': 'debt_schedule'
    };

    const requestedFromForm = (body.documents_requested || [])
      .map((label: string) => LABEL_TO_CODE_MAP[label])
      .filter(Boolean);

    const requestedDocTags = (body.ghl_tags || [])
      .filter((tag: string) => tag.startsWith('requested_'))
      .map((tag: string) => tag.replace('requested_', ''));

    // Combine requested from form and tags, ensuring uniqueness
    const allRequestedCodes = Array.from(new Set([...requestedFromForm, ...requestedDocTags]));

    console.log(`📋 Total documents to request: ${allRequestedCodes.length} (${requestedFromForm.length} from form, ${requestedDocTags.length} dynamic)`);

    // Get the document IDs from required_documents table
    const { data: docDefinitions, error: docLookupError } = await supabase_admin
      .from('required_documents')
      .select('id, code')
      .in('code', allRequestedCodes);

    if (docLookupError) {
      console.error('⚠️ Error looking up document definitions:', docLookupError);
    } else if (docDefinitions && docDefinitions.length > 0) {
      // Upsert records into client_dynamic_documents to avoid unique constraint errors
      const dynamicDocRecords = docDefinitions.map(doc => ({
        user_id: user_id,
        document_id: doc.id,
        is_active: true,
        requested_at: new Date().toISOString()
      }));

      const { error: insertError } = await supabase_admin
        .from('client_dynamic_documents')
        .upsert(dynamicDocRecords, { onConflict: 'user_id, document_id' });

      if (insertError) {
        console.error('⚠️ Error upserting dynamic documents:', insertError);
      } else {
        console.log(`✅ Upserted ${dynamicDocRecords.length} dynamic document requirements`);
      }
    }

    // ========== STEP 5.7: SYNC OUTSTANDING DOCUMENTS ==========
    // We do this immediately so GHL has the initial list of requirements
    if (process.env.GHL_TOKEN) {
      await syncOutstandingDocuments(user_id, ghl_contact_id, process.env.GHL_TOKEN);
      console.log(`✅ Outstanding documents synced with GHL`);
    }

    // ========== STEP 6: APPLY GHL TAGS ==========
    // Base tags that are always applied to every client
    const base_tags = [
      'vault-user',        // Identifies this contact as a Credit Banc Vault client (required for GHL automations)
      'portal_created',
      'vault_pre_approval',
    ];

    // Get tags generated by frontend (includes document requests, risk flags, etc.)
    // The frontend generate_ghl_tags() function creates comprehensive tags including:
    // - Risk assessment tags (defaulted-mca, owns-real-estate, etc.)
    // - Credit score category tags (credit-excellent, credit-good, etc.)
    // - Funding urgency tags (urgent-funding, flexible-timeline, etc.)
    // - Document request tags (requested_drivers_license, requested_bank_statements, etc.)
    const frontend_tags = body.ghl_tags || [];

    // Merge base tags with frontend-generated tags
    // Use Set to remove any duplicates that might exist
    const tags_to_apply = [...new Set([...base_tags, ...frontend_tags])];

    // Log tags for debugging
    console.log(`📋 Frontend tags received: ${frontend_tags.length > 0 ? frontend_tags.join(', ') : 'none'}`);
    console.log(`✅ Total tags to apply (${tags_to_apply.length}): ${tags_to_apply.join(', ')}`);

    // Apply all tags to GHL contact
    await ghl_add_tags(ghl_contact_id, tags_to_apply);
    console.log(`✅ Tags applied successfully to GHL contact: ${ghl_contact_id}`);

    // ========== STEP 6.4: SAVE FOLLOWERS (additional advisors that should get all client emails) ==========
    // Excludes the primary advisor and de-dupes the requested ids.
    const requested_follower_ids: string[] = Array.isArray(body.follower_advisor_ids)
      ? Array.from(new Set(
          body.follower_advisor_ids.filter(
            (id: any) => typeof id === 'string' && id && id !== body.advisor_id,
          ),
        ))
      : [];

    let follower_emails: string[] = [];
    if (requested_follower_ids.length > 0) {
      try {
        const { data: follower_rows, error: follower_lookup_err } = await supabase_admin
          .from('advisors')
          .select('id, email, ghl_user_id, first_name')
          .in('id', requested_follower_ids);

        if (follower_lookup_err) {
          console.error('⚠️ Error looking up follower advisors:', follower_lookup_err);
        }

        const valid_followers = (follower_rows || []).filter(f => !!f.id);
        follower_emails = valid_followers
          .map(f => f.email)
          .filter((e): e is string => typeof e === 'string' && e.includes('@'));

        if (valid_followers.length > 0) {
          const { error: insert_err } = await supabase_admin
            .from('client_followers')
            .insert(valid_followers.map(f => ({
              client_vault_id: vault_id,
              advisor_id: f.id,
              assigned_by: body.advisor_id || null,
            })));

          if (insert_err) {
            console.error('⚠️ Error inserting client_followers:', insert_err);
          } else {
            console.log(`✅ Saved ${valid_followers.length} follower(s) for vault ${vault_id}`);
          }
        }

        // Best-effort GHL sync: assign followers + tag the contact, mirroring follower-actions.ts
        if (ghl_contact_id && valid_followers.length > 0) {
          const ghl_user_ids = valid_followers
            .map(f => f.ghl_user_id)
            .filter((u): u is string => !!u);
          if (ghl_user_ids.length > 0) {
            try {
              await ghlAddContactFollowers(ghl_contact_id, ghl_user_ids);
            } catch (ghl_follower_err) {
              console.error('⚠️ GHL addContactFollowers failed (non-fatal):', ghl_follower_err);
            }
          }
          const assign_tags = valid_followers
            .map(f => (f.first_name || '').trim().toLowerCase())
            .filter(Boolean)
            .map(name => `assign to ${name}`);
          if (assign_tags.length > 0) {
            try {
              await ghlAddTags(ghl_contact_id, assign_tags);
            } catch (ghl_tag_err) {
              console.error('⚠️ GHL addTags for followers failed (non-fatal):', ghl_tag_err);
            }
          }
        }
      } catch (follower_err: any) {
        console.error('⚠️ Error processing followers (non-fatal):', follower_err);
      }
    }

    // ========== STEP 6.5: SEND WELCOME EMAIL ==========
    try {
      // Reuse advisor data already fetched above
      // CC the advisor + every follower so they all see the credentials
      await send_client_welcome_email({
        client_name: body.client_name,
        client_email: body.client_email.toLowerCase(),
        client_password: temporary_password,
        advisor_name: body.advisor_name || 'Your Advisor',
        advisor_email: advisor_email || 'support@creditbanc.io',
        advisor_phone: advisor_phone || undefined,
        advisor_cc_email: advisor_email || undefined,
        advisor_cc_emails: follower_emails,
        requested_documents: body.documents_requested || [],
        login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`,
      });

      console.log(`✅ Welcome email sent successfully to ${body.client_email}`);
    } catch (email_error: any) {
      // Log error but don't fail the whole signup
      // Client account is already created, email is just a nice-to-have
      console.error('⚠️ Error sending welcome email:', email_error);

      // Optional: Save to a failed_emails table to retry later
      // await supabase_admin.from('failed_emails').insert({
      //   email: body.client_email,
      //   type: 'welcome',
      //   error: email_error.message,
      //   data: body
      // });
    }

    // ========== STEP 7: SUCCESS RESPONSE ==========
    console.log('✅ Signup completed successfully');

    return NextResponse.json({
      success: true,
      data: {
        vault_id: vault_id,
        user_id: user_id,
        ghl_contact_id: ghl_contact_id,
        tags_applied: tags_to_apply
      },
      credentials: {
        email: body.client_email.toLowerCase(),
        password: temporary_password,
        login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`
      },
      message: 'Client registered successfully'
    }, { status: 201 });

  } catch (error: any) {
    console.error('❌ Client signup error:', error);

    // Determine error type and appropriate status code
    let status_code = 500;
    let error_message = error.message || 'Internal server error';

    if (error.message.includes('GHL')) {
      status_code = 502; // Bad Gateway - error with external service
      error_message = `GoHighLevel integration error: ${error.message}`;
    } else if (error.message.includes('Auth')) {
      status_code = 500;
      error_message = `Authentication error: ${error.message}`;
    } else if (error.message.includes('client_data_vault')) {
      status_code = 500;
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