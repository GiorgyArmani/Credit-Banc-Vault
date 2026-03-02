// src/app/underwriting/dashboard/actions.ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { send_advisor_document_notification } from "@/lib/email";

export async function notifyAdvisor(clientId: string, requestedDocs: string[]) {
    const supabase = createAdminClient();

    try {
        // 1. Fetch client and advisor info
        const { data: client, error: clientError } = await supabase
            .from("client_data_vault")
            .select(`
                client_name,
                advisor_id,
                advisors (
                    first_name,
                    last_name,
                    email
                )
            `)
            .eq("id", clientId)
            .single();

        if (clientError || !client) {
            return { success: false, error: "Client or advisor not found" };
        }

        const advisor = client.advisors as any;
        if (!advisor || !advisor.email) {
            return { success: false, error: "Advisor contact info missing" };
        }

        // 2. Send notification email
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
