"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function fetchNotifications() {
    const supabase = await createClient();

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const { data, error } = await supabase
            .from("in_app_notifications")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        return { success: true, notifications: data };
    } catch (error: any) {
        console.error("❌ Error fetching notifications:", error);
        return { success: false, error: error.message };
    }
}

export async function markNotificationAsRead(notification_id: string) {
    const supabase = await createClient();

    try {
        const { error } = await supabase
            .from("in_app_notifications")
            .update({ is_read: true })
            .eq("id", notification_id);

        if (error) throw error;

        revalidatePath("/");
        return { success: true };
    } catch (error: any) {
        console.error("❌ Error marking notification as read:", error);
        return { success: false, error: error.message };
    }
}

export async function markAllNotificationsAsRead() {
    const supabase = await createClient();

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const { error } = await supabase
            .from("in_app_notifications")
            .update({ is_read: true })
            .eq("user_id", user.id)
            .eq("is_read", false);

        if (error) throw error;

        revalidatePath("/");
        return { success: true };
    } catch (error: any) {
        console.error("❌ Error marking all notifications as read:", error);
        return { success: false, error: error.message };
    }
}
