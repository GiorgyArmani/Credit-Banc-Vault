// src/components/lender-api/lender-api-row-actions.tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, RefreshCw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import type { ApiAssignmentSummary } from "@/lib/lender-api/route-helpers";
// rules.ts is pure and imports only types, so it is safe in the browser.
import { canRetrySubmission, canStartSubmission, isStaleInFlight, type SubmissionStatus } from "@/lib/lender-api/rules";
import { LenderApiSubmitPanel } from "./lender-api-submit-panel";

const STATUS_LABEL: Record<string, string> = {
  sending: "Sending…",
  lead_created: "Uploading documents…",
  sent: "Sent by API",
  partial: "Some files failed",
  failed: "Send failed",
};

const STALLED_LABEL = "Stalled — retry or re-send";

export function LenderApiRowActions({
  assignmentId,
  assignmentStatus,
  summary,
  onChanged,
  className,
}: {
  assignmentId: string;
  assignmentStatus: string;
  summary: ApiAssignmentSummary | undefined;
  onChanged: () => void | Promise<void>;
  /** Classes for an outer wrapper; no wrapper is rendered when there is no summary. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "retry" | null>(null);
  // Wall clock for the stale-window checks. It ticks so a row that goes stale
  // while the page sits open turns "Stalled" (and retryable) without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!summary) return null;

  const latest = summary.latest;
  // Spinner badge only — the shared poll that actually refreshes this data
  // lives once in useLenderApiAssignments, not per row.
  const inFlight = latest?.status === "sending" || latest?.status === "lead_created";
  const stalled = isStaleInFlight(latest, now);

  // The same pure guards the server applies, so the buttons never offer an action it will refuse.
  const canSend =
    summary.sendable &&
    canStartSubmission(
      assignmentStatus,
      latest ? { status: latest.status as SubmissionStatus, updated_at: latest.updated_at } : null,
      now
    ).ok;
  const canRetry =
    summary.sendable &&
    !!latest?.external_id &&
    (canRetrySubmission(
      assignmentStatus,
      { status: latest.status as SubmissionStatus, external_id: latest.external_id, updated_at: latest.updated_at },
      now
    ).ok ||
      // Retry is also how a stale "could not be marked submitted" warning is cleared.
      latest.error_kind === "flip_failed");

  async function post(path: string, kind: "refresh" | "retry") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/lender-assignments/${assignmentId}/lender-api/${path}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(json.error || "Request failed");
      else if (kind === "refresh") toast.success(`${summary!.display_name}: ${json.status?.stage ?? "status updated"}`);
      else if (json.flipped) toast.success("Marked submitted");
      else toast.success(json.retrying ? `Retrying ${json.retrying} file(s)` : "Nothing left to retry");
      await onChanged();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setBusy(null);
    }
  }

  const content = (
    <div className="flex flex-col items-end gap-2">
      {canSend && (
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-900 hover:bg-slate-800 text-white"
        >
          <Send className="h-3 w-3 mr-1" />
          Send to {summary.display_name}
        </Button>
      )}

      {latest && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 space-y-1 max-w-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={stalled ? "text-[9px] border-amber-300 text-amber-700" : "text-[9px]"}>
              {inFlight && !stalled && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {stalled ? STALLED_LABEL : STATUS_LABEL[latest.status] ?? latest.status}
            </Badge>
            {latest.external_id && (
              <button
                type="button"
                title="Copy lead ID"
                className="font-mono underline decoration-dotted"
                onClick={() => {
                  void navigator.clipboard.writeText(latest.external_id!);
                  toast.success("Lead ID copied");
                }}
              >
                {latest.external_id}
              </button>
            )}
            <span>Docs {latest.documents_accepted}/{latest.documents_total}</span>
          </div>
          {latest.last_stage && <p>{summary.display_name}: {latest.last_stage}</p>}
          {latest.error && <p className="text-rose-600">{latest.error}</p>}
          {latest.external_id && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => post("refresh", "refresh")}>
                {busy === "refresh" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Refresh status
              </Button>
              {canRetry && (
                <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => post("attachments/retry", "retry")}>
                  {busy === "retry" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                  Retry failed files
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <LenderApiSubmitPanel open={open} onOpenChange={setOpen} assignmentId={assignmentId} onSubmitted={onChanged} />
    </div>
  );

  return className ? <div className={className}>{content}</div> : content;
}
