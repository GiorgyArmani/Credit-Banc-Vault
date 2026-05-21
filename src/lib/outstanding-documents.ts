
import { createAdminClient } from "@/lib/supabase/admin";
import { isClientScopedDoc } from "@/lib/document-scope";

// Map for GHL Custom Field ID
const GHL_CF_OUTSTANDING_DOCUMENTS = process.env.GHL_CF_OUTSTANDING_DOCUMENTS;

export interface BusinessMissingDocs {
    /** business_profiles.id; null for client-scoped docs not pinned to a business. */
    business_profile_id: string | null;
    /** Human-readable business name (or "Personal Documents" for the client-scoped bucket). */
    business_name: string;
    is_primary: boolean;
    missing_docs: string[];
}

export interface OutstandingDocsBreakdown {
    /** Grouped list — one entry per business, plus an optional "Personal Documents"
     *  bucket for client-scoped codes (driver's license, MyScoreIQ, PFS) when the
     *  client has more than one business. Empty entries are filtered out. */
    groups: BusinessMissingDocs[];
    /** Flat de-duped list across every group. Drives backward-compat callers
     *  (GHL sync, single-business email) without re-walking the structure. */
    flat: string[];
}

/**
 * Compute outstanding documents grouped by business. Multi-business clients
 * see per-business sections in the reminder email; single-business clients
 * see exactly the same flat list they used to.
 *
 * Scoping rules:
 *   • Business-scoped doc requests (per business_profile_id on
 *     client_dynamic_documents) check uploads against the SAME business.
 *     A doc requested for Acme LLC is only "satisfied" by an upload pinned
 *     to Acme LLC.
 *   • Client-scoped codes (DL / MyScoreIQ / PFS — see CLIENT_SCOPED_DOC_CODES)
 *     belong to the human, not a business. They surface in a dedicated
 *     "Personal Documents" bucket when the client has 2+ businesses, and
 *     are considered satisfied by ANY upload of that code (any business).
 *     Single-business clients see them inline with the business section so
 *     the email looks identical to today.
 */
