// src/app/api/advisor/clients/upload/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/advisor/clients/upload
 * ============================================================================
 *
 * Registers metadata for documents the advisor's browser has already uploaded
 * directly to Supabase storage via signed upload URLs (see ./sign/route.ts).
 *
 * The file bytes never pass through this Vercel function — only JSON metadata
 * — so Vercel's 4.5 MB request body cap on Hobby/Pro doesn't apply.
 *
 * INPUT (JSON):
 *   {
 *     client_id,
 *     doc_code,
 *     files: [{ storage_path, file_name, file_size, file_type }]
 *   }
 *
 * FLOW:
 * 1. Authenticate the calling advisor
 * 2. Verify advisor owns the client (or is admin / follower)
 * 3. For each file: validate the storage_path is under the client's user_id,
 *    insert user_documents row, run GHL sync
 * 4. If doc is not core, add submitted_{doc_code} tag to GHL
 *
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { ghlAddTags } from '@/lib/ghl-api';
import { isClientScopedDoc } from '@/lib/document-scope';

export const maxDuration = 60;

const supabase_admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

interface UploadedFileMeta {
    storage_path: string;
    file_name: string;
    file_size: number;
    file_type: string;
}

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
        // STEP 2: PARSE JSON BODY
        // ========================================================================
        const body = await request.json().catch(() => null);
        const client_id: string | undefined = body?.client_id;
        const doc_code: string | undefined = body?.doc_code;
        const business_profile_id: string | null = body?.business_profile_id ?? null;
        const files: UploadedFileMeta[] = Array.isArray(body?.files) ? body.files : [];

        if (!client_id || !doc_code || files.length === 0) {
            return NextResponse.json(
                { success: false, error: 'client_id, doc_code, and at least one file are required' },
                { status: 400 }
            );
        }

        // ========================================================================
        // STEP 3: VERIFY ADVISOR OWNERSHIP
        // ========================================================================

        const { data: caller_role } = await supabase_admin
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
        // Admin and underwriting are trusted staff: they can upload for any
        // client and don't need an advisor profile.
        const is_staff = caller_role?.role === 'admin' || caller_role?.role === 'underwriting';

        let { data: advisor_data } = await supabase_admin
            .from('advisors')
            .select('id, first_name, last_name')
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
                    .select('id, first_name, last_name')
                    .eq('email', user_record.email)
                    .maybeSingle();
                advisor_data = fallback;
            }
        }

        if (!advisor_data && !is_staff) {
            return NextResponse.json(
                { success: false, error: 'Advisor profile not found' },
                { status: 403 }
            );
        }

        const { data: client, error: client_error } = await supabase_admin
            .from('client_data_vault')
            .select('id, user_id, client_name, ghl_contact_id, advisor_id')
            .eq('id', client_id)
            .maybeSingle();

        if (client_error || !client) {
            return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
        }

        let has_access = is_staff || (!!advisor_data && client.advisor_id === advisor_data.id);
        if (!has_access && advisor_data) {
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

        const advisor_full_name = advisor_data
            ? `${advisor_data.first_name} ${advisor_data.last_name}`.trim()
            : (caller_role?.role === 'underwriting' ? 'Underwriting' : 'Staff');
        console.log(`📤 Advisor "${advisor_full_name}" registering ${files.length} file(s) for client ${client.client_name}`);

        // Client-scoped docs (DL/MyScoreIQ/PFS) describe the person, not a
        // business — they must land with business_profile_id = NULL so the
        // read-side matcher surfaces them on every business tab. Without
        // this override, uploading a driver's license while on Business B
        // pinned the personal doc to B and it disappeared when B was deleted.
        const resolved_business_profile_id = isClientScopedDoc(doc_code)
            ? null
            : business_profile_id;

        // ========================================================================
        // STEP 4: LOOK UP DOC METADATA (label + is_core)
        // ========================================================================
        const { data: doc_def } = await supabase_admin
            .from('required_documents')
            .select('label, is_core')
            .eq('code', doc_code)
            .maybeSingle();

        const doc_label = doc_def?.label || doc_code;
        const is_core = doc_def?.is_core ?? true;

        // ========================================================================
        // STEP 5: INSERT user_documents ROWS (sequential — fast)
        // ========================================================================
        const uploaded_documents: any[] = [];
        const expected_prefix = `${client.user_id}/`;
        const standardized_name = `${doc_label} - ${client.client_name}`;

        for (const f of files) {
            // Security: signed-URL paths are server-minted, but double-check the
            // browser didn't tamper before we record it as belonging to this client.
            if (!f.storage_path || !f.storage_path.startsWith(expected_prefix)) {
                console.error(`❌ Rejected storage_path outside client folder: ${f.storage_path}`);
                continue;
            }

            const ext = (f.file_name.split('.').pop() || 'bin').toLowerCase();

            const { data: doc_record, error: db_error } = await supabase_admin
                .from('user_documents')
                .insert({
                    user_id: client.user_id,
                    name: `${standardized_name}.${ext}`,
                    size: f.file_size,
                    type: f.file_type,
                    storage_path: f.storage_path,
                    category: doc_code,
                    doc_code: doc_code,
                    custom_label: standardized_name,
                    uploaded_by_role: 'advisor',
                    business_profile_id: resolved_business_profile_id,
                    metadata: { tags: [doc_code], uploaded_by: 'advisor', advisor_id: advisor_data?.id ?? null },
                })
                .select('*')
                .single();

            if (db_error) {
                console.error(`❌ DB insert failed for ${f.file_name}:`, db_error);
                continue;
            }

            uploaded_documents.push(doc_record);
            console.log(`✅ File registered: ${f.storage_path}`);
        }

        if (uploaded_documents.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No files could be registered' },
                { status: 500 }
            );
        }

        // ========================================================================
        // STEP 5b: RUN GHL SYNCS IN PARALLEL (slow — Supabase download + GHL upload)
        // Non-fatal: even if GHL fails, files are safely registered in Supabase.
        // ========================================================================
        const { ghlSyncDocument } = await import('@/lib/ghl-document-sync');
        await Promise.all(
            uploaded_documents.map(async (doc_record) => {
                try {
                    await ghlSyncDocument(supabase_admin, doc_record.id, client.user_id, doc_code);
                    console.log(`✅ GHL sync complete for ${doc_record.id}`);
                } catch (ghl_sync_error) {
                    console.warn(`⚠️ GHL sync failed for ${doc_record.id} (non-fatal):`, ghl_sync_error);
                }
            })
        );

        // ========================================================================
        // STEP 6: ADD submitted_{doc_code} GHL TAG (for dynamic docs)
        // ========================================================================
        if (!is_core && client.ghl_contact_id && process.env.GHL_TOKEN) {
            try {
                await ghlAddTags(client.ghl_contact_id, [`submitted_${doc_code}`]);
                console.log(`✅ GHL tag added: submitted_${doc_code}`);
            } catch (tag_error) {
                console.warn(`⚠️ GHL tagging failed (non-fatal):`, tag_error);
            }
        }

        return NextResponse.json({
            success: true,
            uploaded: uploaded_documents.length,
            documents: uploaded_documents,
            message: `${uploaded_documents.length} file(s) uploaded successfully`,
        });

    } catch (error: any) {
        console.error('💥 Advisor upload error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
