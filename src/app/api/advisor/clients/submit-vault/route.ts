// src/app/api/advisor/clients/submit-vault/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/advisor/clients/submit-vault
 * ============================================================================
 *
 * Allows an advisor to submit a client's vault to the underwriting team.
 * Mirrors the logic in /api/vault/submit but accepts a client_id param
 * and verifies that the calling advisor owns that client.
 *
 * FLOW:
 * 1. Authenticate the calling advisor
 * 2. Parse body: { client_id }
 * 3. Verify the advisor owns the client (advisor_id check)
 * 4. Apply vault_submitted GHL tag
 * 5. Set data_vault_submitted_at on client_data_vault
 * 6. Upsert row into submissions table
 * 7. Return { success: true }
 *
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { ghlAddTags } from '@/lib/ghl-api';

const supabase_admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export async function POST(request: Request) {
    try {
        // ========================================================================
        // STEP 1: AUTHENTICATE THE CALLING ADVISOR
        // ========================================================================
        const supabase = await createClient();
        const { data: { user }, error: auth_error } = await supabase.auth.getUser();

        if (auth_error || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        // ========================================================================
        // STEP 2: PARSE REQUEST BODY
        // ========================================================================
        const { client_id } = await request.json();

        if (!client_id) {
            return NextResponse.json(
                { success: false, error: 'client_id is required' },
                { status: 400 }
            );
        }

        // ========================================================================
        // STEP 3: GET ADVISOR PROFILE & VERIFY OWNERSHIP
        // ========================================================================
        let { data: advisor_data } = await supabase_admin
            .from('advisors')
            .select('id, first_name, last_name')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!advisor_data) {
            // Fallback: match by email
            const { data: user_record } = await supabase_admin
                .from('users')
                .select('email')
                .eq('id', user.id)
                .maybeSingle();

            if (user_record?.email) {
                const { data: fallback } = await supabase_admin
                    .from('advisors')
                    .select('id, first_name, last_name')
                    .eq('email', user_record.email)
                    .maybeSingle();
                advisor_data = fallback;
            }
        }

        if (!advisor_data) {
            return NextResponse.json(
                { success: false, error: 'Advisor profile not found' },
                { status: 403 }
            );
        }

        // Fetch client and verify ownership
        const { data: client, error: client_error } = await supabase_admin
            .from('client_data_vault')
            .select('id, user_id, client_name, ghl_contact_id, advisor_id, data_vault_submitted_at')
            .eq('id', client_id)
            .maybeSingle();

        if (client_error || !client) {
            return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
        }

        if (client.advisor_id !== advisor_data.id) {
            return NextResponse.json(
                { success: false, error: 'You do not have permission to submit this client\'s vault' },
                { status: 403 }
            );
        }

        console.log(`🚀 Advisor "${advisor_data.first_name}" submitting vault for client: ${client.client_name}`);

        // ========================================================================
        // STEP 4: APPLY vault_submitted GHL TAG
        // ========================================================================
        if (client.ghl_contact_id) {
            try {
                await ghlAddTags(client.ghl_contact_id, ['vault_submitted']);
                console.log(`✅ vault_submitted tag applied to GHL contact: ${client.ghl_contact_id}`);
            } catch (ghl_error) {
                // Non-fatal — we still want to mark the record in our DB
                console.warn('⚠️ GHL tagging failed (non-fatal):', ghl_error);
            }
        } else {
            console.warn('⚠️ Client has no GHL contact ID — skipping GHL tag');
        }

        // ========================================================================
        // STEP 5: SET data_vault_submitted_at
        // ========================================================================
        const submitted_at = new Date().toISOString();

        const { error: update_error } = await supabase_admin
            .from('client_data_vault')
            .update({ data_vault_submitted_at: submitted_at })
            .eq('id', client.id);

        if (update_error) {
            console.error('❌ Error updating data_vault_submitted_at:', update_error);
            throw new Error(`Failed to update vault record: ${update_error.message}`);
        }

        console.log(`✅ data_vault_submitted_at set for client: ${client.id}`);

        // ========================================================================
        // STEP 6: UPSERT INTO submissions TABLE
        // ========================================================================
        const { error: submission_error } = await supabase_admin
            .from('submissions')
            .upsert({
                user_id: client.user_id,
                advisor_id: advisor_data.id,
                status: 'submitted',
                submitted_at,
            }, { onConflict: 'user_id' });

        if (submission_error) {
            // Non-fatal — vault is already marked as submitted above
            console.error('⚠️ Error upserting submissions record (non-fatal):', submission_error);
        } else {
            console.log(`✅ Submissions record upserted for user: ${client.user_id}`);
        }

        return NextResponse.json({
            success: true,
            message: `Vault submitted successfully for ${client.client_name}`,
            submitted_at,
        });

    } catch (error: any) {
        console.error('💥 Advisor submit-vault error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
