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

        // 1. Get client's GHL contact ID
        const { data: clientData, error: fetchError } = await supabase
            .from("client_data_vault")
            .select("id, ghl_contact_id")
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
            // If no GHL ID, we can't tag, but we should still mark as submitted locally? 
            // Or should we error? For now let's log and proceed with local update only if possible, 
            // but the requirement is specifically about tagging. 
            // Let's assume GHL ID is required for this specific "vault_submitted" flow as it's the primary goal.
            console.warn("No GHL Contact ID found for user", user.id);
        } else {
            // 2. Add tag in GHL
            await ghlAddTags(clientData.ghl_contact_id, ["vault_submitted"]);
        }

        // 3. Mark as submitted in DB
        const { error: updateError } = await supabase
            .from("client_data_vault")
            .update({
                data_vault_submitted_at: new Date().toISOString(),
            })
            .eq("id", clientData.id);

        if (updateError) {
            throw updateError;
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
