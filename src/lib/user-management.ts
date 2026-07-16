import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generates a secure random password as a hex string.
 * @returns A 32-character secure random hex string
 */
export function generateSecurePassword(): string {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for environments where crypto might be limited (though unlikely in modern Node/Edge)
    return Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
}

/**
 * Interface representing the core client data needed across all tables.
 * This is a subset of fields that are common or needed for initialization.
 */
export interface UnifiedClientData {
    userId: string;
    email: string;
    clientName: string;
    companyName: string;
    role?: 'free' | 'advisor' | 'underwriting' | 'admin' | 'setter' | 'affiliate';
    industry?: string;
    phone?: string;
    state?: string;
    city?: string;
    zipCode?: string;
    advisorId?: string;
    advisorName?: string;
}

/**
 * Unified utility to ensure a client has records in all 3 essential tables:
 * 1. public.users (Identity & RBAC)
 * 2. client_data_vault (Business/Funding details)
 * 3. business_profiles (AI Coach/Academy context)
 * 
 * @param supabase - Supabase client (usually admin/service role)
 * @param data - The client data to sync
 */
export async function syncUnifiedClientData(
    supabase: SupabaseClient,
    data: UnifiedClientData
) {
    const {
        userId,
        email,
        clientName,
        companyName,
        role = 'free',
        industry,
        phone,
        state,
        city,
        zipCode,
        advisorId,
        advisorName,
    } = data;

    const firstName = clientName.split(' ')[0];
    const lastName = clientName.split(' ').slice(1).join(' ') || '';

    // 1. Sync public.users (Critical for RBAC)
    const { error: userError } = await supabase
        .from('users')
        .upsert({
            id: userId,
            email: email.toLowerCase(),
            first_name: firstName,
            last_name: lastName,
            role: role,
        }, { onConflict: 'id' });

    if (userError) {
        console.error('[User Sync] Error upserting public.users:', userError);
        // Continue anyway, but log it
    }

    // 2. Ensure client_data_vault has basic info (Critical for Dashboard).
    //    Runs BEFORE business_profiles because the new schema links each business
    //    to its client_data_vault row (client_vault_id), and primary-business
    //    uniqueness is enforced per-vault (not per-user) by the partial unique
    //    index `business_profiles_one_primary_per_client`.
    const { data: existingVault } = await supabase
        .from('client_data_vault')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    const vaultPayload = {
        // Identity / Basic Info (Always update these)
        user_id: userId,
        client_name: clientName,
        client_email: email.toLowerCase(),
        company_name: companyName,
        company_state: state || existingVault?.company_state || 'Unknown',
        company_zip_code: zipCode || existingVault?.company_zip_code || '00000',
        client_phone: phone || existingVault?.client_phone || '000-000-0000',
        updated_at: new Date().toISOString(),

        // Required Financial/Business Fields (Merge with existing or use safe defaults)
        capital_requested: existingVault?.capital_requested ?? 0,
        loan_purpose: existingVault?.loan_purpose ?? 'Business Funding',
        proposed_loan_type: existingVault?.proposed_loan_type ?? 'Other',
        avg_monthly_deposits: existingVault?.avg_monthly_deposits ?? 0,
        avg_annual_revenue: existingVault?.avg_annual_revenue ?? 0,
        legal_entity_type: existingVault?.legal_entity_type ?? 'Other',
        business_start_date: existingVault?.business_start_date ?? new Date().toISOString().split('T')[0],
        employees_count: existingVault?.employees_count ?? 0,
        number_of_owners: existingVault?.number_of_owners ?? '1',
        owner_1_name: existingVault?.owner_1_name ?? clientName,
        owner_1_ownership_pct: existingVault?.owner_1_ownership_pct ?? 100,
        credit_score: existingVault?.credit_score ?? '700+',
        has_existing_loans: existingVault?.has_existing_loans ?? false,
        has_defaulted_mca: existingVault?.has_defaulted_mca ?? false,
        owns_real_estate: existingVault?.owns_real_estate ?? false,
        has_reduced_mca_payments: existingVault?.has_reduced_mca_payments ?? false,
        has_bankruptcy_foreclosure_3y: existingVault?.has_bankruptcy_foreclosure_3y ?? false,
        has_tax_liens: existingVault?.has_tax_liens ?? false,
        has_active_judgements: existingVault?.has_active_judgements ?? false,
        funding_eta: existingVault?.funding_eta ?? 'Immediately',
        additional_notes: existingVault?.additional_notes ?? 'Synced from identity',
        advisor_name: advisorName ?? existingVault?.advisor_name ?? 'Unknown',
        advisor_id: advisorId ?? existingVault?.advisor_id,
        status: existingVault?.status ?? 'active',
    };

    const { data: vaultRow, error: vaultError } = await supabase
        .from('client_data_vault')
        .upsert(vaultPayload, { onConflict: 'user_id' })
        .select('id')
        .single();

    if (vaultError) {
        console.error('[User Sync] Error upserting client_data_vault:', vaultError);
    }

    // 3. Sync the primary business_profiles row for this client (Critical for AI Chat
    //    + new per-business deal flow). user_id is no longer unique, so we resolve
    //    "the primary business" by (client_vault_id, is_primary=true) instead.
    let profileError: unknown = null;
    if (vaultRow?.id) {
        const { data: existingBp } = await supabase
            .from('business_profiles')
            .select('id')
            .eq('client_vault_id', vaultRow.id)
            .eq('is_primary', true)
            .maybeSingle();

        const bpPayload = {
            user_id: userId,
            client_vault_id: vaultRow.id,
            is_primary: true,
            company_name: companyName,
            business_name: companyName,
            industry: industry || null,
            company_state: state || null,
            company_city: city || null,
            company_zip_code: zipCode || null,
            state: state || null,
            city: city || null,
            zip: zipCode || null,
            phone: phone || null,
        };

        if (existingBp) {
            const { error } = await supabase
                .from('business_profiles')
                .update(bpPayload)
                .eq('id', existingBp.id);
            profileError = error;
        } else {
            const { error } = await supabase
                .from('business_profiles')
                .insert(bpPayload);
            profileError = error;
        }

        if (profileError) {
            console.error('[User Sync] Error syncing business_profiles:', profileError);
        }
    }

    return { success: !userError && !profileError && !vaultError };
}
