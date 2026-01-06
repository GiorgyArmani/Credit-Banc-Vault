import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ghlUpdateContact, ghlAddTags } from '@/lib/ghl-api';

// GHL Custom Field IDs
const GHL_FIELDS = {
    EIN: process.env.GHL_CF_EIN_NUMBER!,
    SSN: process.env.GHL_CF_SSN!,
    INDUSTRY: process.env.GHL_CF_INDUSTRY!,
    HOME_ADDRESS: process.env.GHL_CF_HOME_ADDRESS!,
    BUSINESS_ADDRESS: process.env.GHL_CF_BUSINESS_ADDRESS!,
};

export async function POST(request: Request) {
    try {
        // Validate Env Vars
        if (!GHL_FIELDS.EIN || !GHL_FIELDS.SSN || !GHL_FIELDS.INDUSTRY || !GHL_FIELDS.HOME_ADDRESS || !GHL_FIELDS.BUSINESS_ADDRESS) {
            console.error("❌ Missing GHL Environment Variables");
            return NextResponse.json({ message: "Server Configuration Error" }, { status: 500 });
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { ein, ssn, industry, homeAddress, businessAddress } = body;

        // Basic validation
        if (!ein || !ssn || !industry || !homeAddress || !businessAddress) {
            return NextResponse.json(
                { message: 'Missing required fields' },
                { status: 400 }
            );
        }

        // 1. Get user's GHL Contact ID from client_data_vault
        const { data: vaultData, error: vaultError } = await supabase
            .from('client_data_vault')
            .select('ghl_contact_id')
            .eq('user_id', user.id)
            .single();

        if (vaultError || !vaultData?.ghl_contact_id) {
            console.error('Error fetching GHL Contact ID:', vaultError);
            return NextResponse.json(
                { message: 'GHL Contact ID not found for this user' },
                { status: 404 }
            );
        }

        const ghlContactId = vaultData.ghl_contact_id;



        // 2. Store in Supabase client_data_vault
        const { error: vaultUpdateError } = await supabase
            .from('client_data_vault')
            .update({
                ein,
                ssn,
                industry,
                home_address: homeAddress,
                business_address: businessAddress,
                data_vault_submitted_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);

        if (vaultUpdateError) {
            console.error('❌ Error updating client_data_vault:', vaultUpdateError);
            // Continue anyway to sync to GHL
        } else {
            console.log('✅ Successfully stored data in client_data_vault');
        }



        // 5. Sync EIN, SSN, Industry, Addresses, and signature metadata to GHL
        const allFields = [
            { id: GHL_FIELDS.EIN, value: ein },
            { id: GHL_FIELDS.SSN, value: ssn },
            { id: GHL_FIELDS.INDUSTRY, value: industry },
            { id: GHL_FIELDS.HOME_ADDRESS, value: homeAddress },
            { id: GHL_FIELDS.BUSINESS_ADDRESS, value: businessAddress },
        ];

        console.log('📤 Syncing all fields to GHL:', {
            contactId: ghlContactId,
            fieldCount: allFields.length,
        });

        try {
            const ghlResponse = await ghlUpdateContact(ghlContactId, {
                customFields: allFields,
            });

            console.log('✅ GHL Update Response:', ghlResponse);

            // Add tag
            const tagResponse = await ghlAddTags(ghlContactId, ['application_submitted']);
            console.log('✅ GHL Tag Response:', tagResponse);

            console.log(`✅ Successfully synced Step 1 data and added tag to GHL for contact ${ghlContactId}`);

            // 6. Update User Metadata
            const { error: updateError } = await supabase.auth.updateUser({
                data: { onboarding_complete: true }
            });

            if (updateError) {
                console.error('❌ Error updating user metadata:', updateError);
            } else {
                console.log('✅ User metadata updated: onboarding_complete = true');
            }

        } catch (ghlError) {
            console.error('❌ Error syncing to GHL:', ghlError);
            throw new Error('Failed to sync data to external system');
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('Error in submit-step-1:', error);
        return NextResponse.json(
            { message: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
