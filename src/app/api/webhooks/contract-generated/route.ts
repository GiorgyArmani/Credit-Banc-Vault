import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Create Supabase admin client
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WEBHOOK_SECRET = process.env.SIGNWELL_WEBHOOK_SECRET || '';

/**
 * POST /api/webhooks/contract-generated
 * Receives webhook from Zapier when a contract is created in SignWell (but not yet signed).
 * 
 * Payload expected:
 * {
 *   "secret": "...",
 *   "email": "user@example.com",
 *   "signing_url": "https://signwell.com/..."
 * }
 */
export async function POST(request: NextRequest) {
    console.log('🔗 Contract Generated Webhook Received');

    try {
        const payload = await request.json();

        // 1. Validate Secret
        if (!payload.secret || payload.secret !== WEBHOOK_SECRET) {
            console.error('❌ Invalid secret token');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { email, signing_url } = payload;

        if (!email || !signing_url) {
            return NextResponse.json({ error: 'Missing email or signing_url' }, { status: 400 });
        }

        console.log(`📝 Processing contract link for: ${email}`);

        // 2. Find user by email in client_data_vault
        // We use client_email as the lookup key
        const { data: clientData, error: findError } = await supabase
            .from('client_data_vault')
            .select('id, user_id')
            .eq('client_email', email)
            .single();

        if (findError || !clientData) {
            console.error('❌ Client not found:', findError);
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }

        // 3. Update contract_url
        const { error: updateError } = await supabase
            .from('client_data_vault')
            .update({
                contract_url: signing_url,
                updated_at: new Date().toISOString()
            })
            .eq('id', clientData.id);

        if (updateError) {
            console.error('❌ Error updating contract_url:', updateError);
            return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
        }

        console.log('✅ Contract URL updated successfully');
        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('❌ Webhook error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
