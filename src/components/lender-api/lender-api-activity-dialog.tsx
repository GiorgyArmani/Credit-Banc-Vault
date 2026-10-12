// src/components/lender-api/lender-api-activity-dialog.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import type { ProviderActivityRow } from "@/lib/lender-api/activity";

const KIND_LABEL: Record<string, string> = {
  approved: "Approved",
  declined: "Declined",
  needs_info: "Needs attention",
  in_progress: "In progress",
};

const KIND_CLASS: Record<string, string> = {
  approved: "border-emerald-300 bg-emerald-50 text-emerald-700",
  declined: "border-rose-300 bg-rose-50 text-rose-700",
  needs_info: "border-amber-300 bg-amber-50 text-amber-700",
  in_progress: "border-sky-300 bg-sky-50 text-sky-700",
};

const SEND_LABEL: Record<string, string> = {
  sending: "Sending…",
  lead_created: "Uploading documents…",
  sent: "Sent",
  partial: "Sent — some files failed",
  failed: "Send failed",
};

const SOURCE_LABEL: Record<string, string> = {
  send: "answered at send",
  webhook: "lender notified us",
  refresh: "found on refresh",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Every deal sent to one lender by API and where the lender has it — the
 * lender database's view of what the client file shows one deal at a time.
 */
export function LenderApiActivityDialog({
  providerId,
  displayName,
  open,
  onOpenChange,
}: {
  providerId: string;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<ProviderActivityRow[] | null>(null);
  const [live, setLive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (method: "GET" | "POST") => {
      const res = await fetch(`/api/lender-api/providers/${providerId}/submissions`, { method, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load this lender's deals");
      setRows(json.submissions ?? []);
      setLive(!!json.live);
      return json;
    },
    [providerId]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(null);
    setLoadError(null);
    load("GET").catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load this lender's deals");
    });
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  async function refresh() {
    setRefreshing(true);
    try {
      const json = await load("POST");
      const r = json.refresh as { refreshed: number; failed: number; remaining: number } | undefined;
      if (!r) return;
      if (r.failed > 0) toast.error(`${displayName} did not answer for ${r.failed} deal${r.failed === 1 ? "" : "s"} — the rest are up to date`);
      else if (r.remaining > 0) toast.success(`Checked ${r.refreshed} — ${r.remaining} more, refresh again`);
      else toast.success(r.refreshed ? `Checked ${r.refreshed} deal${r.refreshed === 1 ? "" : "s"} with ${displayName}` : "Nothing to check yet");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{displayName} — deals sent by API</DialogTitle>
          <DialogDescription>
            {live
              ? `Each deal's status is what ${displayName} last told us. Refresh asks them again now.`
              : `${displayName} has no status lookup — each status is what they last sent us.`}
          </DialogDescription>
        </DialogHeader>

        {live && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={refreshing || !rows?.length} onClick={refresh}>
              {refreshing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Refresh from {displayName}
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-auto -mx-2 px-2">
          {loadError ? (
            <p className="py-10 text-center text-sm text-rose-600">{loadError}</p>
          ) : rows === null ? (
            <p className="py-10 text-center text-sm text-slate-500 animate-pulse">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Nothing has been sent to {displayName} by API yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-widest text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3 font-semibold">Deal</th>
                  <th className="py-2 pr-3 font-semibold">Sent</th>
                  <th className="py-2 pr-3 font-semibold">{displayName} status</th>
                  <th className="py-2 pr-3 font-semibold">Last checked</th>
                  <th className="py-2 font-semibold">Lender ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.submission_id} className={`border-b border-slate-100 align-top ${row.superseded ? "opacity-50" : ""}`}>
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/underwriting/dashboard/clients/${row.client_id}`}
                        className="font-semibold text-slate-900 hover:underline"
                      >
                        {row.company_name || row.client_name || "Unnamed client"}
                      </Link>
                      {row.company_name && row.client_name && <p className="text-slate-500">{row.client_name}</p>}
                      <p className="text-slate-400">
                        Attempt {row.attempt_no}
                        {row.superseded && " · replaced by a newer send"}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-600">
                      {when(row.sent_at)}
                      <p className={row.send_status === "failed" ? "text-rose-600" : "text-slate-400"}>
                        {SEND_LABEL[row.send_status] ?? row.send_status}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">
                      {row.lender_status ? (
                        <>
                          <Badge variant="outline" className={`text-[10px] ${KIND_CLASS[row.lender_status.kind] ?? ""}`}>
                            {KIND_LABEL[row.lender_status.kind] ?? row.lender_status.kind}
                          </Badge>
                          <p className="mt-1 font-mono text-slate-700">{row.lender_status.stage}</p>
                          {row.lender_status.note && <p className="text-slate-500">{row.lender_status.note}</p>}
                        </>
                      ) : (
                        <span className="text-slate-400">{row.external_id ? "No status yet" : "Never reached the lender"}</span>
                      )}
                      {row.error && <p className="mt-1 text-rose-600">{row.error}</p>}
                      {row.history.length > 0 && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                            History ({row.history.length})
                          </summary>
                          <ol className="mt-1 space-y-1 border-l border-slate-200 pl-2.5">
                            {row.history.map((event, i) => (
                              <li key={i}>
                                <span className="font-mono text-slate-700">{event.stage}</span>{" "}
                                <span className="text-slate-400">
                                  · {when(event.created_at)} · {SOURCE_LABEL[event.source] ?? event.source}
                                  {event.applied === "verdict" && " · written to the file"}
                                </span>
                                {event.note && <p className="text-slate-500">{event.note}</p>}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-600">{when(row.last_checked_at)}</td>
                    <td className="py-2.5">
                      {row.external_id ? (
                        <button
                          type="button"
                          title="Copy lender ID"
                          className="font-mono text-slate-600 underline decoration-dotted break-all text-left"
                          onClick={() => {
                            void navigator.clipboard.writeText(row.external_id!);
                            toast.success("Lender ID copied");
                          }}
                        >
                          {row.external_id}
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
