// src/app/api/advisor/clients/upload/sign/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/advisor/clients/upload/sign
 * ============================================================================
 *
 * Returns a Supabase signed upload URL so the advisor's browser can upload
 * the file directly to Supabase storage, bypassing Vercel's 4.5 MB request
 * body cap on serverless functions.
 *
 * The browser then calls POST /api/advisor/clients/upload with the resulting
 * storage_path(s) to register the metadata, sync to GHL, and tag in GHL.
 *
 * INPUT (JSON):
 *   { client_id, doc_code, file_name, file_type }
 *
 * OUTPUT (JSON):
 *   { success: true, signed_url, token, file_path }
 *
 * AUTH: Mirrors POST /api/advisor/clients/upload — owner, follower, or admin.
 *
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

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
        // STEP 2: PARSE INPUT
        // ========================================================================
        const body = await request.json().catch(() => null);
        const client_id: string | undefined = body?.client_id;
        const doc_code: string | undefined = body?.doc_code;
        const file_name: string | undefined = body?.file_name;

        if (!client_id || !doc_code || !file_name) {
            return NextResponse.json(
                { success: false, error: 'client_id, doc_code, and file_name are required' },
                { status: 400 }
            );
        }

        // ========================================================================
        // STEP 3: VERIFY ADVISOR OWNERSHIP (owner, follower, or admin)
        // ========================================================================

        let { data: advisor_data } = await supabase_admin
            .from('advisors')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!advisor_data) {
            const { data: user_record } = await supabase_admin
                .from('users')
                .select('email')
                .eq('id', user.id)
                .maybeSingle();

            if (user_record?.email) {
                const { data: fallback } = await supabase_admin
                    .from('advisors')
                    .select('id')
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

        const { data: client, error: client_error } = await supabase_admin
            .from('client_data_vault')
            .select('id, user_id, advisor_id')
            .eq('id', client_id)
            .maybeSingle();

        if (client_error || !client) {
            return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
        }

        const { data: caller_role } = await supabase_admin
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
        const is_admin_caller = caller_role?.role === 'admin';

        let has_access = is_admin_caller || client.advisor_id === advisor_data.id;
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
                { success: false, error: 'You do not have permission to upload for this client' },
                { status: 403 }
            );
        }

        // ========================================================================
        // STEP 4: BUILD STORAGE PATH + MINT SIGNED UPLOAD URL
        // ========================================================================
        const ext = file_name.split('.').pop() || 'bin';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        const normalized_filename = `${doc_code}-${timestamp}-${random}.${ext}`;
        const file_path = `${client.user_id}/${normalized_filename}`;

        const { data: signed, error: sign_error } = await supabase_admin.storage
            .from('user-documents')
            .createSignedUploadUrl(file_path, { upsert: true });

        if (sign_error || !signed) {
            console.error('❌ Failed to create signed upload URL:', sign_error);
            return NextResponse.json(
                { success: false, error: sign_error?.message || 'Failed to create signed upload URL' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            signed_url: signed.signedUrl,
            token: signed.token,
            file_path,
        });

    } catch (error: any) {
        console.error('💥 Advisor upload-sign error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
