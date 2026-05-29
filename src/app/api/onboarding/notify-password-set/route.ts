// src/app/api/onboarding/notify-password-set/route.ts
//
// Called by the onboarding Step 3 set-password component AFTER the client has
// successfully set their own password. Fires the two "password updated"
// confirmations:
//   - Email: send_password_updated_notification (client only)
//   - SMS:   GHL `password-updated` tag → a GHL workflow dispatches the text
//
// Both are best-effort: the password is already set, so a failure here must not
// block the client from entering the vault.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { send_password_updated_notification } from '@/lib/email';
import { ghlSearchContacts, ghlAddTags } from '@/lib/ghl-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Resolve the client's display name + email from the vault record.
        const admin = createAdminClient();
        const { data: vault } = await admin
            .from('client_data_vault')
            .select('client_name, client_email')
            .eq('user_id', user.id)
            .maybeSingle();

        const client_email = vault?.client_email || user.email;
        const client_name = vault?.client_name || 'there';

        if (!client_email) {
            // Nothing to notify — still report success so onboarding proceeds.
            return NextResponse.json({ success: true, notified: false });
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';

        // 1. Email confirmation (non-fatal).
        try {
            await send_password_updated_notification({
                client_name,
                client_email,
                login_url: `${appUrl}/auth/login`,
            });
            console.log(`✅ Password-updated email sent to ${client_email}`);
        } catch (emailErr) {
            console.error('⚠️ Password-updated email failed (non-fatal):', emailErr);
        }

        // 2. GHL tag → SMS confirmation (non-fatal).
        try {
            if (process.env.GHL_TOKEN && process.env.GHL_LOCATION_ID) {
                const contacts = await ghlSearchContacts({
                    email: client_email.toLowerCase(),
                    locationId: process.env.GHL_LOCATION_ID,
                });
                if (contacts.length > 0) {
                    await ghlAddTags(contacts[0].id, ['password-updated']);
                    console.log(`✅ password-updated tag added to GHL contact ${contacts[0].id}`);
                } else {
                    console.warn(`⚠️ No GHL contact found for ${client_email} — skipping password-updated tag`);
                }
            }
        } catch (ghlErr) {
            console.error('⚠️ Password-updated GHL tag failed (non-fatal):', ghlErr);
        }

        return NextResponse.json({ success: true, notified: true });
    } catch (error: any) {
        console.error('❌ notify-password-set error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
