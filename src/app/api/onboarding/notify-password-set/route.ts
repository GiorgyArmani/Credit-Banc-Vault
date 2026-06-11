// src/app/api/onboarding/notify-password-set/route.ts
//
// Called by the onboarding Step 3 set-password component AFTER the client has
// successfully set their own password. This is the client's FIRST password
// (they entered via a passwordless magic link and never saw the temp one), so
// we deliberately do NOT send a "your password was changed" email here — that
// wording is confusing for a first-time setup. We only signal GHL:
//   - SMS:   GHL `password-updated` tag → a GHL workflow dispatches the text
//
// Best-effort: the password is already set, so a failure here must not block
// the client from entering the vault. (A genuine later password-change flow
// would be the right place to send send_password_updated_notification.)

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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

        if (!client_email) {
            // Nothing to signal — still report success so onboarding proceeds.
            return NextResponse.json({ success: true, notified: false });
        }

        // GHL tag → SMS confirmation (non-fatal). No email: see file header —
        // first-time setup shouldn't tell the client their password "changed".
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
