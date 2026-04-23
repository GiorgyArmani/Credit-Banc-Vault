"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function fetchFileNotes(clientId: string) {
    const supabase = await createClient();

    try {
        const { data, error } = await supabase
            .from("client_file_notes")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (error) throw error;
        return { success: true, notes: data || [] };
    } catch (error: any) {
        console.error("fetchFileNotes error:", error);
        return { success: false, error: error.message };
    }
}

export async function addFileNote(clientId: string, content: string) {
    const supabase = await createClient();
    const supabaseAdmin = createAdminClient();

    try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) throw new Error("Unauthorized");

        const trimmed = (content || "").trim();
        if (!trimmed) throw new Error("Note cannot be empty");

        // Verify caller has access to this client (owner OR follower)
        const { data: client } = await supabase
            .from("client_data_vault")
            .select("advisor_id")
            .eq("id", clientId)
            .single();
        if (!client) throw new Error("Client not found");

        const { data: advisor } = await supabase
            .from("advisors")
            .select("id")
            .eq("user_id", currentUser.id)
            .single();
        if (!advisor) throw new Error("Advisor profile not found");

        const isOwner = client.advisor_id === advisor.id;
        let hasAccess = isOwner;
        if (!hasAccess) {
            const { data: follower } = await supabase
                .from("client_followers")
                .select("id")
                .eq("client_vault_id", clientId)
                .eq("advisor_id", advisor.id)
                .maybeSingle();
            hasAccess = !!follower;
        }
        if (!hasAccess) throw new Error("Access denied: You do not have access to this client");

        // Pull author name from users table (fallback to "Advisor")
        const { data: profile } = await supabaseAdmin
            .from("users")
            .select("first_name, last_name")
            .eq("id", currentUser.id)
            .single();

        const authorName = profile
            ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "Advisor"
            : "Advisor";

        const { error } = await supabaseAdmin
            .from("client_file_notes")
            .insert({
                client_id: clientId,
                author_id: currentUser.id,
                author_role: "advisor",
                author_name: authorName,
                content: trimmed,
            });

        if (error) throw error;

        return { success: true };
    } catch (error: any) {
        console.error("addFileNote error:", error);
        return { success: false, error: error.message };
    }
}
