"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
    ghlAddContactFollowers,
    ghlRemoveContactFollowers,
} from "@/lib/ghl-api";
import {
    assertCanAccessClient,
    assertCanManageFollowers,
} from "@/lib/client-access";

export interface FollowerRow {
    advisor_id: string;
    first_name: string;
    last_name: string;
    email: string;
    profile_pic_url: string | null;
    ghl_user_id: string | null;
    assigned_at: string;
}

export interface AssignableAdvisor {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    profile_pic_url: string | null;
    ghl_user_id: string | null;
}

export async function listClientFollowers(
    clientId: string
): Promise<{ success: boolean; followers?: FollowerRow[]; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        await assertCanAccessClient(supabase, user.id, clientId);

        const { data, error } = await supabase
            .from("client_followers")
            .select(`
                advisor_id,
                created_at,
                advisors:advisor_id (
                    id, first_name, last_name, email, profile_pic_url, ghl_user_id
                )
            `)
            .eq("client_vault_id", clientId)
            .order("created_at", { ascending: true });

        if (error) throw error;

        const followers: FollowerRow[] = (data ?? []).map((row: any) => ({
            advisor_id: row.advisor_id,
            first_name: row.advisors?.first_name ?? "",
            last_name: row.advisors?.last_name ?? "",
            email: row.advisors?.email ?? "",
            profile_pic_url: row.advisors?.profile_pic_url ?? null,
            ghl_user_id: row.advisors?.ghl_user_id ?? null,
            assigned_at: row.created_at,
        }));

        return { success: true, followers };
    } catch (error: any) {
        return { success: false, error: error.message ?? "Failed to list followers" };
    }
}

export async function listAssignableAdvisors(
    clientId: string
): Promise<{ success: boolean; advisors?: AssignableAdvisor[]; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        await assertCanAccessClient(supabase, user.id, clientId);

        const { data: client } = await supabase
            .from("client_data_vault")
            .select("advisor_id")
            .eq("id", clientId)
            .maybeSingle();

        const ownerAdvisorId = client?.advisor_id ?? null;

        const { data: followerRows } = await supabase
            .from("client_followers")
            .select("advisor_id")
            .eq("client_vault_id", clientId);
        const excludedIds = new Set<string>(
            (followerRows ?? []).map((r: any) => r.advisor_id)
        );
        if (ownerAdvisorId) excludedIds.add(ownerAdvisorId);

        const { data: advisors, error } = await supabase
            .from("advisors")
            .select("id, first_name, last_name, email, profile_pic_url, ghl_user_id, is_active")
            .eq("is_active", true)
            .order("first_name", { ascending: true });

        if (error) throw error;

        const result: AssignableAdvisor[] = (advisors ?? [])
            .filter((a: any) => !excludedIds.has(a.id))
            .map((a: any) => ({
                id: a.id,
                first_name: a.first_name,
                last_name: a.last_name,
                email: a.email,
                profile_pic_url: a.profile_pic_url,
                ghl_user_id: a.ghl_user_id,
            }));

        return { success: true, advisors: result };
    } catch (error: any) {
        return { success: false, error: error.message ?? "Failed to list advisors" };
    }
}

export async function addClientFollower(
    clientId: string,
    followerAdvisorId: string
): Promise<{ success: boolean; ghlSynced?: boolean; error?: string; warning?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        const access = await assertCanManageFollowers(supabase, user.id, clientId);

        const { data: client } = await supabase
            .from("client_data_vault")
            .select("advisor_id, ghl_contact_id")
            .eq("id", clientId)
            .maybeSingle();

        if (!client) throw new Error("Client not found");
        if (client.advisor_id === followerAdvisorId) {
            throw new Error("The owning advisor is already assigned to this client");
        }

        const { data: follower, error: followerErr } = await supabase
            .from("advisors")
            .select("id, ghl_user_id, first_name, last_name")
            .eq("id", followerAdvisorId)
            .maybeSingle();

        if (followerErr || !follower) throw new Error("Selected advisor not found");

        const { error: insertError } = await supabase
            .from("client_followers")
            .insert({
                client_vault_id: clientId,
                advisor_id: followerAdvisorId,
                assigned_by: access.advisorId,
            });

        if (insertError) {
            if ((insertError as any).code === "23505") {
                throw new Error("Advisor is already a follower on this client");
            }
            throw insertError;
        }

        let ghlSynced = false;
        let warning: string | undefined;
        if (client.ghl_contact_id && follower.ghl_user_id) {
            try {
                await ghlAddContactFollowers(client.ghl_contact_id, [follower.ghl_user_id]);
                ghlSynced = true;
            } catch (ghlError: any) {
                console.error("GHL addFollower error (non-fatal):", ghlError);
                warning = `Follower saved, but GHL sync failed: ${ghlError?.message ?? "unknown error"}`;
            }
        } else if (!client.ghl_contact_id) {
            warning = "Follower saved. Client has no GHL contact id, so GHL was not updated.";
        } else if (!follower.ghl_user_id) {
            warning = `Follower saved. ${follower.first_name} ${follower.last_name} has no GHL user id, so GHL was not updated.`;
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        revalidatePath(`/advisor/dashboard/clients`);
        revalidatePath(`/advisor/dashboard/pipeline`);
        revalidatePath(`/advisor/dashboard`);

        return { success: true, ghlSynced, warning };
    } catch (error: any) {
        return { success: false, error: error.message ?? "Failed to add follower" };
    }
}

export async function removeClientFollower(
    clientId: string,
    followerAdvisorId: string
): Promise<{ success: boolean; ghlSynced?: boolean; error?: string; warning?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        await assertCanManageFollowers(supabase, user.id, clientId);

        const { data: client } = await supabase
            .from("client_data_vault")
            .select("ghl_contact_id")
            .eq("id", clientId)
            .maybeSingle();

        const { data: follower } = await supabase
            .from("advisors")
            .select("ghl_user_id")
            .eq("id", followerAdvisorId)
            .maybeSingle();

        const { error: deleteError } = await supabase
            .from("client_followers")
            .delete()
            .eq("client_vault_id", clientId)
            .eq("advisor_id", followerAdvisorId);

        if (deleteError) throw deleteError;

        let ghlSynced = false;
        let warning: string | undefined;
        if (client?.ghl_contact_id && follower?.ghl_user_id) {
            try {
                await ghlRemoveContactFollowers(client.ghl_contact_id, [follower.ghl_user_id]);
                ghlSynced = true;
            } catch (ghlError: any) {
                console.error("GHL removeFollower error (non-fatal):", ghlError);
                warning = `Follower removed, but GHL sync failed: ${ghlError?.message ?? "unknown error"}`;
            }
        }

        revalidatePath(`/advisor/dashboard/clients/${clientId}`);
        revalidatePath(`/advisor/dashboard/clients`);
        revalidatePath(`/advisor/dashboard/pipeline`);
        revalidatePath(`/advisor/dashboard`);

        return { success: true, ghlSynced, warning };
    } catch (error: any) {
        return { success: false, error: error.message ?? "Failed to remove follower" };
    }
}
