"use server";

import { assertNotReadOnly } from "@/lib/read-only-accounts";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertActorMayWorkClient } from "@/lib/client-access";

export async function fetchInternalNotes(clientId: string) {
    const supabase = await createClient();

    try {
        const { data, error } = await supabase
            .from("client_internal_notes")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (error) throw error;
        return { success: true, notes: data || [] };
    } catch (error: any) {
        console.error("fetchInternalNotes error:", error);
        return { success: false, error: error.message };
    }
}

export async function addInternalNote(clientId: string, content: string, role: "underwriting" | "advisor") {
    await assertNotReadOnly();
    const supabase = await createClient();
    const supabaseAdmin = createAdminClient();

    try {
        // Get the current user
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) throw new Error("Unauthorized");
        await assertActorMayWorkClient(supabaseAdmin, currentUser.id, clientId);

        // Fetch profile to get name
        const { data: profile } = await supabaseAdmin
            .from("users")
            .select("first_name, last_name")
            .eq("id", currentUser.id)
            .single();

        const authorName = profile ? `${profile.first_name} ${profile.last_name || ''}`.trim() : (role === "underwriting" ? "Underwriter" : "Advisor");

        const { error } = await supabaseAdmin
            .from("client_internal_notes")
            .insert({
                client_id: clientId,
                author_id: currentUser.id,
                author_role: role,
                author_name: authorName,
                content: content
            });

        if (error) throw error;

        return { success: true };
    } catch (error: any) {
        console.error("addInternalNote error:", error);
        return { success: false, error: error.message };
    }
}
