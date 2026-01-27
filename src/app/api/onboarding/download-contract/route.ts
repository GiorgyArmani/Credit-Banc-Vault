import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signWell } from '@/lib/signwell';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log(`📥 Downloading contract for user: ${user.id}`);

        // 1. Get document ID from client_data_vault
        const { data: vaultData, error: vaultError } = await supabase
            .from('client_data_vault')
            .select('contract_url')
            .eq('user_id', user.id)
            .single();

        if (vaultError || !vaultData?.contract_url) {
            console.error('❌ Error fetching contract URL:', vaultError);
            return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
        }

        // Extract document ID from the contract URL
        // URL format: https://www.signwell.com/s/{documentId}/... OR ...?doc_id={documentId}
        let documentId: string | null = null;

        // Try query param first (New reliable method)
        try {
            const urlObj = new URL(vaultData.contract_url);
            documentId = urlObj.searchParams.get('doc_id');
        } catch (e) {
            // Invalid URL format, ignore
        }

        // Fallback to regex (Old method for legacy URLs, might fail for short links)
        if (!documentId) {
            const urlMatch = vaultData.contract_url.match(/\/s\/([a-f0-9-]+)/i);
            if (urlMatch) {
                documentId = urlMatch[1];
            }
        }

        if (!documentId) {
            console.error('❌ Could not extract document ID from URL:', vaultData.contract_url);
            return NextResponse.json({ error: 'Invalid contract URL format' }, { status: 400 });
        }

        console.log(`📄 Document ID: ${documentId}`);
        console.log(`📄 Document ID: ${documentId}`);

        // 2. Get the completed PDF URL from SignWell
        try {
            const { url } = await signWell.getCompletedPDF({
                documentId,
                urlOnly: true,
                auditPage: true
            });

            if (!url) {
                return NextResponse.json({ error: 'PDF URL not available' }, { status: 404 });
            }

            console.log(`✅ PDF URL retrieved: ${url}`);

            return NextResponse.json({
                success: true,
                downloadUrl: url
            });

        } catch (apiError: any) {
            console.error('❌ SignWell API error:', apiError);
            return NextResponse.json({
                error: 'Failed to retrieve completed contract',
                details: apiError.message
            }, { status: 502 });
        }

    } catch (error: any) {
        console.error('❌ Download contract error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
