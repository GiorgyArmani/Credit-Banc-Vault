/**
 * Read EVERY row of a query, page by page.
 *
 * PostgREST silently caps a response at 1000 rows. Bulk reads that span every
 * client (status history, uploads, notes) are already past that in prod, and a
 * capped read doesn't error — it just drops rows, so "latest status" and
 * "last activity" quietly go wrong for whoever falls off the end.
 *
 * `build` must return a fresh query with a deterministic `.order(...)` (end on
 * a unique column such as `id`), or pages can overlap or skip rows.
 */
export async function fetchAllRows<T>(
    build: () => any,
    pageSize = 1000
): Promise<{ data: T[]; error: { message: string } | null }> {
    const rows: T[] = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) return { data: rows, error };
        rows.push(...((data ?? []) as T[]));
        if (!data || data.length < pageSize) break;
    }
    return { data: rows, error: null };
}
