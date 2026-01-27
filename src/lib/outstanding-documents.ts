
import { createClient } from "@/lib/supabase/server";

export const REQUIRED_DOCUMENTS = [
    { code: "business_bank_statements", label: "Business Bank Statements (Last 6 Months)" },
    { code: "drivers_license_front", label: "Driver's License (Front)" },
    { code: "drivers_license_back", label: "Driver's License (Back)" },
    { code: "voided_check", label: "Voided Business Check" },
    { code: "tax_returns", label: "Tax Returns (Last Year)" },
];

// Map for GHL Custom Field ID
const GHL_CF_OUTSTANDING_DOCUMENTS = process.env.GHL_CF_OUTSTANDING_DOCUMENTS || "YydQFzZd5IJO0NCbsz9D";

export async function calculateOutstandingDocuments(userId: string): Promise<string[]> {
    const supabase = await createClient();

    // 1. Fetch uploaded documents for the user
    const { data: uploadedDocs, error } = await supabase
        .from("user_documents")
        .select("doc_code")
        .eq("user_id", userId);

    if (error) throw new Error(`Error fetching user documents: ${error.message}`);

    const uploadedCodes = new Set(uploadedDocs?.map((d) => d.doc_code) || []);

    // 2. Identify missing documents
    const missingDocs = REQUIRED_DOCUMENTS.filter(
        (req) => !uploadedCodes.has(req.code)
    ).map((req) => req.label);

    return missingDocs;
}

export async function syncOutstandingDocuments(
    userId: string,
    ghlContactId: string,
    ghlToken: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const missingDocs = await calculateOutstandingDocuments(userId);
        const outstandingListText = missingDocs.join("\n");

        console.log(`Checking outstanding docs for ${userId}:`, missingDocs);

        // 3. Update GHL Custom Field
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
                            value: outstandingListText,
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
