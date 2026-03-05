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
