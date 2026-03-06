"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { ghlAddTags, ghlUpdateContact } from "@/lib/ghl-api";
import { syncUnifiedClientData } from "@/lib/user-management";

/**
 * requestNewDocument
 * 
 * Allows an advisor to request a new document from a client.
 * Updates the database and syncs the request tag to GoHighLevel.
 */
/**
 * requestDocuments
 * 
 * Allows an advisor to request one or more new documents from a client.
 * Updates the database and syncs the request tags to GoHighLevel.
 */
export async function requestDocuments(clientId: string, documentIds: string[]) {
    try {
        if (!documentIds || documentIds.length === 0) {
            throw new Error("No documents selected");
        }

        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) {
            throw new Error("Unauthorized");
        }

        // 2. Verify advisor ownership and get client user_id + ghl_contact_id
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id, ghl_contact_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            console.error("Client fetch error or unauthorized:", clientError);
            throw new Error("Client not found or access denied");
        }

        // 3. Get document details for GHL tagging
        const { data: docDefs, error: docsError } = await supabase
            .from("required_documents")
            .select("id, code, ghl_tag")
            .in("id", documentIds);

        if (docsError || !docDefs || docDefs.length === 0) {
            throw new Error("Selected document types not found");
        }

        // 4. Batch upsert into client_dynamic_documents
        const supabaseAdmin = createAdminClient();
        const dynamicsToInsert = documentIds.map(docId => ({
            user_id: client.user_id,
            document_id: docId,
            is_active: true,
            requested_at: new Date().toISOString()
        }));

        const { error: insertError } = await supabaseAdmin
            .from("client_dynamic_documents")
            .upsert(dynamicsToInsert, { onConflict: 'user_id, document_id' });

        if (insertError) {
            console.error("Error inserting dynamic documents:", insertError);
            throw new Error("Failed to update document requirements in database");
        }

        // 5. GHL Sync: Add requested tags for each document
        if (client.ghl_contact_id) {
            const tagsToAdd = docDefs
                .map(d => d.ghl_tag)
                .filter(tag => !!tag) as string[];

            if (tagsToAdd.length > 0) {
                try {
                    await ghlAddTags(client.ghl_contact_id, tagsToAdd);
                    console.log(`✅ ${tagsToAdd.length} GHL tags added for contact ${client.ghl_contact_id}`);
                } catch (ghlError) {
                    console.error("GHL Sync Error (non-fatal):", ghlError);
                }
            }
        }

        // 6. Revalidate the client detail page
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in requestDocuments:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * updateClientProfile
 * 
 * Allows an advisor to update a client's profile information.
 * Syncs changes to public.users, business_profiles, and GoHighLevel.
 */