export async function calculateOutstandingDocumentsByBusiness(userId: string): Promise<OutstandingDocsBreakdown> {
    const supabase = createAdminClient();

    // 1. Resolve the client and every business they own.
    const { data: vault } = await supabase
        .from("client_data_vault")
        .select("id, company_name")
        .eq("user_id", userId)
        .maybeSingle();
    if (!vault) {
        return { groups: [], flat: [] };
    }

    const { data: businesses } = await supabase
        .from("business_profiles")
        .select("id, company_name, is_primary, display_order, created_at")
        .eq("client_vault_id", vault.id)
        .order("is_primary", { ascending: false })
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });

    const businessRows = (businesses ?? []) as Array<{ id: string; company_name: string | null; is_primary: boolean }>;
    const primaryId = businessRows.find(b => b.is_primary)?.id ?? businessRows[0]?.id ?? null;
    const isMultiBusiness = businessRows.length > 1;

    // 2. Fetch every active doc request for this user. business_profile_id is
    //    carried through so we can bucket per business.
    const { data: dynamicDocs, error: dynamicError } = await supabase
        .from("client_dynamic_documents")
        .select(`
            business_profile_id,
            required_documents ( code, label )
        `)
        .eq("user_id", userId)
        .eq("is_active", true);

    if (dynamicError) throw new Error(`Error fetching dynamic documents: ${dynamicError.message}`);

    // 3. Fetch every uploaded doc for this user, with its business binding and
    //    code. Skips rejected uploads — the reminder should still chase a fix.
    const { data: uploadedDocs, error: uploadError } = await supabase
        .from("user_documents")
        .select("category, doc_code, status, business_profile_id")
        .eq("user_id", userId);

    if (uploadError) throw new Error(`Error fetching user documents: ${uploadError.message}`);

    const validUploads = (uploadedDocs ?? []).filter(d => d.status !== "rejected");
    const codeOf = (d: any): string | null => (d.doc_code || d.category || null);

    // For client-scoped codes, an upload anywhere satisfies the requirement.
    const clientScopedSatisfied = new Set<string>(
        validUploads
            .map(d => codeOf(d))
            .filter((c): c is string => !!c && isClientScopedDoc(c))
    );

    // For business-scoped codes, an upload only satisfies the SAME business.
    // Map: business_profile_id -> Set<doc_code>.
    const perBusinessSatisfied = new Map<string, Set<string>>();
    validUploads.forEach(d => {
        const bid = (d as any).business_profile_id ?? null;
        if (!bid) return;
        const code = codeOf(d);
        if (!code) return;
        if (!perBusinessSatisfied.has(bid)) perBusinessSatisfied.set(bid, new Set());
        perBusinessSatisfied.get(bid)!.add(code);
    });

    // 4. Bucket requested docs into (clientScopedRequested, perBusinessRequested).
    interface DocRef { code: string; label: string }
    const clientScopedRequested = new Map<string, string>(); // code -> label
    const perBusinessRequested = new Map<string, Map<string, string>>(); // bid -> (code -> label)

    (dynamicDocs ?? []).forEach((row: any) => {
        const def = Array.isArray(row.required_documents) ? row.required_documents[0] : row.required_documents;
        if (!def?.code) return;
        const bid: string | null = row.business_profile_id ?? null;
        if (isClientScopedDoc(def.code)) {
            // Always bucket as client-scoped, regardless of which business the
            // request row was tied to. De-duped by code below.
            clientScopedRequested.set(def.code, def.label);
            return;
        }
        // Default unbound rows to the primary business so legacy single-
        // business data doesn't fall through the cracks.
        const effectiveBid = bid ?? primaryId;
        if (!effectiveBid) return; // no business resolvable — drop.
        if (!perBusinessRequested.has(effectiveBid)) perBusinessRequested.set(effectiveBid, new Map());
        perBusinessRequested.get(effectiveBid)!.set(def.code, def.label);
    });

    // 5. Build groups.
    const groups: BusinessMissingDocs[] = [];
    const flat: string[] = [];
    const flatSeen = new Set<string>();

    // 5a. Client-scoped bucket. Show as its own "Personal Documents" group
    //     when there are 2+ businesses; otherwise inline into the (sole) business.
    const personalMissing: { code: string; label: string }[] = [];
    clientScopedRequested.forEach((label, code) => {
        if (!clientScopedSatisfied.has(code)) personalMissing.push({ code, label });
    });

    if (isMultiBusiness && personalMissing.length > 0) {
        groups.push({
            business_profile_id: null,
            business_name: "Personal Documents",
            is_primary: false,
            missing_docs: personalMissing.map(m => m.label),
        });
        personalMissing.forEach(m => {
            if (!flatSeen.has(m.label)) { flatSeen.add(m.label); flat.push(m.label); }
        });
    }

    // 5b. Per-business buckets.
    for (const biz of businessRows) {
        const requested = perBusinessRequested.get(biz.id) ?? new Map<string, string>();
        const satisfied = perBusinessSatisfied.get(biz.id) ?? new Set<string>();
        const missingForBiz: string[] = [];
        requested.forEach((label, code) => {
            if (!satisfied.has(code)) missingForBiz.push(label);
        });

        // Single-business client → fold the personal-doc misses into this
        // group so the email looks identical to the pre-multi-business UX.
        if (!isMultiBusiness && personalMissing.length > 0) {
            personalMissing.forEach(m => {
                if (!missingForBiz.includes(m.label)) missingForBiz.push(m.label);
            });
        }

        if (missingForBiz.length === 0) continue;
        groups.push({
            business_profile_id: biz.id,
            business_name: biz.company_name || vault.company_name || "Business",
            is_primary: !!biz.is_primary,
            missing_docs: missingForBiz,
        });
        missingForBiz.forEach(label => {
            if (!flatSeen.has(label)) { flatSeen.add(label); flat.push(label); }
        });
    }

    return { groups, flat };
}

/** Legacy flat-list API. Kept for callers that don't need per-business
 *  grouping (GHL custom-field sync, debug pages). Delegates to the grouped
 *  calc and returns the de-duped flat list. */
export async function calculateOutstandingDocuments(userId: string): Promise<string[]> {
    const { flat } = await calculateOutstandingDocumentsByBusiness(userId);
    return flat;
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

