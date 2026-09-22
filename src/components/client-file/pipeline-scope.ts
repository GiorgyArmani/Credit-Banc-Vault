// The pipeline stage is per BUSINESS, not per client. loan_status_history rows
// carry the business their round belongs to; unstamped rows (legacy, and
// client-level writes) belong to the primary business — the same rule the
// documents use. A single-business file keeps every row.

type HistoryRow = { status: string; created_at: string; business_profile_id?: string | null };
type Business = { id: string; is_primary: boolean };

export function scopePipelineHistory<T extends HistoryRow>(
  history: T[],
  active_business: Business | null,
  business_count: number
): T[] {
  if (!active_business || business_count <= 1) return history;
  return history.filter((r) =>
    r.business_profile_id ? r.business_profile_id === active_business.id : active_business.is_primary
  );
}

/** Newest row's status, or "created" for a business with no steps yet. */
export function latestPipelineStatus(history: HistoryRow[]): string {
  let latest: HistoryRow | null = null;
  for (const r of history) {
    if (!latest || new Date(r.created_at).getTime() > new Date(latest.created_at).getTime()) latest = r;
  }
  return latest?.status ?? "created";
}
