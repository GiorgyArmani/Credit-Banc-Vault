// src/app/underwriting/dashboard/actions.ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { send_advisor_document_notification } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

export async function notifyAdvisor(clientId: string, requestedDocs: string[], customNote?: string) {
    const supabaseAdmin = createAdminClient();
    const supabase = await createClient();

    try {
        // Get the current user (Underwriter)
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) throw new Error("Unauthorized");

        // 1. Fetch client and advisor info
        const { data: client, error: clientError } = await supabaseAdmin
            .from("client_data_vault")
            .select(`
                user_id,
                client_name,
                advisor_id,
                advisors (
                    first_name,
                    last_name,
                    email,
                    user_id
                )
            `)
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            return { success: false, error: "Client or advisor not found" };
        }

        const advisor = client.advisors as any;
        if (!advisor || !advisor.email || !advisor.user_id) {
            return { success: false, error: "Advisor contact info missing" };
        }

        // 2. Insert In-App Notification for the Advisor
        const notificationTitle = `Action Required: Documents for ${client.client_name}`;
        const notificationMessage = `Underwriting has requested missing or additional documents. ${customNote ? 'Note attached.' : ''}`;

        await supabaseAdmin.from("in_app_notifications").insert({
            user_id: advisor.user_id,
            client_id: clientId,
            title: notificationTitle,
            message: notificationMessage,
            is_read: false
        });

        // 3. Insert Internal Note if provided
        if (customNote) {
            // Fetch underwriter profile to get name
            const { data: profile } = await supabaseAdmin
                .from("users")
                .select("first_name, last_name")
                .eq("id", currentUser.id)
                .single();

            const authorName = profile ? `${profile.first_name} ${profile.last_name || ''}`.trim() : "Underwriter";

            await supabaseAdmin.from("client_internal_notes").insert({
                client_id: clientId,
                author_id: currentUser.id,
                author_role: "underwriting",
                author_name: authorName,
                content: customNote
            });
        }

        // 4. Update submission status to 'documents_requested'
        const { error: statusError } = await supabaseAdmin
            .from("submissions")
            .update({ status: 'documents_requested' })
            .eq("user_id", client.user_id);

        if (statusError) {
            console.error("Error updating submission status:", statusError);
            // Non-fatal, but good to know
        }

        // 5. Send notification email
        await send_advisor_document_notification({
            advisor_name: `${advisor.first_name} ${advisor.last_name}`,
            advisor_email: advisor.email,
            client_name: client.client_name,
            requested_documents: requestedDocs,
            login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`
        });

        return { success: true };
    } catch (error: any) {
        console.error("notifyAdvisor error:", error);
        return { success: false, error: error.message };
    }
}
