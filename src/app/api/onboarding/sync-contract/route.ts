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

        // 1.5 Dedupe guard. This route gets called more than once for the same
        //      signed contract (the onboarding contract-check step polls + the
        //      Signwell webhook can also fire), which previously produced two
        //      identical funding_application rows. If we've already synced THIS
        //      Signwell document for THIS user, skip the re-download + re-insert
        //      and just confirm completion. Keyed on metadata.document_id so a
        //      different contract (e.g. a new business) is NOT deduped.
        const { data: alreadySynced } = await supabase
            .from('user_documents')
            .select('id')
            .eq('user_id', user.id)
            .eq('doc_code', 'funding_application')
            .contains('metadata', { document_id: documentId })
            .limit(1);
        if (alreadySynced && alreadySynced.length > 0) {
            console.log(`⏩ Funding application for document ${documentId} already synced — skipping duplicate.`);
            await supabase
                .from('client_data_vault')
                .update({ contract_completed: true, updated_at: new Date().toISOString() })
                .eq('user_id', user.id);
            return NextResponse.json({ success: true, message: 'Already synced', already_synced: true });
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

        // 3.5 Resolve the business this contract belongs to. funding_application
        //      is NOT a client-scoped code, so a NULL business_profile_id row
        //      matches no business tab (matchesActiveBusiness) and stays INVISIBLE
        //      on the advisor / admin / UW views AND the client's per-business
        //      vault — even though the PDF uploaded fine. Prefer the business off
        //      the matched funding_deal (multi-business contracts); fall back to
        //      the client's primary business. Mirrors the signwell webhook +
        //      addManualFundingApplication scoping. See [[user_documents_must_be_business_scoped]].
        let docBusinessProfileId: string | null = null;
        let docFundingDealId: string | null = null;
        const { data: matchedDeal } = await supabase
            .from('funding_deals')
            .select('id, business_profile_id')
            .eq('signwell_envelope_id', documentId)
            .maybeSingle();
        if (matchedDeal) {
            docFundingDealId = matchedDeal.id;
            docBusinessProfileId = matchedDeal.business_profile_id;
        }
        if (!docBusinessProfileId) {
            const { data: primaryBiz } = await supabase
                .from('business_profiles')
                .select('id')
                .eq('client_vault_id', client_data.id)
                .eq('is_primary', true)
                .maybeSingle();
            docBusinessProfileId = primaryBiz?.id ?? null;
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
                business_profile_id: docBusinessProfileId,
                funding_deal_id: docFundingDealId,
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
