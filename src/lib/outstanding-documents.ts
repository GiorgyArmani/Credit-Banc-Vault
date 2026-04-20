
import { createAdminClient } from "@/lib/supabase/admin";

// Map for GHL Custom Field ID
const GHL_CF_OUTSTANDING_DOCUMENTS = process.env.GHL_CF_OUTSTANDING_DOCUMENTS;

export async function calculateOutstandingDocuments(userId: string): Promise<string[]> {
    const supabase = createAdminClient();

    // 1. Fetch Core Requirements
    const { data: coreDocs, error: coreError } = await supabase
        .from("required_documents")
        .select("code, label")
        .eq("is_core", true);

    if (coreError) throw new Error(`Error fetching core documents: ${coreError.message}`);

    // 2. Fetch Active Dynamic Requirements for user
    const { data: dynamicDocs, error: dynamicError } = await supabase
        .from("client_dynamic_documents")
        .select(`
            required_documents (
                code,
                label
            )
        `)
        .eq("user_id", userId)
        .eq("is_active", true);

    if (dynamicError) throw new Error(`Error fetching dynamic documents: ${dynamicError.message}`);

    // 3. Fetch Uploaded Documents for user
    const { data: uploadedDocs, error: uploadError } = await supabase
        .from("user_documents")
        .select("category, doc_code")
        .eq("user_id", userId);

    if (uploadError) throw new Error(`Error fetching user documents: ${uploadError.message}`);

    // 4. Combine all requirements
    const allRequirements = [
        ...(coreDocs || []),
        ...(dynamicDocs?.map((d: any) => d.required_documents).filter(Boolean) || [])
    ];

    // Use a Map to ensure uniqueness by code
    const uniqueRequirements = new Map<string, string>();
    allRequirements.forEach(req => {
        uniqueRequirements.set(req.code, req.label);
    });

    // 5. Filter out uploaded ones
    // Check both category and doc_code for compatibility
    const uploadedCodes = new Set([
        ...(uploadedDocs?.map((d) => d.category).filter(Boolean) || []),
        ...(uploadedDocs?.map((d) => d.doc_code).filter(Boolean) || [])
    ]);

    const missingLabels: string[] = [];
    uniqueRequirements.forEach((label, code) => {
        if (!uploadedCodes.has(code)) {
            missingLabels.push(label);
        }
    });

    return missingLabels;
}

export async function syncOutstandingDocuments(
    userId: string,
    ghlContactId: string,
    ghlToken: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const missingDocs = await calculateOutstandingDocuments(userId);

        // Format the list for GHL
        const value = missingDocs.length > 0
            ? missingDocs.join(", ")
            : "All documents submitted";

        console.log(`Syncing outstanding docs for user ${userId} to GHL:`, missingDocs);

        // Update GHL Contact
        const response = await fetch(
            `https://services.leadconnectorhq.com/contacts/${ghlContactId}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${ghlToken}`,
                    Version: "2021-07-28",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customFields: [
                        {
                            id: GHL_CF_OUTSTANDING_DOCUMENTS,
                            value: value,
                        },
                    ],
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GHL update failed: ${response.status} - ${errorText}`);
        }

        return { success: true };

    } catch (error: any) {
        console.error("syncOutstandingDocuments error:", error);
        return { success: false, error: error.message };
    }
}

