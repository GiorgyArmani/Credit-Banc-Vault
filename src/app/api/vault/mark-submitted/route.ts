import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ghlAddTags } from "@/lib/ghl-api";

export const dynamic = 'force-dynamic';

/**
 * POST /api/vault/mark-submitted
 * 
 * Marks a document as submitted by adding the corresponding 'submitted_*' tag to GHL.
 * Called when a client uploads a dynamic document.
 * 
 * Body: { doc_code: string }
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { doc_code } = await request.json();

        if (!doc_code) {
            return NextResponse.json(
                { error: "doc_code is required" },
                { status: 400 }
            );
        }

        // 1. Get authenticated user
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. Get client's GHL contact ID
        const { data: clientData, error: fetchError } = await supabase
            .from("client_data_vault")
            .select("ghl_contact_id")
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
            // Don't error - just log and return success
            // This allows vault to work even if GHL integration isn't set up
            return NextResponse.json({
                success: true,
                warning: "No GHL contact ID found",
            });
        }

        // 3. Look up the document to get its GHL tag
        const { data: docData, error: docError } = await supabase
            .from("required_documents")
            .select("ghl_tag, is_core")
            .eq("code", doc_code)
            .single();

        if (docError || !docData) {
            console.error("Document not found:", doc_code);
            return NextResponse.json(
                { error: "Document not found" },
                { status: 404 }
            );
        }

        // 4. Only add submitted tag for dynamic documents (not core)
        if (docData.is_core) {
            // Core documents don't get submitted tags
            return NextResponse.json({
                success: true,
                message: "Core document - no tag added",
            });
        }

        if (!docData.ghl_tag) {
            console.warn("Document has no GHL tag:", doc_code);
            return NextResponse.json({
                success: true,
                warning: "Document has no GHL tag",
            });
        }

        // 5. Convert requested_* tag to submitted_* tag
        const submittedTag = docData.ghl_tag.replace("requested_", "submitted_");

        // 6. Add tag to GHL
        await ghlAddTags(clientData.ghl_contact_id, [submittedTag]);

        return NextResponse.json({
            success: true,
            tagAdded: submittedTag,
        });
    } catch (error: any) {
        console.error("Error marking document as submitted:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
