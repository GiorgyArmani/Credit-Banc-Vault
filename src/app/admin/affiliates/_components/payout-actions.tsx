"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import {
  retryAffiliatePayout,
  markPayoutDelivered,
  cancelAffiliatePayout,
  reopenAffiliatePayout,
  revealPayoutClaimLink,
} from "../actions";

export function PayoutActions({
  payoutId,
  status,
  held = false,
  releaseAt,
}: {
  payoutId: string;
  status: string;
  /** Stopped by a guardrail and never attempted — releasing it spends money. */
  held?: boolean;
  /** When the worker is allowed to create the gift card. */
  releaseAt?: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  if (status === "sent" || status === "delivered") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => startTransition(async () => { await markPayoutDelivered(payoutId); })}
          className="border-emerald-200 text-emerald-800 font-bold rounded-xl"
        >
          Mark delivered
        </Button>
        <ClaimLinkButton payoutId={payoutId} />
      </div>
    );
  }

  // Paid for, claim link still being minted by Giftronaut. Nothing to send and
  // nothing to cancel — the worker finishes it on its next pass. The only useful
  // control is a manual nudge, which just re-polls the existing order.
  if (status === "awaiting_link") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => startTransition(async () => { await retryAffiliatePayout(payoutId); })}
          className="border-sky-200 text-sky-700 font-bold rounded-xl"
        >
          {isPending ? "Checking…" : "Check for link"}
        </Button>
        <ClaimLinkButton payoutId={payoutId} />
      </div>
    );
  }

  // Cancelling used to be the end of the road: processAffiliatePayout refuses a
  // canceled row even for an admin, and UNIQUE(client_vault_id) stops the funded
  // hook ever creating a replacement. A deal cancelled by mistake, or genuinely
  // re-funded after the fact, needed a hand-written DB edit. Reopening puts it
  // back in the queue with a fresh 24h gate.
  if (status === "canceled") {
    const reopen = () => {
      if (
        !window.confirm(
          "Reopen this canceled payout? It re-enters the queue and sends in 24h if the deal still verifies as funded."
        )
      )
        return;
      startTransition(async () => { await reopenAffiliatePayout(payoutId); });
    };

    return (
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={reopen}
        className="border-amber-200 text-amber-800 font-bold rounded-xl"
      >
        {isPending ? "Reopening…" : "Reopen"}
      </Button>
    );
  }

  // Still inside the 24h gate: the worker will send it on its own, so the
  // primary action here is the one that stops it. Sending early is possible but
  // deliberately the quieter button — it throws away the recovery window.
  const waiting = !held && status !== "failed" && !!releaseAt && new Date(releaseAt) > new Date();

  const send = () => {
    const prompt = held
      ? "Release this held payout and send the gift card now?"
      : waiting
        ? "Send this gift card NOW, before the 24h review window closes?"
        : "Retry sending this gift card?";
    if (!window.confirm(prompt)) return;
    startTransition(async () => { await retryAffiliatePayout(payoutId); });
  };

  const cancel = () => {
    if (!window.confirm("Cancel this payout? No gift card will be created.")) return;
    startTransition(async () => { await cancelAffiliatePayout(payoutId); });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={isPending}
        variant={waiting ? "outline" : "default"}
        onClick={send}
        className={
          waiting
            ? "border-emerald-200 text-emerald-800 font-bold rounded-xl"
            : held
              ? "bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
              : "bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
        }
      >
        {isPending ? "Sending…" : held ? "Release & send" : waiting ? "Send now" : "Retry send"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={cancel}
        className="text-red-600 hover:text-red-700 hover:bg-red-50 font-bold rounded-xl"
      >
        Cancel
      </Button>
    </div>
  );
}

/**
 * Fetch and show the gift card's claim link on demand.
 *
 * The link is never rendered with the row: a reward link carries no recipient
 * OTP, so it is a bearer instrument, and a payouts table is exactly the kind of
 * screen that gets shared. This makes revealing it a deliberate act, for the
 * case where our email bounced and someone has to hand the link over.
 */
function ClaimLinkButton({ payoutId }: { payoutId: string }) {
  const [isPending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (link) {
    return (
      <div className="flex max-w-xs flex-col gap-1">
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-xs font-bold text-sky-700 underline"
        >
          {link}
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(link)}
          className="self-start text-[11px] font-bold uppercase tracking-wide text-emerald-900/50"
        >
          Copy
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await revealPayoutClaimLink(payoutId);
            if (res.success && res.link) setLink(res.link);
            else setError(res.error ?? "No claim link");
          })
        }
        className="text-emerald-900/60 hover:text-emerald-900 font-bold rounded-xl"
      >
        {isPending ? "…" : "Claim link"}
      </Button>
      {error && <span className="max-w-[14rem] text-[11px] font-medium text-red-600">{error}</span>}
    </div>
  );
}
