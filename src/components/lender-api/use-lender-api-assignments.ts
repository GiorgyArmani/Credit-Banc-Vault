// src/components/lender-api/use-lender-api-assignments.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiAssignmentSummary } from "@/lib/lender-api/route-helpers";
import { STALE_IN_FLIGHT_MS } from "@/lib/lender-api/rules";

/**
 * An in-flight submission still inside the stale window. Past it the worker is
 * presumed dead, the row shows "Stalled", and polling it would never end.
 */
function hasLiveInFlight(summaries: Record<string, ApiAssignmentSummary>, now: number): boolean {
  return Object.values(summaries).some((s) => {
    const latest = s.latest;
    return (
      !!latest &&
      (latest.status === "sending" || latest.status === "lead_created") &&
      now - Date.parse(latest.updated_at) <= STALE_IN_FLIGHT_MS
    );
  });
}

/** Which of a client's lender assignments can be sent by API, with the latest submission. */
export function useLenderApiAssignments(clientId: string | null) {
  const [summaries, setSummaries] = useState<Record<string, ApiAssignmentSummary>>({});
  const [inFlight, setInFlight] = useState(false);

  const reload = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/lender-api/assignments?client_id=${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      const next: Record<string, ApiAssignmentSummary> = json.assignments ?? {};
      setSummaries(next);
      // Re-evaluated on every reload, so the poll stops once every in-flight row is stale.
      setInFlight(hasLiveInFlight(next, Date.now()));
    } catch {
      // Network hiccup: the feature simply stays hidden until the next reload.
    }
  }, [clientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch; state is set after the awaited response, not synchronously
    void reload();
  }, [reload]);

  // One shared poll for the whole assignments list, not one per row. Document
  // uploads happen in the background after the send and never change the
  // assignment's own status, so polling `reload` (summaries only) is enough —
  // no page-level re-fetch is needed here.
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [inFlight, reload]);

  return { summaries, reload };
}
