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

        // 2. Query required_documents WHERE is_core = true (the 9 core docs)
        const { data: coreDocsData, error: coreError } = await supabase
            .from("required_documents")
            .select("*")
            .eq("is_core", true)
            .order("code");

        console.log(`🔍 Core documents query for user ${user.id}:`, {
            found: coreDocsData?.length || 0,
            error: coreError?.message,
            data: coreDocsData?.map(d => ({ code: d.code, label: d.label, is_core: d.is_core }))
        });

        if (coreError) {
            console.error(`❌ Error querying core documents:`, coreError);
            throw coreError;
        }

        // 3. Query client_dynamic_documents joined with required_documents
        const { data: dynamicDocsData, error: dynamicError } = await supabase
            .from("client_dynamic_documents")
            .select(`
                id,
                requested_at,
                required_documents (
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

        console.log(`🔍 Dynamic documents query for user ${user.id}:`, {
            found: dynamicDocsData?.length || 0,
            error: dynamicError?.message,
            rawData: dynamicDocsData
        });

        if (dynamicError) {
            console.error(`❌ Error querying dynamic documents:`, dynamicError);
            throw dynamicError;
        }

        // 4. Merge both lists
        const coreDocs = coreDocsData || [];
        const dynamicDocs = (dynamicDocsData || [])
            .map((item: any) => item.required_documents)
            .filter(Boolean);

        // 5. Format response
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

        console.log(`📋 Vault requirements for user ${user.id}:`, {
            coreCount: coreDocs.length,
            dynamicCount: dynamicDocs.length,
            dynamicDocs: dynamicDocs.map(d => ({ code: d.code, label: d.label, ghlTag: d.ghl_tag })),
            totalRequirements: allRequirements.length
        });

        return NextResponse.json({
            requirements: allRequirements,
            coreCount: coreDocs.length,
            dynamicCount: dynamicDocs.length,
        });
    } catch (error: any) {
        console.error("Error fetching vault requirements:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
