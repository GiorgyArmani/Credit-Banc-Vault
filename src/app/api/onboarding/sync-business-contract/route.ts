import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { signWell } from '@/lib/signwell';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/sync-business-contract
 *
 * In-app completion for an ADDITIONAL business's Signwell contract (the
 * advisor-added-a-business flow). The onboarding `sync-contract` route is
 * primary/client_data_vault-scoped, so this is its per-business counterpart:
 * it resolves the funding_deal by Signwell document id, verifies the caller
 * owns it, downloads the signed PDF, stores a business-scoped
 * funding_application document, and flips funding_deals.contract_completed.
 *
 * Mirrors what the signwell-contract webhook does for funding_deals, but is
 * callable from the embed's `completed` event so signing completes immediately
 * (and works locally where the webhook isn't firing). Idempotent: keyed on the
 * Signwell document id in metadata, so a re-call won't create a duplicate.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { documentId } = await request.json();
        if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });

        const admin = createAdminClient();

        // 1. Resolve the funding_deal for this Signwell document + verify ownership.
        const { data: deal } = await admin
            .from('funding_deals')
            .select('id, contract_completed, business_profiles!inner ( id, user_id, client_vault_id, company_name )')
            .eq('signwell_envelope_id', documentId)
            .maybeSingle();

        const biz = deal
            ? (Array.isArray((deal as any).business_profiles)
                ? (deal as any).business_profiles[0]
                : (deal as any).business_profiles)
            : null;

        if (!deal || !biz || biz.user_id !== user.id) {
            return NextResponse.json({ error: 'Contract not found for this user' }, { status: 404 });
        }

        // 2. Dedupe — already synced this document?
        const { data: existing } = await admin
            .from('user_documents')
            .select('id')
            .eq('user_id', user.id)
            .eq('doc_code', 'funding_application')
            .contains('metadata', { document_id: documentId })
            .limit(1);
        if (existing && existing.length > 0) {
            if (!deal.contract_completed) {
                await admin
                    .from('funding_deals')
                    .update({ contract_completed: true, contract_completed_at: new Date().toISOString() })
                    .eq('id', deal.id);
            }
            return NextResponse.json({ success: true, already_synced: true });
        }

        // 3. Download the completed PDF (Signwell can lag a few seconds).
        let blob: Blob | undefined;
        let lastError: any;
        for (let i = 0; i < 5; i++) {
            try {
                const result = await signWell.getCompletedPDF({ documentId, urlOnly: false, auditPage: true });
                blob = result.blob;
                if (blob) break;
            } catch (error: any) {
                lastError = error;
                if (i < 4) await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
        if (!blob) throw new Error(lastError?.message || 'Failed to download PDF from SignWell after retries');

        const pdfBuffer = await blob.arrayBuffer();

        const { data: vault } = await admin
            .from('client_data_vault')
            .select('client_name')
            .eq('id', biz.client_vault_id)
            .maybeSingle();
        const label = biz.company_name || vault?.client_name || 'Funding Application';

        // 4. Upload to storage.
        const filePath = `${user.id}/funding_application_${biz.id}_${Date.now()}.pdf`;
        const { error: storageError } = await admin.storage
            .from('user-documents')
            .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: false });
        if (storageError) throw new Error(`Storage upload error: ${storageError.message}`);

        // 5. Business-scoped funding_application document.
        const { data: docRecord, error: dbError } = await admin
            .from('user_documents')
            .insert({
                user_id: user.id,
                name: `Funding Application - ${label}.pdf`,
                size: pdfBuffer.byteLength,
                type: 'application/pdf',
                storage_path: filePath,
                category: 'funding_application',
                doc_code: 'funding_application',
                business_profile_id: biz.id,
                funding_deal_id: deal.id,
                custom_label: `Funding Application - ${label}`,
                metadata: {
                    tags: ['funding_application', 'signwell', 'business-sync'],
                    source: 'sync_business_contract_api',
                    document_id: documentId,
                },
            })
            .select('id')
            .single();
        if (dbError) throw new Error(`Database insert error: ${dbError.message}`);

        // 6. Mark the business's funding_deal complete.
        await admin
            .from('funding_deals')
            .update({ contract_completed: true, contract_completed_at: new Date().toISOString() })
            .eq('id', deal.id);

        // 7. Sync to GHL (best-effort).
        try {
            const { ghlSyncDocument } = await import('@/lib/ghl-document-sync');
            await ghlSyncDocument(admin, docRecord.id, user.id, 'funding_application');
        } catch (syncError) {
            console.error('⚠️ GHL sync failed (non-fatal):', syncError);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('❌ sync-business-contract error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
