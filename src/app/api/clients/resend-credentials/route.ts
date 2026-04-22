// src/app/api/clients/resend-credentials/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/clients/resend-credentials
 * ============================================================================
 *
 * Allows an advisor to resend login credentials to an existing client.
 *
 * FLOW:
 * 1. Authenticate the calling advisor
 * 2. Verify the advisor owns the requested client (security check)
 * 3. Generate a new secure temporary password via Supabase Auth admin
 * 4. Fetch the client's requested documents for the email
 * 5. Send welcome email with new credentials (CC advisor)
 * 6. Return success
 *
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateSecurePassword } from '@/lib/user-management';
import { send_client_welcome_email } from '@/lib/email';

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
            .select('id, user_id, client_name, client_email, advisor_id, advisor_name')
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

        console.log(`🔄 Resending credentials for client: ${client_data.client_email}`);

        // ========================================================================
        // STEP 4: GENERATE NEW TEMPORARY PASSWORD
        // ========================================================================
        const new_temp_password = generateSecurePassword();

        const { error: update_error } = await supabase_admin.auth.admin.updateUserById(
            client_data.user_id,
            {
                password: new_temp_password,
                user_metadata: { should_change_password: true }
            }
        );

        if (update_error) {
            console.error('❌ Error resetting password:', update_error);
            return NextResponse.json(
                { success: false, error: `Failed to reset password: ${update_error.message}` },
                { status: 500 }
            );
        }

        console.log(`✅ Password reset for user: ${client_data.user_id}`);

        // ========================================================================
        // STEP 5: FETCH CLIENT'S REQUESTED DOCUMENTS (FOR EMAIL)
        // ========================================================================
        const { data: dynamic_requirements } = await supabase_admin
            .from('client_dynamic_documents')
            .select('required_documents!inner(label)')
            .eq('user_id', client_data.user_id)
            .eq('is_active', true);

        const requested_documents = (dynamic_requirements || [])
            .map((item: any) => item.required_documents?.label)
            .filter(Boolean);

        // ========================================================================
        // STEP 6: RESEND WELCOME EMAIL (WITH ADVISOR CC)
        // ========================================================================
        const advisor_full_name = `${advisor_data.first_name} ${advisor_data.last_name}`.trim();

        await send_client_welcome_email({
            client_name: client_data.client_name,
            client_email: client_data.client_email,
            client_password: new_temp_password,
            advisor_name: advisor_full_name || client_data.advisor_name || 'Your Advisor',
            advisor_email: advisor_data.email || 'support@creditbanc.io',
            advisor_phone: advisor_data.phone || undefined,
            advisor_cc_email: advisor_data.email || undefined, // CC the advisor
            requested_documents,
            login_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`,
        });

        console.log(`✅ Credentials email resent to ${client_data.client_email}`);

        return NextResponse.json({
            success: true,
            message: `Login credentials sent to ${client_data.client_email}`,
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
