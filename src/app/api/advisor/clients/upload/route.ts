// src/app/api/advisor/clients/upload/route.ts
/**
 * ============================================================================
 * API ENDPOINT: POST /api/advisor/clients/upload
 * ============================================================================
 *
 * Allows an advisor to upload a document on behalf of one of their clients.
 * The file is stored under the CLIENT's user_id in Supabase storage and
 * synced to GHL exactly the same way as when the client uploads it themselves.
 *
 * FLOW:
 * 1. Authenticate the calling advisor
 * 2. Parse multipart/form-data: client_id, doc_code, file(s)
 * 3. Verify the advisor owns the client (advisor_id check)
 * 4. Upload each file to Supabase storage under {client_user_id}/...
 * 5. Insert row into user_documents with user_id = client.user_id
 * 6. POST to /api/uploads to trigger GHL sync
 * 7. If doc is not core, add submitted_{doc_code} tag to GHL
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
        // STEP 2: PARSE MULTIPART FORM DATA
        // ========================================================================
        const form_data = await request.formData();
        const client_id = form_data.get('client_id') as string | null;
        const doc_code = form_data.get('doc_code') as string | null;
        const files = form_data.getAll('file') as File[];

        if (!client_id || !doc_code || files.length === 0) {
            return NextResponse.json(
                { success: false, error: 'client_id, doc_code, and at least one file are required' },
                { status: 400 }
            );
        }

        // ========================================================================
        // STEP 3: VERIFY ADVISOR OWNERSHIP
        // ========================================================================

        // Get advisor record
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
            .select('id, user_id, client_name, ghl_contact_id, advisor_id')
            .eq('id', client_id)
            .maybeSingle();

        if (client_error || !client) {
            return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
        }

        if (client.advisor_id !== advisor_data.id) {
            return NextResponse.json(
                { success: false, error: 'You do not have permission to upload for this client' },
                { status: 403 }
            );
        }

        const advisor_full_name = `${advisor_data.first_name} ${advisor_data.last_name}`.trim();
        console.log(`📤 Advisor "${advisor_full_name}" uploading ${files.length} file(s) for client ${client.client_name}`);

        // ========================================================================
        // STEP 4 & 5: UPLOAD FILES + INSERT DB RECORDS
        // ========================================================================

        // Get doc type label for naming
        const { data: doc_def } = await supabase_admin
            .from('required_documents')
            .select('label, is_core')
            .eq('code', doc_code)
            .maybeSingle();

        const doc_label = doc_def?.label || doc_code;
        const is_core = doc_def?.is_core ?? true;

        const uploaded_doc_ids: string[] = [];

        for (const file of files) {
            const ext = file.name.split('.').pop() || 'bin';
            const timestamp = Date.now();
            const random = Math.random().toString(36).substr(2, 9);
            const normalized_filename = `${doc_code}-${timestamp}-${random}.${ext}`;

            // Store under the CLIENT'S user_id folder (same as self-upload)
            const file_path = `${client.user_id}/${normalized_filename}`;
            const standardized_name = `${doc_label} - ${client.client_name}`;

            // Upload to Supabase storage
            const file_buffer = await file.arrayBuffer();
            const { error: storage_error } = await supabase_admin.storage
                .from('user-documents')
                .upload(file_path, file_buffer, {
                    contentType: file.type,
                    upsert: true,
                });

            if (storage_error) {
                console.error(`❌ Storage upload failed for ${file.name}:`, storage_error);
                continue;
            }

            // Insert user_documents record
            const { data: doc_record, error: db_error } = await supabase_admin
                .from('user_documents')
                .insert({
                    user_id: client.user_id,
                    name: `${standardized_name}.${ext}`,
                    size: file.size,
                    type: file.type,
                    storage_path: file_path,
                    category: doc_code,
                    doc_code: doc_code,
                    custom_label: standardized_name,
                    metadata: { tags: [doc_code], uploaded_by: 'advisor', advisor_id: advisor_data.id },
                })
                .select('id')
                .single();

            if (db_error) {
                console.error(`❌ DB insert failed for ${file.name}:`, db_error);
                continue;
            }

            uploaded_doc_ids.push(doc_record.id);
            console.log(`✅ File uploaded: ${file_path}`);

            // ========================================================================
            // STEP 6: GHL SYNC (call ghlSyncDocument via the shared util)
            // ========================================================================
            try {
                const { ghlSyncDocument } = await import('@/lib/ghl-document-sync');
                await ghlSyncDocument(supabase_admin, doc_record.id, client.user_id, doc_code);
                console.log(`✅ GHL sync complete for ${doc_code}`);
            } catch (ghl_sync_error) {
                console.warn(`⚠️ GHL sync failed (non-fatal):`, ghl_sync_error);
            }
        }

        if (uploaded_doc_ids.length === 0) {
            return NextResponse.json(
                { success: false, error: 'All file uploads failed' },
                { status: 500 }
            );
        }

        // ========================================================================
        // STEP 7: ADD submitted_{doc_code} GHL TAG (for dynamic docs)
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
            uploaded: uploaded_doc_ids.length,
            message: `${uploaded_doc_ids.length} file(s) uploaded successfully`,
        });

    } catch (error: any) {
        console.error('💥 Advisor upload error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
