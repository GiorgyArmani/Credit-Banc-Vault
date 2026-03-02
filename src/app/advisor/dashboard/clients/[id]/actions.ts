"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { ghlAddTags } from "@/lib/ghl-api";

/**
 * requestNewDocument
 * 
 * Allows an advisor to request a new document from a client.
 * Updates the database and syncs the request tag to GoHighLevel.
 */
export async function requestNewDocument(clientId: string, documentId: string) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated advisor
        const { data: { user: advisorUser } } = await supabase.auth.getUser();
        if (!advisorUser) {
            throw new Error("Unauthorized");
        }

        // 2. Verify advisor ownership and get client user_id + ghl_contact_id
        // We query client_data_vault directly. RLS should allow this if the user is the assigned advisor.
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
        const { data: docDef, error: docError } = await supabase
            .from("required_documents")
            .select("code, ghl_tag")
            .eq("id", documentId)
            .single();

        if (docError || !docDef) {
            throw new Error("Document type not found");
        }

        // 4. Upsert into client_dynamic_documents
        // Using admin client to ensure system-level consistency
        const supabaseAdmin = createAdminClient();
        const { error: insertError } = await supabaseAdmin
            .from("client_dynamic_documents")
            .upsert({
                user_id: client.user_id,
                document_id: documentId,
                is_active: true,
                requested_at: new Date().toISOString()
            }, { onConflict: 'user_id, document_id' });

        if (insertError) {
            console.error("Error inserting dynamic document:", insertError);
            throw new Error("Failed to update document requirements in database");
        }

        // 5. GHL Sync: Add requested tag
        if (client.ghl_contact_id && docDef.ghl_tag) {
            try {
                await ghlAddTags(client.ghl_contact_id, [docDef.ghl_tag]);
                console.log(`✅ GHL tag added: ${docDef.ghl_tag} for contact ${client.ghl_contact_id}`);
            } catch (ghlError) {
                console.error("GHL Sync Error (non-fatal):", ghlError);
                // We continue as the DB is already updated
            }
        }

        // 6. Revalidate the client detail page
        revalidatePath(`/advisor/dashboard/clients/${clientId}`);

        return { success: true };
    } catch (error: any) {
        console.error("Exception in requestNewDocument:", error);
        return { success: false, error: error.message || "An unexpected error occurred" };
    }
}
