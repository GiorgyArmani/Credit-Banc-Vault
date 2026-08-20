import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncOutstandingDocuments } from "@/lib/outstanding-documents";
import { isClientScopedDoc } from "@/lib/document-scope";

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
        if (!webhookSecret) {
            console.error("❌ Webhook Configuration Error: GHL_WEBHOOK_SECRET is not defined");
            return NextResponse.json(
                { error: "Configuration Error" },
                { status: 500 }
            );
        }

        if (!secretsMatch(secret, webhookSecret)) {
            console.error("❌ Webhook Unauthorized: Secret mismatch", {
                received: secret ? "PRESENT" : "MISSING"
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

        // Normalize tags to lowercase for consistent matching
        tags = tags.map(t => t.toLowerCase());

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
            .select("id, user_id")
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

        // GHL tags don't carry a business — the vault is the translation
        // layer. Fetch every business under this contact so we can fan out
        // business-scoped doc requests (one row per business) and anchor
        // client-scoped requests (DL/MyScoreIQ/PFS) on the primary business.
        // The unique index on client_dynamic_documents is
        // (business_profile_id, document_id), so the upsert's onConflict has
        // to match that target — not the legacy (user_id, document_id) shape.
        const { data: businessRows } = await supabase
            .from("business_profiles")
            .select("id, is_primary")
            .eq("client_vault_id", clientData.id);
        const businesses = (businessRows ?? []) as Array<{ id: string; is_primary: boolean | null }>;
        const primaryBusinessId =
            businesses.find(b => b.is_primary)?.id ?? businesses[0]?.id ?? null;
        if (!primaryBusinessId) {
            console.warn(`⚠️ GHL tag sync: no business for user ${userId} — dynamic doc requests skipped`);
            return NextResponse.json(
                { error: "No business found — cannot scope doc requests" },
                { status: 409 }
            );
        }

        // 3. Filter tags to only 'requested_*' tags
        const requestedTags = tags.filter((tag: string) =>
            tag.startsWith("requested_")
        );

        console.log(`Processing ${requestedTags.length} requested tags for user ${userId}`);
        console.log(`📋 All incoming tags:`, tags);
        console.log(`📋 Filtered requested_ tags:`, requestedTags);

        // 4. For each requested tag, look up document and insert into client_dynamic_documents
        const documentIds: string[] = [];

        for (const tag of requestedTags) {
            // Look up document in required_documents by ghl_tag
            const { data: docData, error: docError } = await supabase
                .from("required_documents")
                .select("id, code, label, ghl_tag")
                .eq("ghl_tag", tag)
                .eq("is_core", false) // Only dynamic documents
                .maybeSingle();

            console.log(`🔍 Tag lookup: "${tag}"`, {
                found: !!docData,
                docData: docData ? { id: docData.id, code: docData.code, label: docData.label } : null,
                error: docError?.message
            });

            // Only process if document type exists in our database
            if (docData) {
                documentIds.push(docData.id);

                // Fan-out target list:
                //   • client-scoped codes (DL/MyScoreIQ/PFS) → one row anchored
                //     on the primary business. Read paths ignore business_profile_id
                //     for these codes (see document-scope.ts).
                //   • business-scoped codes → one row per business on this contact,
                //     so every business tab shows the request and uploads can
                //     satisfy their own business's row.
                const targetBusinessIds = isClientScopedDoc(docData.code)
                    ? [primaryBusinessId]
                    : businesses.map(b => b.id);

                for (const businessId of targetBusinessIds) {
                    const { error: insertError } = await supabase
                        .from("client_dynamic_documents")
                        .upsert(
                            {
                                user_id: userId,
                                document_id: docData.id,
                                business_profile_id: businessId,
                                requested_via: "ghl_webhook",
                                is_active: true,
                            },
                            {
                                onConflict: "business_profile_id,document_id",
                                ignoreDuplicates: false,
                            }
                        );

                    if (insertError) {
                        console.error(
                            `❌ Error inserting dynamic document for tag "${tag}" / business "${businessId}":`,
                            insertError.message
                        );
                    }
                }
                console.log(
                    `✅ Upserted ${targetBusinessIds.length} dynamic-doc row(s) for tag "${tag}" (${docData.code})`
                );
            } else {
                console.warn(`⚠️ Tag ignored: "${tag}" does not exist in required_documents table or is not a dynamic document (is_core=false).`);
            }
        }

        // 5. Deactivate any client_dynamic_documents not in current tag list
        // This handles tag removal in GHL
        if (documentIds.length > 0) {
            const { error: deactivateError } = await supabase
                .from("client_dynamic_documents")
                .update({ is_active: false })
                .eq("user_id", userId)
                .not("document_id", "in", documentIds)
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

        // 6. Sync outstanding documents to GHL and Supabase
        // This ensures the outstanding documents list is updated when tags change
        console.log(`🔄 Syncing outstanding documents after tag change for user ${userId}...`);

        if (process.env.GHL_TOKEN) {
            const syncResult = await syncOutstandingDocuments(
                userId,
                contactId,
                process.env.GHL_TOKEN
            );

            if (syncResult.success) {
                console.log(`✅ Outstanding documents synced successfully`);
            } else {
                console.error(`⚠️ Failed to sync outstanding documents:`, syncResult.error);
            }
        } else {
            console.warn(`⚠️ GHL_TOKEN not configured, skipping outstanding documents sync`);
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
