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
import { send_underwriting_vault_ready_notification, send_client_vault_submitted_notification } from '@/lib/email';

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

        // STEP 2: PARSE REQUEST BODY
        // ========================================================================
        const { client_id, credit_score } = await request.json();

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
            .select('id, user_id, client_name, client_email, company_name, ghl_contact_id, advisor_id, data_vault_submitted_at, capital_requested')
            .eq('id', client_id)
            .maybeSingle();

        if (client_error || !client) {
            return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
        }

        let has_access = client.advisor_id === advisor_data.id;
        if (!has_access) {
            const { data: follower_row } = await supabase_admin
                .from('client_followers')
                .select('id')
                .eq('client_vault_id', client.id)
                .eq('advisor_id', advisor_data.id)
                .maybeSingle();
            has_access = !!follower_row;
        }
        if (!has_access) {
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
        const updateData: any = { data_vault_submitted_at: submitted_at };
        if (credit_score) {
            updateData.credit_score = String(credit_score);
        }

        const { error: update_error } = await supabase_admin
            .from('client_data_vault')
            .update(updateData)
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
                status: 'locked',
                submitted_at,
            }, { onConflict: 'user_id' });

        if (submission_error) {
            // Non-fatal — vault is already marked as submitted above
            console.error('⚠️ Error upserting submissions record (non-fatal):', submission_error);
        } else {
            console.log(`✅ Submissions record upserted for user: ${client.user_id}`);

            // ========================================================================
            // STEP 7: NOTIFY UNDERWRITING
            // ========================================================================
            try {
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';
                
                // 7a. Get all underwriting users for notifications
                const { data: underwriting_users } = await supabase_admin
                    .from('users')
                    .select('id, email, first_name, last_name')
                    .eq('role', 'underwriting');

                if (underwriting_users && underwriting_users.length > 0) {
                    // 7b. In-app notifications
                    const notifications = underwriting_users.map(u => ({
                        user_id: u.id,
                        client_id: client.id,
                        title: "New Vault Ready for Review",
                        message: `${client.client_name} (${client.company_name}) has been approved by ${advisor_data.first_name} and is ready for review.`
                    }));

                    await supabase_admin.from('in_app_notifications').insert(notifications);
                    console.log(`✅ In-app notifications sent to ${underwriting_users.length} underwriters`);

                    // 7c. Email notifications
                    for (const u of underwriting_users) {
                        if (u.email) {
                            try {
                                await send_underwriting_vault_ready_notification({
                                    underwriter_email: u.email,
                                    client_name: client.client_name,
                                    company_name: client.company_name,
                                    advisor_name: `${advisor_data.first_name} ${advisor_data.last_name}`,
                                    capital_requested: client.capital_requested || 0,
                                    client_profile_url: `${appUrl}/underwriting/dashboard/clients/${client.id}`
                                });
                            } catch (email_err) {
                                console.error(`⚠️ Error sending email to underwriter ${u.email}:`, email_err);
                            }
                        }
                    }
                    console.log(`✅ Email notifications dispatched to the underwriting team`);
                } else {
                    console.warn('⚠️ No underwriting users found to notify');
                }
            } catch (notify_error) {
                console.error('⚠️ Error notifying underwriting (non-fatal):', notify_error);
            }

            // ========================================================================
            // STEP 7.5: NOTIFY CLIENT
            // ========================================================================
            try {
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';

                // 7.5a In-app notification for client
                if (client.user_id) {
                    await supabase_admin.from('in_app_notifications').insert({
                        user_id: client.user_id,
                        client_id: client.id,
                        title: "Application Submitted to Underwriting",
                        message: `Great news! Your application for ${client.company_name} has been vetted and submitted for underwriting review.`
                    });
                    console.log(`✅ In-app notification sent to client: ${client.user_id}`);
                }

                // 7.5b Email notification for client
                if (client.client_email) {
                    await send_client_vault_submitted_notification({
                        client_name: client.client_name,
                        client_email: client.client_email,
                        advisor_name: `${advisor_data.first_name} ${advisor_data.last_name}`,
                        company_name: client.company_name,
                        login_url: `${appUrl}/auth/login`
                    });
                    console.log(`✅ Email notification dispatched to client: ${client.client_email}`);
                }
            } catch (client_notify_error) {
                console.error('⚠️ Error notifying client (non-fatal):', client_notify_error);
            }
            // ========================================
            // STEP 8: UPDATE PIPELINE STATUS
            // ========================================
            try {
                const { updateLoanStatus } = await import('@/app/actions/pipeline');
                await updateLoanStatus(client.id, 'under_review', `Vault submitted by advisor ${advisor_data.first_name}`);
                console.log(`✅ Pipeline status updated to "under_review" for client: ${client.id}`);
            } catch (pipeline_error) {
                console.error('⚠️ Error updating pipeline status (non-fatal):', pipeline_error);
            }
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