export async function updateClientProfile(clientId: string, data: any) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) {
            throw new Error("Unauthorized");
        }

        // 2. Verify advisor ownership and get critical fields
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id, ghl_contact_id, advisor_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            throw new Error("Client not found");
        }

        // Verify advisor ownership via advisor record
        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || client.advisor_id !== advisorData.id) {
            throw new Error("Access denied: You do not own this client");
        }

        const supabaseAdmin = createAdminClient();

        // 3. Update client_data_vault
        const { error: updateError } = await supabaseAdmin
            .from("client_data_vault")
            .update({
                client_name: data.client_name,
                client_email: data.client_email.toLowerCase(),
                client_phone: data.client_phone,
                company_name: data.company_name,
                company_city: data.company_city,
                company_state: data.company_state,
                company_zip_code: data.company_zip_code,
                capital_requested: data.capital_requested,
                avg_monthly_deposits: data.avg_monthly_deposits,
                avg_annual_revenue: data.avg_annual_revenue,
                credit_score: data.credit_score,
                legal_entity_type: data.legal_entity_type,
                business_start_date: data.business_start_date,
                loan_purpose: data.loan_purpose,
                proposed_loan_type: data.proposed_loan_type,
                funding_eta: data.funding_eta,
                employees_count: data.employees_count,
                is_home_based: data.is_home_based,
                updated_at: new Date().toISOString()
            })
            .eq("id", clientId);

        if (updateError) {
            throw new Error(`Failed to update vault: ${updateError.message}`);
        }

        // 4. Sync to Unified Tables (users, business_profiles)
        await syncUnifiedClientData(supabaseAdmin, {
            userId: client.user_id,
            email: data.client_email,
            clientName: data.client_name,
            companyName: data.company_name,
            phone: data.client_phone,
            city: data.company_city,
            state: data.company_state,
            zipCode: data.company_zip_code
        });

        // 5. GHL Sync: Update contact info
        if (client.ghl_contact_id) {
            try {
                await ghlUpdateContact(client.ghl_contact_id, {
                    firstName: data.client_name.split(' ')[0],
                    lastName: data.client_name.split(' ').slice(1).join(' ') || '',
                    email: data.client_email.toLowerCase(),
                    phone: data.client_phone,
                    companyName: data.company_name,
                    city: data.company_city,
                    state: data.company_state,
                    postalCode: data.company_zip_code,
                    // Optionally update more custom fields if needed
                });
            } catch (ghlError) {
                console.error("GHL Sync Error (non-fatal):", ghlError);
            }
        }

        // 6. Revalidate
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in updateClientProfile:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * deleteClientFile
 * 
 * Allows an advisor to delete a document uploaded by a client.
 * Verifies ownership before removing from storage and database.
 */
export async function deleteClientFile(clientId: string, documentId: string) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 2. Verify advisor ownership
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || client.advisor_id !== advisorData.id) {
            throw new Error("Access denied: You do not own this client");
        }

        // 3. Get document storage path
        const { data: doc, error: docError } = await supabase
            .from("user_documents")
            .select("storage_path, name")
            .eq("id", documentId)
            .single();

        if (docError || !doc) throw new Error("Document not found");

        const supabaseAdmin = createAdminClient();

        // 4. Delete from Storage
        const { error: storageError } = await supabaseAdmin.storage
            .from("user-documents")
            .remove([doc.storage_path]);

        if (storageError) {
            console.error("Storage deletion error:", storageError);
        }

        // 5. Delete from Database
        const { error: dbError } = await supabaseAdmin
            .from("user_documents")
            .delete()
            .eq("id", documentId);

        if (dbError) throw new Error(`Failed to delete document record: ${dbError.message}`);

        // 6. Revalidate
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in deleteClientFile:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}

/**
 * deleteClientVault
 * 
 * Permanently deletes a client's data vault and associated records.
 */
export async function deleteClientVault(clientId: string) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) throw new Error("Unauthorized");

        // 2. Verify advisor ownership
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select("id, advisor_id, user_id")
            .eq("id", clientId)
            .single();

        if (clientError || !client) throw new Error("Client not found");

        const { data: advisorData } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", advisorUser.id)
            .single();

        if (!advisorData || client.advisor_id !== advisorData.id) {
            throw new Error("Access denied: You do not own this client");
        }

        const supabaseAdmin = createAdminClient();

        // 3. Delete all client documents from storage first
        const { data: docs } = await supabaseAdmin
            .from("user_documents")
            .select("storage_path")
            .eq("user_id", client.user_id);

        if (docs && docs.length > 0) {
            const paths = docs.map(d => d.storage_path);
            await supabaseAdmin.storage.from("user-documents").remove(paths);
        }

        // 4. Delete client_data_vault record (cascade should handle others if set up, 
        // otherwise we might need manual cleanup of user_documents, etc.)
        // In many systems we prefer soft delete, but "CRUD" implies actual delete.
        const { error: deleteError } = await supabaseAdmin
            .from("client_data_vault")
            .delete()
            .eq("id", clientId);

        if (deleteError) throw new Error(`Failed to delete client vault: ${deleteError.message}`);

        // Note: We are NOT deleting the actual auth.user or public.users record 
        // to avoid breaking other potential links, but the vault access is gone.

        return { success: true };
    } catch (error: any) {
        console.error("Exception in deleteClientVault:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}
