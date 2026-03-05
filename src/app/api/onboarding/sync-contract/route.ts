import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signWell } from '@/lib/signwell';
import { ghlSyncDocument } from '@/lib/ghl-document-sync';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/sync-contract
 * 
 * Manually triggers the sync of a completed SignWell contract.
 * Used as a fallback when the webhook is delayed or fails.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { documentId } = body;

        if (!documentId) {
            return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
        }

        console.log(`🔄 Manual sync triggered for user ${user.id}, document ${documentId}`);

        // 1. Get client data
        const { data: client_data, error: clientError } = await supabase
            .from('client_data_vault')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (clientError || !client_data) {
            console.error('❌ Client data not found:', clientError);
            return NextResponse.json({ error: 'Client data not found' }, { status: 404 });
        }

        // Security Check: Verify documentId matches what's in the DB for this user
        if (!client_data.contract_url?.includes(documentId)) {
            console.error(`❌ Security breach attempt: User ${user.id} tried to sync document ${documentId} which is not linked to their account.`);
            return NextResponse.json({ error: 'Forbidden: Document ID mismatch' }, { status: 403 });
        }

        // 2. Download the completed PDF from SignWell
        // We use urlOnly: false to get the binary data
        // We implement a retry loop because SignWell might take a few seconds to generate the PDF
        let blob: Blob | undefined;
        let lastError: any;
        const maxRetries = 5;
        const delayMs = 2000;

        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`⏳ Attempt ${i + 1}/${maxRetries} to fetch PDF for ${documentId}...`);
                const result = await signWell.getCompletedPDF({
                    documentId,
                    urlOnly: false,
                    auditPage: true
                });
                blob = result.blob;
                if (blob) break;
            } catch (error: any) {
                lastError = error;
                console.warn(`⚠️ Attempt ${i + 1} failed:`, error.message);
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        if (!blob) {
            throw new Error(lastError?.message || 'Failed to download PDF from SignWell after retries');
        }

        const pdfBuffer = await blob.arrayBuffer();
        const filePath = `${user.id}/funding_application_${Date.now()}.pdf`;

        // 3. Upload to Supabase Storage
        const { error: storageError } = await supabase.storage
            .from('user-documents')
            .upload(filePath, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true
            });

        if (storageError) {
            console.error('❌ Storage upload error:', storageError);
            throw storageError;
        }

        // 4. Create record in user_documents
        const { data: docRecord, error: dbError } = await supabase
            .from('user_documents')
            .insert({
                user_id: user.id,
                name: `Funding Application - ${client_data.client_name}.pdf`,
                size: pdfBuffer.byteLength,
                type: 'application/pdf',
                storage_path: filePath,
                category: 'funding_application',
                doc_code: 'funding_application',
                custom_label: `Funding Application - ${client_data.client_name}`,
                metadata: {
                    tags: ['funding_application', 'signwell', 'manual-sync'],
                    source: 'onboarding_sync_api',
                    document_id: documentId
                }
            })
            .select('*')
            .single();

        if (dbError) {
            console.error('❌ Database error:', dbError);
            throw dbError;
        }

        // 5. Update client_data_vault status
        await supabase
            .from('client_data_vault')
            .update({
                contract_completed: true,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', user.id);

        // 6. Sync to GoHighLevel
        console.log(`📤 Pushing ${docRecord.id} to GHL...`);
        const syncResult = await ghlSyncDocument(
            supabase,
            docRecord.id,
            user.id,
            'funding_application'
        );

        if (!syncResult.success) {
            console.warn('⚠️ GHL Sync failed in fallback:', syncResult.error);
            // We return success anyway because the document is in Supabase and marked completed
            return NextResponse.json({
                success: true,
                message: 'Document saved to vault, GHL sync pending',
                ghlError: syncResult.error
            });
        }

        console.log('✅ Manual sync completed successfully');
        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('❌ Sync contract error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
