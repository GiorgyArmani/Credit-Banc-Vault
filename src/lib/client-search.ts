/**
 * Client search across EVERY business on the client, not just the vault row's
 * company_name (which only ever holds the primary business). Without this a
 * multi-business client could not be found by its second business's name.
 */

export interface ClientSearchRow {
    id: string;
    client_name: string | null;
    company_name: string | null;
    business_profiles?: { company_name: string | null }[] | null;
}

export interface ClientSearchHit {
    id: string;
    client_name: string;
    /** The business name that matched (falls back to the vault's company_name). */
    company_name: string;
}

/** Embed to add to a client_data_vault select so rows fit ClientSearchRow. */
export const CLIENT_SEARCH_SELECT = "id, client_name, company_name, business_profiles ( company_name )";

export function searchClients(rows: ClientSearchRow[], query: string, limit = 8): ClientSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: ClientSearchHit[] = [];
    for (const row of rows) {
        const primary = row.company_name ?? "";
        const otherHit = (row.business_profiles ?? [])
            .map(b => b.company_name ?? "")
            .find(name => name.toLowerCase().includes(q));
        const nameHit = (row.client_name ?? "").toLowerCase().includes(q) || primary.toLowerCase().includes(q);
        if (!nameHit && !otherHit) continue;
        hits.push({
            id: row.id,
            client_name: row.client_name ?? "",
            company_name: primary.toLowerCase().includes(q) || !otherHit ? primary : otherHit,
        });
        if (hits.length >= limit) break;
    }
    return hits;
}
