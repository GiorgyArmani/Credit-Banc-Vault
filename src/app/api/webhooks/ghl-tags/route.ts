import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/ghl-tags
 * 
 * Receives notifications from GHL when contact tags change.
 * Syncs dynamic document requirements based on 'requested_*' tags.
 */
export async function POST(request: Request) {
    try {
        const supabase = createAdminClient();

        // Handle different content types (GHL can send JSON or Form-UrlEncoded)
        const contentType = request.headers.get("content-type") || "";
        let payload: any;

        if (contentType.includes("application/json")) {
            payload = await request.json();
        } else {
            // Assume form-urlencoded or similar
            const text = await request.text();
            try {
                // Try JSON first just in case
                payload = JSON.parse(text);
            } catch {
                // Fallback to URL search params parsing
                const params = new URLSearchParams(text);
                payload = Object.fromEntries(params.entries());
            }
        }

        let { contactId, tags: rawTags, secret } = payload;

        // 1. Sanitize contactId (Zapier/GHL sometimes wrap in quotes or add whitespace)
        if (typeof contactId === "string") {
            contactId = contactId.trim().replace(/^["']|["']$/g, "");
        }

        console.log(`🔍 Webhook search: contactId="${contactId}"`);

        // 2. Verify webhook secret
        const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
        if (webhookSecret && secret !== webhookSecret) {
            console.error("❌ Webhook Unauthorized: Secret mismatch", {
                received: secret ? "PRESENT" : "MISSING",
                expected: "CONFIGURED"
            });
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        // 3. Normalize tags (GHL can send them as string or array)
        let tags: string[] = [];
        if (Array.isArray(rawTags)) {
            tags = rawTags;
        } else if (typeof rawTags === "string") {
            tags = rawTags.split(",").map(t => t.trim());
        }

        if (!contactId || tags.length === 0) {
            console.error("❌ Invalid Webhook Payload:", { contactId, tagsCount: tags.length });
            return NextResponse.json(
                { error: "Invalid payload: contactId and tags required" },
                { status: 400 }
            );
        }

        // 4. Find user by ghl_contact_id in client_data_vault table
        const { data: clientData, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id")
            .eq("ghl_contact_id", contactId)
            .single();

        if (clientError || !clientData) {
            console.warn(`⚠️ No user found for GHL contact ID: "${contactId}"`);
            return NextResponse.json(
                { error: `User not found for ID: ${contactId}` },
                { status: 404 }
            );
        }

        const userId = clientData.user_id;

        // 3. Filter tags to only 'requested_*' tags
        const requestedTags = tags.filter((tag: string) =>
            tag.startsWith("requested_")
        );

        console.log(`Processing ${requestedTags.length} requested tags for user ${userId}`);

        // 4. For each requested tag, look up document and insert into client_dynamic_documents
        const documentIds: string[] = [];

        for (const tag of requestedTags) {
            // Look up document in required_documents by ghl_tag
            const { data: docData, error: docError } = await supabase
                .from("required_documents")
                .select("id")
                .eq("ghl_tag", tag)
                .eq("is_core", false) // Only dynamic documents
                .maybeSingle();

            // Only process if document type exists in our database
            if (docData) {
                documentIds.push(docData.id);

                // Insert into client_dynamic_documents (upsert to avoid duplicates)
                const { error: insertError } = await supabase
                    .from("client_dynamic_documents")
                    .upsert(
                        {
                            user_id: userId,
                            document_id: docData.id,
                            requested_via: "ghl_webhook",
                            is_active: true,
                        },
                        {
                            onConflict: "user_id,document_id",
                            ignoreDuplicates: false,
                        }
                    );

                if (insertError) {
                    console.error(`Error inserting dynamic document: ${insertError.message}`);
                }
            } else {
                console.warn(`Tag ignored: ${tag} does not exist in required_documents table.`);
            }
        }

        // 5. Deactivate any client_dynamic_documents not in current tag list
        // This handles tag removal in GHL
        if (documentIds.length > 0) {
            const { error: deactivateError } = await supabase
                .from("client_dynamic_documents")
                .update({ is_active: false })
                .eq("user_id", userId)
                .not("document_id", "in", `(${documentIds.join(",")})`)
                .eq("is_active", true);

            if (deactivateError) {
                console.error(`Error deactivating documents: ${deactivateError.message}`);
            }
        } else {
            // No requested tags, deactivate all
            await supabase
                .from("client_dynamic_documents")
                .update({ is_active: false })
                .eq("user_id", userId)
                .eq("is_active", true);
        }

        return NextResponse.json({
            success: true,
            processedTags: requestedTags.length,
            userId,
        });
    } catch (error: any) {
        console.error("Error processing GHL webhook:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/webhooks/ghl-tags
 * 
 * Health check endpoint
 */
export async function GET() {
    return NextResponse.json({
        status: "ok",
        endpoint: "/api/webhooks/ghl-tags",
        description: "Webhook receiver for GHL tag changes",
        expectedPayload: {
            contactId: "string (GHL contact ID)",
            tags: "array of strings",
            secret: "string (optional webhook secret)",
        },
    });
}
