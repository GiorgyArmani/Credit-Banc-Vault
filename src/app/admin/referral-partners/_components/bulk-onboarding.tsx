"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Send,
  Loader2,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import {
  bulkImportPartnerContacts,
  inviteReferralPartnersBulk,
  type BulkImportResult,
} from "../actions";
import type { PartnerRow } from "./referral-partners-manager";

/**
 * Two-step bulk onboarding for the ~100 partners who exist as names only.
 *
 * The steps are separate by design. Import writes emails and shows you exactly
 * what matched; invite fires real mail. Fusing them would send ~100 emails off
 * the back of a fuzzy name match, and there is no un-sending them.
 *
 * Invites go out in chunks of 20 with visible progress rather than one call: a
 * single action doing 100 auth-user creations plus 100 SMTP sends will hit the
 * function timeout mid-list, leaving half the partners provisioned with no way
 * to tell which half.
 */
const CHUNK = 20;

export function BulkOnboarding({
  rows,
  onInvited,
}: {
  rows: PartnerRow[];
  onInvited: (invitedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [inviteLog, setInviteLog] = useState<{
    sent: string[];
    failed: { name: string; error: string }[];
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Ready = has an email, is active, and hasn't been given access yet.
  const ready = rows.filter((r) => r.email && r.active && !r.portal_enabled);
  const missingEmail = rows.filter((r) => !r.email && r.active).length;

  function runImport() {
    setError(null);
    setImportResult(null);
    startTransition(async () => {
      const res = await bulkImportPartnerContacts(paste);
      if (!res.success) {
        setError(res.error || "Import failed");
        return;
      }
      setImportResult(res);
      setPaste("");
      // The emails were written server-side; pull them back so step 2's "ready"
      // count reflects the import instead of the page's original snapshot.
      router.refresh();
    });
  }

  function runInvites() {
    setError(null);
    setInviteLog(null);
    const ids = ready.map((r) => r.id);
    if (!ids.length) return;

    startTransition(async () => {
      const sent: string[] = [];
      const failed: { name: string; error: string }[] = [];
      const invited: string[] = [];

      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        setProgress({ done: i, total: ids.length });
        const res = await inviteReferralPartnersBulk(batch);
        if (!res.success) {
          setError(res.error || "Invite batch failed");
          break;
        }
        sent.push(...res.sent);
        failed.push(...res.failed);
        // Only the ones that actually went out get marked locally.
        invited.push(
          ...batch.filter((id) => {
            const row = rows.find((r) => r.id === id);
            return row && res.sent.includes(row.name);
          })
        );
      }

      setProgress(null);
      setInviteLog({ sent, failed });
      if (invited.length) onInvited(invited);
    });
  }

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <Upload className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-bold text-slate-800">Bulk onboarding</span>
          <span className="text-[11px] text-slate-400">
            {ready.length} ready to invite
            {missingEmail > 0 && ` · ${missingEmail} missing an email`}
          </span>
        </span>
        <ChevronDown
          className={
            open
              ? "h-4 w-4 text-slate-400 rotate-180 transition-transform"
              : "h-4 w-4 text-slate-300 transition-transform"
          }
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-6">
          {/* Step 1 — import */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Step 1 · Load emails
            </p>
            <p className="text-xs text-slate-500 mb-2 leading-relaxed">
              One partner per line, comma- or tab-separated, so a spreadsheet
              column pastes straight in. Matches on the link name or the partner
              name. Nothing is created — unmatched lines are handed back to you.
            </p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={
                "Aaron_Sedlacek, aaron@firm.com\nAlbert Anderson, albert@bank.com, (555) 111-2222, Anderson Capital"
              }
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Columns: link-or-name, email, phone <i>(optional)</i>, firm{" "}
              <i>(optional)</i>
            </p>
            <button
              onClick={runImport}
              disabled={isPending || !paste.trim()}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg disabled:opacity-50"
            >
              {isPending && !progress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import
            </button>

            {importResult && (
              <div className="mt-3 space-y-2 text-xs">
                <p className="font-bold text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {importResult.updated} partner
                  {importResult.updated === 1 ? "" : "s"} updated
                </p>

                {importResult.overwritten.length > 0 && (
                  <Callout tone="amber" title="Replaced an existing email">
                    {importResult.overwritten.map((o, i) => (
                      <div key={i} className="font-mono text-[11px]">
                        {o.name}: {o.from} → {o.to}
                      </div>
                    ))}
                  </Callout>
                )}

                {importResult.unmatched.length > 0 && (
                  <Callout
                    tone="amber"
                    title={`${importResult.unmatched.length} line(s) matched no partner`}
                  >
                    <p className="mb-1 text-[11px] not-italic">
                      Add them as partners first, or fix the name/link, then
                      re-paste just these:
                    </p>
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">
                      {importResult.unmatched.join("\n")}
                    </pre>
                  </Callout>
                )}

                {importResult.invalid.length > 0 && (
                  <Callout
                    tone="red"
                    title={`${importResult.invalid.length} line(s) couldn't be read`}
                  >
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">
                      {importResult.invalid.join("\n")}
                    </pre>
                  </Callout>
                )}
              </div>
            )}
          </div>

          {/* Step 2 — invite */}
          <div className="border-t border-slate-100 pt-5">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Step 2 · Send invites
            </p>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              Creates a login for every <b>active</b> partner who has an email and
              no portal access yet, and emails each of them a link to set a
              password. Partners already on the portal are skipped — use{" "}
              <b>Re-send link</b> on the row for those.
            </p>

            {ready.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nobody is ready. Load emails in step 1 first.
              </p>
            ) : (
              <>
                <button
                  onClick={runInvites}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
                >
                  {progress ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Invite {ready.length} partner{ready.length === 1 ? "" : "s"}
                </button>
                {progress && (
                  <p className="mt-2 text-[11px] font-semibold text-slate-500">
                    Sending… {progress.done} of {progress.total}. Leave this tab
                    open.
                  </p>
                )}
              </>
            )}

            {inviteLog && (
              <div className="mt-3 space-y-2 text-xs">
                <p className="font-bold text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {inviteLog.sent.length} invite
                  {inviteLog.sent.length === 1 ? "" : "s"} sent
                </p>
                {inviteLog.failed.length > 0 && (
                  <Callout
                    tone="red"
                    title={`${inviteLog.failed.length} didn't go out`}
                  >
                    {inviteLog.failed.map((f, i) => (
                      <div key={i} className="text-[11px]">
                        <b>{f.name}</b> — {f.error}
                      </div>
                    ))}
                  </Callout>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm font-semibold text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "amber" | "red";
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-red-200 bg-red-50 text-red-700";
  return (
    <div className={`rounded-lg border p-2.5 ${cls}`}>
      <p className="font-bold flex items-center gap-1.5 mb-1">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {title}
      </p>
      <div className="max-h-40 overflow-auto">{children}</div>
    </div>
  );
}
