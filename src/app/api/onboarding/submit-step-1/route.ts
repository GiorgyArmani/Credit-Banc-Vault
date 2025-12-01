import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ghlUpdateContact, ghlAddTags } from '@/lib/ghl-api';

// GHL Custom Field IDs
const GHL_FIELDS = {
    EIN: process.env.GHL_CF_EIN_NUMBER!,
    SSN: process.env.GHL_CF_SSN!,
    APPLICANT_1_SIGNATURE: process.env.GHL_CF_APPLICANT_1_SIGNATURE!,
    CO_APPLICANT_SIGNATURE: process.env.GHL_CF_CO_APPLICANT_SIGNATURE!,
};

export async function POST(request: Request) {
    try {
        // Validate Env Vars
        if (!GHL_FIELDS.EIN || !GHL_FIELDS.SSN || !GHL_FIELDS.APPLICANT_1_SIGNATURE || !GHL_FIELDS.CO_APPLICANT_SIGNATURE) {
            console.error("❌ Missing GHL Environment Variables");
            return NextResponse.json({ message: "Server Configuration Error" }, { status: 500 });
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { ein, ssn, applicant1Signature, coApplicantSignature } = body;

        // Basic validation
        if (!ein || !ssn || !applicant1Signature || !coApplicantSignature) {
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

        // Helper function to upload signature to GHL and update custom field
        async function uploadSignatureToGHL(
            base64Data: string,
            fieldId: string,
            fileName: string
        ): Promise<{ success: boolean; fileData?: any; error?: string }> {
            try {
                // Convert base64 to Blob
                const base64Response = await fetch(base64Data);
                const blob = await base64Response.blob();

                // Create File from Blob
                const file = new File([blob], fileName, { type: 'image/png' });

                // Create FormData
                const formData = new FormData();
                formData.append('id', ghlContactId);
                formData.append('maxFiles', '1');
                formData.append(fieldId, file);

                // Upload to GHL
                const ghlLocationId = process.env.GHL_LOCATION_ID;
                if (!ghlLocationId) {
                    throw new Error('GHL_LOCATION_ID not configured');
                }

                const uploadResponse = await fetch(
                    `https://services.leadconnectorhq.com/locations/${ghlLocationId}/customFields/upload`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.GHL_TOKEN}`,
                            'Version': '2021-07-28',
                        },
                        body: formData,
                    }
                );

                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text();
                    console.error(`GHL signature upload failed: ${uploadResponse.status} - ${errorText}`);
                    return { success: false, error: errorText };
                }

                const result = await uploadResponse.json();
                console.log(`✅ Signature uploaded to GHL:`, result);

                // Extract file metadata for custom field update
                if (result.meta && result.meta.length > 0) {
                    const meta = result.meta[0];
                    const uploadedFiles = result.uploadedFiles || {};
                    const fileUrl = Object.values(uploadedFiles)[0] as string;

                    // Extract UUID from URL
                    let uuid = 'undefined';
                    if (fileUrl) {
                        const urlParts = fileUrl.split('/');
                        const lastPart = urlParts[urlParts.length - 1];
                        uuid = lastPart.split('.')[0];
                    }

                    const fileData = {
                        [uuid]: {
                            meta: meta,
                            url: fileUrl,
                            documentId: uuid
                        }
                    };

                    return { success: true, fileData };
                }

                return { success: true };

            } catch (error: any) {
                console.error('Error uploading signature:', error);
                return { success: false, error: error.message };
            }
        }

        // 2. Store in Supabase client_data_vault
        const { error: vaultUpdateError } = await supabase
            .from('client_data_vault')
            .update({
                ein,
                ssn,
                applicant_1_signature: applicant1Signature,
                co_applicant_signature: coApplicantSignature,
                data_vault_submitted_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);

        if (vaultUpdateError) {
            console.error('❌ Error updating client_data_vault:', vaultUpdateError);
            // Continue anyway to sync to GHL
        } else {
            console.log('✅ Successfully stored data in client_data_vault');
        }

        // 3. Upload Signatures to GHL (as files)
        console.log('📤 Uploading signatures to GHL...');

        const sig1Result = await uploadSignatureToGHL(
            applicant1Signature,
            GHL_FIELDS.APPLICANT_1_SIGNATURE,
            'applicant-1-signature.png'
        );

        const sig2Result = await uploadSignatureToGHL(
            coApplicantSignature,
            GHL_FIELDS.CO_APPLICANT_SIGNATURE,
            'co-applicant-signature.png'
        );

        if (!sig1Result.success) {
            console.error('❌ Failed to upload Applicant 1 signature:', sig1Result.error);
        }
        if (!sig2Result.success) {
            console.error('❌ Failed to upload Co-Applicant signature:', sig2Result.error);
        }

        // 4. Update contact custom fields with signature file metadata
        const signatureFields = [];
        if (sig1Result.success && sig1Result.fileData) {
            signatureFields.push({
                id: GHL_FIELDS.APPLICANT_1_SIGNATURE,
                value: sig1Result.fileData
            });
        }
        if (sig2Result.success && sig2Result.fileData) {
            signatureFields.push({
                id: GHL_FIELDS.CO_APPLICANT_SIGNATURE,
                value: sig2Result.fileData
            });
        }

        // 5. Sync EIN, SSN, and signature metadata to GHL
        const allFields = [
            { id: GHL_FIELDS.EIN, value: ein },
            { id: GHL_FIELDS.SSN, value: ssn },
            ...signatureFields
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
