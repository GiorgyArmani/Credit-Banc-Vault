import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncOutstandingDocuments, calculateOutstandingDocuments } from "@/lib/outstanding-documents";

export const dynamic = 'force-dynamic';

/**
 * GET /api/test-outstanding
 * 
 * Test endpoint to manually trigger outstanding documents sync
 */
export async function GET() {
    try {
        const supabase = await createClient();

        // Get authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        console.log(`🧪 Testing outstanding documents for user: ${user.id}`);

        // 1. Calculate outstanding documents
        const outstanding = await calculateOutstandingDocuments(user.id);
        console.log(`📋 Outstanding documents calculated:`, outstanding);

        // 2. Get GHL contact ID
        const { data: vaultData, error: vaultError } = await supabase
            .from("client_data_vault")
            .select("ghl_contact_id, outstanding_documents")
            .eq("user_id", user.id)
            .single();

        if (vaultError) {
            console.error("❌ Error fetching vault data:", vaultError);
            return NextResponse.json({
                error: "Vault data not found",
                details: vaultError.message
            }, { status: 404 });
        }

        console.log(`📊 Current DB value:`, vaultData.outstanding_documents);
        console.log(`🔗 GHL Contact ID:`, vaultData.ghl_contact_id);

        if (!vaultData.ghl_contact_id) {
            return NextResponse.json({
                error: "No GHL contact ID found",
                calculated: outstanding,
                currentDbValue: vaultData.outstanding_documents
            }, { status: 400 });
        }

        if (!process.env.GHL_TOKEN) {
            return NextResponse.json({
                error: "GHL_TOKEN not configured",
                calculated: outstanding,
                currentDbValue: vaultData.outstanding_documents
            }, { status: 500 });
        }

        // 3. Sync to both DB and GHL
        const syncResult = await syncOutstandingDocuments(
            user.id,
            vaultData.ghl_contact_id,
            process.env.GHL_TOKEN
        );

        if (!syncResult.success) {
            return NextResponse.json({
                error: "Sync failed",
                details: syncResult.error,
                calculated: outstanding,
                currentDbValue: vaultData.outstanding_documents
            }, { status: 500 });
        }

        // 4. Verify the update
        const { data: updatedVault } = await supabase
            .from("client_data_vault")
            .select("outstanding_documents")
            .eq("user_id", user.id)
            .single();

        return NextResponse.json({
            success: true,
            calculated: outstanding,
            previousDbValue: vaultData.outstanding_documents,
            newDbValue: updatedVault?.outstanding_documents,
            ghlContactId: vaultData.ghl_contact_id,
            message: "Sync completed successfully"
        });

    } catch (error: any) {
        console.error("❌ Test endpoint error:", error);
        return NextResponse.json({
            error: error.message || "Internal Server Error",
            stack: error.stack
        }, { status: 500 });
    }
}
