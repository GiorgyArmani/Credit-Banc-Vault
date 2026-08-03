"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { retryAffiliatePayout, markPayoutDelivered, cancelAffiliatePayout } from "../actions";

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
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => startTransition(async () => { await markPayoutDelivered(payoutId); })}
        className="border-emerald-200 text-emerald-800 font-bold rounded-xl"
      >
        Mark delivered
      </Button>
    );
  }

  if (status === "canceled") {
    return <span className="text-xs font-bold text-emerald-900/30">No action</span>;
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
