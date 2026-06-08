// src/app/api/clients/resend-credentials/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/clients/resend-credentials
 * ============================================================================
 *
 * Allows an advisor to re-send a client their passwordless magic link — the
 * same one the welcome email uses. Mirrors the resend-magic-link cron.
 *
 * IMPORTANT: this must NOT reset the client's password. Under the magic-link
 * flow the client creates their own password during onboarding Step 3; resetting
 * it here would lock out anyone who has already onboarded. The magic link logs
 * them straight in regardless of whether they've set a password yet.
 *
 * FLOW:
 * 1. Authenticate the calling advisor
 * 2. Verify the advisor owns the requested client (security check)
 * 3. Generate a fresh onboarding magic link
 * 4. Push it to GHL (custom field + send-magic-link tag → SMS)
 * 5. Send the welcome email with the magic link (CC advisor + followers)
 *
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { send_client_welcome_email } from '@/lib/email';
import { normalizeSupabaseJoin } from '@/lib/document-scope';
import { generateOnboardingMagicLink, pushMagicLinkToGhl } from '@/lib/magic-link';
import { ghlSearchContacts } from '@/lib/ghl-api';

/**
 * Supabase admin client — needed to reset user passwords
 */
const supabase_admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { client_id } = body;

        if (!client_id) {
            return NextResponse.json(
                { success: false, error: 'client_id is required' },
                { status: 400 }
            );
        }

        // ========================================================================
        // STEP 1: AUTHENTICATE THE CALLING ADVISOR
        // ========================================================================
        const supabase = await createServerClient();
        const { data: { user }, error: auth_error } = await supabase.auth.getUser();

        if (auth_error || !user) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // ========================================================================
        // STEP 2: GET ADVISOR PROFILE & VERIFY OWNERSHIP
        // ========================================================================

        // Get advisor record linked to this user (by user_id or email)
        let { data: advisor_data } = await supabase_admin
            .from('advisors')
            .select('id, first_name, last_name, email, phone')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!advisor_data) {
            // Fallback: try matching by email
            const { data: user_record } = await supabase_admin
                .from('users')
                .select('email')
                .eq('id', user.id)
                .maybeSingle();

            if (user_record?.email) {
                const { data: advisor_by_email } = await supabase_admin
                    .from('advisors')
                    .select('id, first_name, last_name, email, phone')
                    .eq('email', user_record.email)
                    .maybeSingle();

                advisor_data = advisor_by_email;
            }
        }

        if (!advisor_data) {
            return NextResponse.json(
                { success: false, error: 'Advisor profile not found' },
                { status: 403 }
            );
        }

        // ========================================================================
        // STEP 3: FETCH CLIENT & VERIFY ADVISOR OWNS THEM
        // ========================================================================
        const { data: client_data, error: client_error } = await supabase_admin
            .from('client_data_vault')
            .select('id, user_id, client_name, client_email, advisor_id, advisor_name, ghl_contact_id')
            .eq('id', client_id)
            .maybeSingle();

        if (client_error || !client_data) {
            return NextResponse.json(
                { success: false, error: 'Client not found' },
                { status: 404 }
            );
        }

        // Security: owner OR follower can resend credentials
        let has_access = client_data.advisor_id === advisor_data.id;
        if (!has_access) {
            const { data: follower_row } = await supabase_admin
                .from('client_followers')
                .select('id')
                .eq('client_vault_id', client_data.id)
                .eq('advisor_id', advisor_data.id)
                .maybeSingle();
            has_access = !!follower_row;
        }
        if (!has_access) {
            return NextResponse.json(
                { success: false, error: 'You do not have permission to manage this client' },
                { status: 403 }
            );
        }

        console.log(`🔄 Resending magic link for client: ${client_data.client_email}`);

        // ========================================================================
        // STEP 4: GENERATE A FRESH MAGIC LINK (no password reset — see header)
        // ========================================================================
        const magic_link = await generateOnboardingMagicLink(client_data.client_email);

        if (!magic_link) {
            console.error('❌ Magic link generation failed for', client_data.client_email);
            return NextResponse.json(
                { success: false, error: 'Failed to generate a login link. Please try again.' },
                { status: 500 }
            );
        }

        // Push to GHL (custom field + send-magic-link tag → SMS). Prefer the
        // stored contact id; fall back to an email search. Non-fatal.
        let ghl_contact_id = client_data.ghl_contact_id as string | null;
        if (!ghl_contact_id && process.env.GHL_LOCATION_ID) {
            try {
                const found = await ghlSearchContacts({
                    email: client_data.client_email.toLowerCase(),
                    locationId: process.env.GHL_LOCATION_ID,
                });
                ghl_contact_id = found[0]?.id ?? null;
            } catch (search_err) {
                console.error('⚠️ GHL contact search failed (non-fatal):', search_err);
            }
        }
        if (ghl_contact_id) {
            try {
                await pushMagicLinkToGhl(ghl_contact_id, magic_link);
            } catch (push_err) {
                console.error('⚠️ pushMagicLinkToGhl failed (non-fatal):', push_err);
            }
        }

        // ========================================================================
        // STEP 5: FETCH CLIENT'S REQUESTED DOCUMENTS (FOR EMAIL)
        // ========================================================================
        const { data: dynamic_requirements } = await supabase_admin
            .from('client_dynamic_documents')
            .select('required_documents!inner(label)')
            .eq('user_id', client_data.user_id)
            .eq('is_active', true);

        const requested_documents = (dynamic_requirements || [])
            .map((item: any) => normalizeSupabaseJoin<{ label?: string }>(item.required_documents)?.label)
            .filter((l: string | undefined): l is string => !!l);

        // ========================================================================
        // STEP 6: RESEND WELCOME EMAIL (WITH ADVISOR + FOLLOWERS CC)
        // ========================================================================
        const advisor_full_name = `${advisor_data.first_name} ${advisor_data.last_name}`.trim();

        const { getFollowerEmailsForClient } = await import('@/lib/followers');
        const follower_emails = await getFollowerEmailsForClient(supabase_admin, client_data.id);

        await send_client_welcome_email({
            client_name: client_data.client_name,
            client_email: client_data.client_email,
            magic_link,
            advisor_name: advisor_full_name || client_data.advisor_name || 'Your Advisor',
            advisor_email: advisor_data.email || 'support@creditbanc.io',
            advisor_phone: advisor_data.phone || undefined,
            advisor_cc_email: advisor_data.email || undefined, // CC the advisor
            advisor_cc_emails: follower_emails,
            requested_documents,
            login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`,
        });

        console.log(`✅ Magic link email resent to ${client_data.client_email}`);

        return NextResponse.json({
            success: true,
            message: `Login link sent to ${client_data.client_email}`,
        });

    } catch (error: any) {
        console.error('💥 Error resending credentials:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Internal server error',
            },
            { status: 500 }
        );
    }
}
