"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Loader2,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Briefcase,
  LinkIcon,
  Users,
} from "lucide-react";
import {
  preparePartnerInvites,
  inviteReferralPartnersBulk,
  type PrepareInvitesResult,
} from "../actions";

/**
 * Bulk invite: pick a tier, paste that tier's list, send.
 *
 * Two premade lists exist offline — the tier-1 referral partners and the tier-2
 * deal-desk partners — so the tier is the FIRST choice, not a modifier hidden
 * next to the send button. Everything below it (eligibility, wording, what the
 * partner receives) follows from it.
 *
 * Check and send are two clicks, deliberately. Matching is fuzzy — link slug,
 * then name — and one button that matched and mailed in the same breath would
 * fire real email off a typo, with no un-sending it. The check writes contact
 * details and shows exactly who is in the send; the send goes to that list and
 * nothing else.
 *
 * Invites go out in chunks of 20 with visible progress rather than one call: a
 * single action doing 60 auth-user creations plus 60 SMTP sends will hit the
 * function timeout mid-list, leaving half the partners provisioned with no way
 * to tell which half.
 */
const CHUNK = 20;

type Tier = "referral" | "deal_desk";

export function BulkOnboarding({
  onInvited,
}: {
  onInvited: (invitedIds: string[], opts: { withDealDesk: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<Tier>("referral");
  const [paste, setPaste] = useState("");
  const [prepared, setPrepared] = useState<PrepareInvitesResult | null>(null);
  const [inviteLog, setInviteLog] = useState<{
    sent: string[];
    failed: { name: string; error: string }[];
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const withDealDesk = tier === "deal_desk";
  const ready = prepared?.ready ?? [];

  /** Any edit invalidates a previous check — the list on screen must be the list that sends. */
  function invalidate() {
    setPrepared(null);
    setInviteLog(null);
    setError(null);
  }

  function runCheck() {
    setError(null);
    setInviteLog(null);
    startTransition(async () => {
      const res = await preparePartnerInvites(paste, { withDealDesk });
      if (!res.success) {
        setError(res.error || "Could not read that list");
        return;
      }
      setPrepared(res);
      // Contact details were written server-side; refresh so the table below
      // reflects them rather than the page's original snapshot.
      if (res.updated) router.refresh();
    });
  }

  function runInvites() {
    if (!ready.length) return;
    setError(null);
    setInviteLog(null);

    // Snapshot the tier for this run. Flipping the toggle mid-send would
    // otherwise change what the remaining chunks provision.
    const sendingDealDesk = withDealDesk;
    const ids = ready.map((r) => r.id);

    startTransition(async () => {
      const sent: string[] = [];
      const failed: { name: string; error: string }[] = [];
      const invited: string[] = [];

      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        setProgress({ done: i, total: ids.length });
        const res = await inviteReferralPartnersBulk(batch, {
          withDealDesk: sendingDealDesk,
        });
        if (!res.success) {
          setError(res.error || "Invite batch failed");
          break;
        }
        sent.push(...res.sent);
        failed.push(...res.failed);
        // Only the ones that actually went out get marked locally.
        invited.push(
          ...batch.filter((id) => {
            const r = ready.find((x) => x.id === id);
            return r && res.sent.includes(r.name);
          })
        );
      }

      setProgress(null);
      setInviteLog({ sent, failed });
      setPrepared(null);
      if (invited.length) onInvited(invited, { withDealDesk: sendingDealDesk });
    });
  }

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <Users className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-bold text-slate-800">Bulk invite</span>
          <span className="text-[11px] text-slate-400">
            Pick a tier, paste the list, send
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
        <div className="border-t border-slate-100 px-4 py-4 space-y-5">
          {/* 1 — tier */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              1 · Select the tier
            </p>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <TierButton
                active={tier === "referral"}
                onClick={() => {
                  setTier("referral");
                  invalidate();
                }}
                icon={<LinkIcon className="h-3.5 w-3.5" />}
                label="Referral partner"
                sub="Tier 1"
              />
              <TierButton
                active={tier === "deal_desk"}
                onClick={() => {
                  setTier("deal_desk");
                  invalidate();
                }}
                icon={<Briefcase className="h-3.5 w-3.5" />}
                label="Deal desk partner"
                sub="Tier 2"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">
              {withDealDesk ? (
                <>
                  They get the deal-desk email and a partner workspace, and sign
                  a W-9 and add a voided check before the desk opens. Anyone
                  already on the desk is skipped — a partner already invited as
                  tier 1 is <b>included</b>, which is how you promote them.
                </>
              ) : (
                <>
                  They get the activation email and a dashboard for the clients
                  they refer. No paperwork. Anyone already on the portal is
                  skipped — use <b>Re-send link</b> on their row instead.
                </>
              )}
            </p>
          </div>

          {/* 2 — the list */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              2 · Paste the list
            </p>
            <textarea
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                invalidate();
              }}
              rows={8}
              spellCheck={false}
              placeholder={
                "One partner per line. A name on its own is enough if they're already in the system:\n\nAaron Sedlacek\nCesar Silva\n\nOr paste a spreadsheet selection to fill in their details at the same time:\n\nAaron_Sedlacek, aaron@firm.com\nAlbert Anderson, albert@bank.com, (555) 111-2222, Anderson Capital"
              }
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Matches on the link name or the partner name. Nothing is created —
              unmatched lines are handed back to you.
            </p>
            <button
              onClick={runCheck}
              disabled={isPending || !paste.trim()}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg disabled:opacity-50"
            >
              {isPending && !progress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListChecks className="h-4 w-4" />
              )}
              Check list
            </button>
          </div>

          {/* 3 — send */}
          {prepared && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                3 · Send
              </p>

              <div className="space-y-2 text-xs mb-3">
                <p className="font-bold text-slate-700">
                  {ready.length} will be invited
                  {prepared.skipped.length > 0 &&
                    ` · ${prepared.skipped.length} skipped`}
                  {prepared.unmatched.length > 0 &&
                    ` · ${prepared.unmatched.length} not found`}
                  {prepared.updated > 0 && ` · ${prepared.updated} updated`}
                </p>

                {ready.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 max-h-32 overflow-auto text-[11px] text-slate-600">
                    {ready.map((r) => r.name).join(", ")}
                  </div>
                )}

                {prepared.overwritten.length > 0 && (
                  <Callout tone="amber" title="Replaced an existing email">
                    {prepared.overwritten.map((o, i) => (
                      <div key={i} className="font-mono text-[11px]">
                        {o.name}: {o.from} → {o.to}
                      </div>
                    ))}
                  </Callout>
                )}

                {prepared.skipped.length > 0 && (
                  <Callout
                    tone="amber"
                    title={`${prepared.skipped.length} skipped`}
                  >
                    {prepared.skipped.map((s, i) => (
                      <div key={i} className="text-[11px]">
                        <b>{s.name}</b> — {s.reason}
                      </div>
                    ))}
                  </Callout>
                )}

                {prepared.unmatched.length > 0 && (
                  <Callout
                    tone="amber"
                    title={`${prepared.unmatched.length} line(s) matched no partner`}
                  >
                    <p className="mb-1 text-[11px] not-italic">
                      Add them as partners first, or fix the name, then re-check:
                    </p>
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">
                      {prepared.unmatched.join("\n")}
                    </pre>
                  </Callout>
                )}

                {prepared.invalid.length > 0 && (
                  <Callout
                    tone="red"
                    title={`${prepared.invalid.length} line(s) couldn't be read`}
                  >
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">
                      {prepared.invalid.join("\n")}
                    </pre>
                  </Callout>
                )}
              </div>

              {ready.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Nobody in that list is eligible for this tier.
                </p>
              ) : (
                <>
                  <button
                    onClick={runInvites}
                    disabled={isPending}
                    className={
                      withDealDesk
                        ? "inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
                        : "inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
                    }
                  >
                    {progress ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {withDealDesk
                      ? `Send ${ready.length} deal-desk invite${ready.length === 1 ? "" : "s"}`
                      : `Send ${ready.length} invite${ready.length === 1 ? "" : "s"}`}
                  </button>
                  {progress && (
                    <p className="mt-2 text-[11px] font-semibold text-slate-500">
                      Sending… {progress.done} of {progress.total}. Leave this
                      tab open.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {inviteLog && (
            <div className="space-y-2 text-xs">
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

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

function TierButton({
  active,
  onClick,
  icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white shadow-sm text-slate-900 text-xs font-bold"
          : "flex items-center gap-2 px-3.5 py-2 rounded-lg text-slate-500 hover:text-slate-700 text-xs font-bold"
      }
    >
      <span className={active ? "text-emerald-600" : "text-slate-400"}>{icon}</span>
      {label}
      <span
        className={
          active
            ? "text-[10px] font-black uppercase tracking-wider text-emerald-600"
            : "text-[10px] font-black uppercase tracking-wider text-slate-300"
        }
      >
        {sub}
      </span>
    </button>
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
