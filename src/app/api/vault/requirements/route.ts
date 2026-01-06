import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/requirements
 * 
 * Returns core 9 documents + any dynamic documents requested via GHL tags
 * for the authenticated user
 */
export async function GET() {
    try {
        const supabase = await createClient();

        // 1. Get authenticated user
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. Optimized single query: Get all documents (core + user's dynamic) in one call
        // This reduces database round trips from 2 to 1
        const [coreDocsResult, dynamicDocsResult] = await Promise.all([
            // Core documents query
            supabase
                .from("required_documents")
                .select("id, code, label, description, is_multiple, min_files, max_files, ghl_tag, is_core")
                .eq("is_core", true)
                .order("code"),

            // Dynamic documents query
            supabase
                .from("client_dynamic_documents")
                .select(`
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
                .eq("is_active", true)
        ]);

        const { data: coreDocsData, error: coreError } = coreDocsResult;
        const { data: dynamicDocsData, error: dynamicError } = dynamicDocsResult;

        if (coreError) {
            console.error(`❌ Error querying core documents:`, coreError);
            throw coreError;
        }

        if (dynamicError) {
            console.error(`❌ Error querying dynamic documents:`, dynamicError);
            throw dynamicError;
        }

        // 3. Merge and format response
        const coreDocs = coreDocsData || [];
        const dynamicDocs = (dynamicDocsData || [])
            .map((item: any) => item.required_documents)
            .filter(Boolean);

        const allRequirements = [...coreDocs, ...dynamicDocs].map((doc) => ({
            code: doc.code,
            label: doc.label,
            description: doc.description,
            multiple: doc.is_multiple,
            minFiles: doc.min_files,
            maxFiles: doc.max_files,
            ghlTag: doc.ghl_tag,
            isCore: doc.is_core,
        }));

        return NextResponse.json(
            {
                requirements: allRequirements,
                coreCount: coreDocs.length,
                dynamicCount: dynamicDocs.length,
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
