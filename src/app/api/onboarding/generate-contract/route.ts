import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signWell } from '@/lib/signwell';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log(`📑 Generating contract for user: ${user.id}`);

        // 1. Get User Data from Vault
        const { data: vaultData, error: vaultError } = await supabase
            .from('client_data_vault')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (vaultError || !vaultData) {
            console.error('❌ Error fetching vault data:', vaultError);
            return NextResponse.json({ error: 'Client data not found' }, { status: 404 });
        }

        // 2. Check if URL already exists
        if (vaultData.contract_url) {
            console.log('✅ Contract URL already exists, returning it.');
            return NextResponse.json({
                success: true,
                contractUrl: vaultData.contract_url,
                alreadyExists: true
            });
        }

        // 3. Prepare SignWell Params
        // Speed-form clients ALWAYS sign the general funding application
        // (SIGNWELL_TEMPLATE_ID) — never the PTL template — since the speed
        // form is the fast-track of the paper FUNDING APPLICATION itself.
        const isPersonalTermLoan =
            vaultData.proposed_loan_type === 'Personal Term Loan' &&
            vaultData.signup_flow !== 'speed';

        const templateId = isPersonalTermLoan
            ? process.env.SIGNWELL_PTL_TEMPLATE_ID
            : process.env.SIGNWELL_TEMPLATE_ID;

        if (!templateId) {
            const missingVar = isPersonalTermLoan ? 'SIGNWELL_PTL_TEMPLATE_ID' : 'SIGNWELL_TEMPLATE_ID';
            console.error(`❌ ${missingVar} is missing`);
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        console.log(`📄 Loan type: "${vaultData.proposed_loan_type}" → using template: ${templateId}`);

        // Fields to map - keys must match SignWell template API IDs exactly
        let fields: Record<string, string>;

        if (isPersonalTermLoan) {
            // Personal Term Loan – simplified field set
            fields = {
                application_client_firstname: vaultData.client_name?.split(' ')[0] || '',
                application_client_lastname: vaultData.client_name?.split(' ').slice(1).join(' ') || '',
                application_client_ssn: vaultData.ssn || '',
                application_email: vaultData.client_email || '',
                funding_amount_requested: vaultData.capital_requested?.toString() || ''
            };
        } else {
            const today = new Date();
            const agreementDay = today.getDate().toString();
            const agreementMonth = today.toLocaleString('default', { month: 'long' });

            fields = {
                // Business Details
                application_business_name: vaultData.company_name,
                application_dba: vaultData.dba || '', // Collected by the speed form only
                application_taxid: vaultData.ein,
                application_state_of_incorporation: vaultData.state_of_incorporation || vaultData.company_state,
                application_business_start_date: vaultData.business_start_date,
                application_industry: vaultData.industry,
                application_address: vaultData.business_address || vaultData.company_address,
                application_city: vaultData.company_city,
                application_state: vaultData.company_state,
                application_zip_code: vaultData.company_zip_code,
                physical_location_phone: vaultData.client_phone,
                preferred_contact_phone: vaultData.client_phone,
                application_cell: vaultData.client_phone,
                application_fax: '', // Not collected
                application_email: vaultData.client_email,
                application_website: '', // Not collected
                gross_annual_revenue: vaultData.avg_annual_revenue?.toString(),
                avg_monthly_cc_sales: '', // Not collected — never reuse bank deposits here (would be a fake number)
                funding_amount_requested: vaultData.capital_requested?.toString(),
                monthly_bank_deposit: vaultData.avg_monthly_deposits?.toString(),
                use_of_funds: vaultData.loan_purpose,

                // Client Details — the owner_1_* / dob fields are collected by
                // the speed form only; the standard flow leaves them null and
                // the template falls back to '' / the client phone as before.
                application_client_firstname: vaultData.client_name?.split(' ')[0],
                application_client_lastname: vaultData.client_name?.split(' ').slice(1).join(' '),
                application_client_ownership: vaultData.owner_1_ownership_pct?.toString(),
                application_client_dob: vaultData.owner_1_dob || '',
                application_client_ssn: vaultData.ssn,
                application_client_email2: vaultData.client_email,
                application_client_street_address: vaultData.home_address,
                // Owner city/state/zip mirror the business location (per spec).
                application_client_city: vaultData.company_city || '',
                application_client_state: vaultData.company_state || '',
                application_client_zipcode: vaultData.company_zip_code || '',
                application_client_homephone: vaultData.owner_1_home_phone || vaultData.client_phone,
                application_client_cellphone: vaultData.client_phone,
                application_client_name: vaultData.client_name,

                // Agreement
                agreement_day: agreementDay,
                agreement_month: agreementMonth,
                agreement_company: vaultData.company_name,
                agreement_company_address: vaultData.business_address || vaultData.company_address || '',
                agreement_client_name: vaultData.client_name,
                agreement_client_jobtitle: 'Owner',
            };
        }

        // 4. Call SignWell API
        try {
            const { signingUrl, embeddedSigningUrl, documentId } = await signWell.createDocument({
                templateId,
                recipientEmail: vaultData.client_email,
                recipientName: vaultData.client_name,
                fields
            });

            console.log(`✅ Document created: ${documentId}`);

            // Use embedded URL if available, otherwise fallback to standard
            // Append document ID to URL for easy extraction later (Hack for no schema change)
            const baseUrl = embeddedSigningUrl || signingUrl;
            const finalUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}doc_id=${documentId}`;

            // 5. Save URL to DB
            const { error: updateError } = await supabase
                .from('client_data_vault')
                .update({
                    contract_url: finalUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', user.id);

            if (updateError) {
                console.error('❌ Error saving contract URL to DB:', updateError);
                // Return URL anyway so user can proceed
            }

            return NextResponse.json({
                success: true,
                contractUrl: finalUrl
            });

        } catch (apiError: any) {
            console.error('❌ SignWell API execution failed:', apiError);
            return NextResponse.json({
                error: 'Failed to create contract document',
                details: apiError.message
            }, { status: 502 });
        }

    } catch (error: any) {
        console.error('❌ Generate contract error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
