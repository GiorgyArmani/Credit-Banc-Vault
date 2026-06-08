import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_SCOPED_DOC_CODES, normalizeSupabaseJoin, formatRequirementLabel } from "@/lib/document-scope";

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/requirements
 * 
 * Returns core 9 documents + any dynamic documents requested via GHL tags
 * for the authenticated user
 */
export async function GET(req: Request) {
    try {
        const supabase = await createClient();

        // 1. Get authenticated user
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Optional ?business_profile_id query param scopes the requirements to
        // a specific business (used when the client has more than one business).
        // When absent, returns every active request for this user — same as
        // the legacy single-business behavior.
        const { searchParams } = new URL(req.url);
        const businessProfileId = searchParams.get("business_profile_id");

        // 2. Pull every active dynamic doc request for this user. We filter in
        //    JS (rather than a strict business_profile_id .eq filter) so that
        //    CLIENT_SCOPED docs (driver's license, MyScoreIQ, PFS) surface on
        //    every business tab — they describe the person, not a business.
        const { data: dynamicDocsData, error: dynamicError } = await supabase
            .from("client_dynamic_documents")
            .select(`
                business_profile_id,
                statement_months,
                required_documents!inner (
                    id,
                    code,
                    label,
                    description,
                    is_multiple,
                    min_files,
                    max_files,
                    ghl_tag,
                    is_core
                )
            `)
            .eq("user_id", user.id)
            .eq("is_active", true);

        if (dynamicError) {
            console.error(`❌ Error querying dynamic documents:`, dynamicError);
            throw dynamicError;
        }

        // 3. Scope rows to the active business tab. A row is in-scope when:
        //   • no business filter was passed (legacy single-business call), OR
        //   • the row is pinned to the active business, OR
        //   • the row's doc code is client-scoped (shared across businesses).
        // normalizeSupabaseJoin handles SDK array-vs-object embed variance.
        const scopedRows = (dynamicDocsData || []).filter((item: any) => {
            const doc = normalizeSupabaseJoin(item?.required_documents);
            const code = doc?.code;
            if (!businessProfileId) return true;
            if (item.business_profile_id === businessProfileId) return true;
            return CLIENT_SCOPED_DOC_CODES.includes(code);
        });

        // De-dupe by code: a client-scoped doc might appear under multiple
        // businesses (one row per business at signup); the client only needs
        // to see one card per code on a given tab.
        const seenCodes = new Set<string>();
        const dynamicDocs: any[] = [];
        for (const item of scopedRows as any[]) {
            const doc = normalizeSupabaseJoin(item.required_documents);
            if (!doc) continue;
            if (seenCodes.has(doc.code)) continue;
            seenCodes.add(doc.code);
            // Carry the per-request bank-statement period through so the label
            // can reflect the precise number of months the advisor asked for.
            dynamicDocs.push({ ...doc, statement_months: item.statement_months ?? null });
        }

        const allRequirements = dynamicDocs
            .filter((doc: any) => doc.code !== 'funding_application') // Filter out auto-uploaded app
            .map((doc: any) => ({
                code: doc.code,
                label: formatRequirementLabel(doc.code, doc.label, doc.statement_months),
                description: doc.description,
                multiple: doc.is_multiple,
                minFiles: doc.min_files,
                maxFiles: doc.max_files,
                ghlTag: doc.ghl_tag,
                isCore: doc.is_core,
                isClientScoped: CLIENT_SCOPED_DOC_CODES.includes(doc.code),
            }));

        return NextResponse.json(
            {
                requirements: allRequirements,
                count: allRequirements.length,
            },
            {
                headers: {
                    'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
                },
            }
        );
    } catch (error: any) {
        console.error("Error fetching vault requirements:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
