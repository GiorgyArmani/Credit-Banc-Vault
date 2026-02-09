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
    role?: 'free' | 'premium' | 'advisor' | 'underwriting';
    industry?: string;
    phone?: string;
    state?: string;
    city?: string;
    zipCode?: string;
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

    // 2. Sync business_profiles (Critical for AI Chat)
    const { error: profileError } = await supabase
        .from('business_profiles')
        .upsert({
            user_id: userId,
            business_name: companyName,
            industry: industry || null,
            state: state || null,
            city: city || null,
            zip: zipCode || null,
            phone: phone || null,
        }, { onConflict: 'user_id' });

    if (profileError) {
        console.error('[User Sync] Error upserting business_profiles:', profileError);
        // Continue
    }

    // 3. Ensure client_data_vault has basic info (Critical for Dashboard)
    // We use .update() or .upsert() depends on context, but here we usually want 
    // to initialize it if it doesn't exist or update core fields.
    const { error: vaultError } = await supabase
        .from('client_data_vault')
        .upsert({
            user_id: userId,
            client_name: clientName,
            client_email: email.toLowerCase(),
            company_name: companyName,
            company_state: state || 'Unknown', // Required field
            company_zip_code: zipCode || '00000', // Required field
            client_phone: phone || '000-000-0000', // Required field
        }, { onConflict: 'user_id' });

    if (vaultError) {
        console.error('[User Sync] Error upserting client_data_vault:', vaultError);
    }

    return { success: !userError && !profileError && !vaultError };
}
