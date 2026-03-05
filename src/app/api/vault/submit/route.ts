import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ghlAddTags } from "@/lib/ghl-api";

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 1. Get client's GHL contact ID and Advisor ID
        const { data: clientData, error: fetchError } = await supabase
            .from("client_data_vault")
            .select("id, ghl_contact_id, advisor_id")
            .eq("user_id", user.id)
            .single();

        if (fetchError || !clientData) {
            console.error("Error fetching client data:", fetchError);
            return NextResponse.json(
                { error: "Client data not found" },
                { status: 404 }
            );
        }

        if (!clientData.ghl_contact_id) {
            console.warn("No GHL Contact ID found for user", user.id);
        } else {
            // 2. Add tag in GHL
            await ghlAddTags(clientData.ghl_contact_id, ["vault_submitted"]);
        }

        // 3. Mark as submitted in local client_data_vault
        const { error: updateError } = await supabase
            .from("client_data_vault")
            .update({
                data_vault_submitted_at: new Date().toISOString(),
            })
            .eq("id", clientData.id);

        if (updateError) {
            throw updateError;
        }

        // 4. Create or Update record in public.submissions for Underwriting using upsert
        const { error: submissionError } = await supabase
            .from("submissions")
            .upsert({
                user_id: user.id,
                advisor_id: clientData.advisor_id,
                status: 'submitted',
                submitted_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (submissionError) {
            console.error("Error creating submission record:", submissionError);
            // We don't necessarily want to fail the whole request if this secondary record fails, 
            // but it's important for the new workflow.
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Error submitting vault:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
