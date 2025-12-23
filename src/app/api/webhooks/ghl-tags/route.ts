import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/ghl-tags
 * 
 * Receives notifications from GHL when contact tags change.
 * Syncs dynamic document requirements based on 'requested_*' tags.
 * 
 * Payload example:
 * {
 *   "contactId": "ghl_contact_123",
 *   "tags": ["requested_invoice_copies", "requested_lease_agreement", "vault_submitted"]
 * }
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const payload = await request.json();

        // 1. Verify webhook secret (optional but recommended)
        const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
        if (webhookSecret && payload.secret !== webhookSecret) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { contactId, tags } = payload;

        if (!contactId || !Array.isArray(tags)) {
            return NextResponse.json(
                { error: "Invalid payload: contactId and tags array required" },
                { status: 400 }
            );
        }

        // 2. Find user by ghl_contact_id in client_data_vault table
        const { data: clientData, error: clientError } = await supabase
            .from("client_data_vault")
            .select("user_id")
            .eq("ghl_contact_id", contactId)
            .single();

        if (clientError || !clientData) {
            console.warn(`No user found for GHL contact ID: ${contactId}`);
            return NextResponse.json(
                { error: "User not found" },
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
            let { data: docData, error: docError } = await supabase
                .from("required_documents")
                .select("id")
                .eq("ghl_tag", tag)
                .eq("is_core", false) // Only dynamic documents
                .maybeSingle();

            // If document type doesn't exist, create it on the fly!
            if (!docData) {
                console.log(`Creating new document type for tag: ${tag}`);

                // Extract code from tag (requested_invoice_copies -> invoice_copies)
                const code = tag.replace("requested_", "");

                // Generate a pretty label (invoice_copies -> Invoice Copies)
                const label = code
                    .split("_")
                    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" ");

                const { data: newDoc, error: createError } = await supabase
                    .from("required_documents")
                    .insert({
                        code: code,
                        label: label,
                        ghl_tag: tag,
                        is_core: false,
                        is_multiple: true, // Default to multiple for safety
                        min_files: 1,
                        max_files: 10,
                    })
                    .select("id")
                    .single();

                if (createError) {
                    console.error(`Error creating new document type for ${tag}:`, createError.message);
                    continue;
                }
                docData = newDoc;
            }

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
