import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/advisor/clients
 * Fetches all clients for the authenticated advisor
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();

        // Get the authenticated user
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Verify user is an advisor
        const { data: userData, error: userError } = await supabase
            .from("users")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();

        if (userError || userData?.role !== "advisor") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Fetch clients for this advisor
        const { data: clients, error: clientsError } = await supabase
            .from("clients")
            .select("*")
            .eq("advisor_id", user.id)
            .order("created_at", { ascending: false });

        if (clientsError) {
            console.error("Error fetching clients:", clientsError);
            return NextResponse.json(
                { error: "Failed to fetch clients" },
                { status: 500 }
            );
        }

        return NextResponse.json({ clients: clients || [] }, { status: 200 });
    } catch (error) {
        console.error("Unexpected error in GET /api/advisor/clients:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
