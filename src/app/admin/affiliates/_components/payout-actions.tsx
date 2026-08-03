"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { retryAffiliatePayout, markPayoutDelivered } from "../actions";

export function PayoutActions({
  payoutId,
  status,
  held = false,
}: {
  payoutId: string;
  status: string;
  /** Stopped by a guardrail and never attempted — releasing it spends money. */
  held?: boolean;
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

  // A held payout was never attempted — releasing it is a deliberate decision to
  // override a guardrail and spend, so it confirms first and says so plainly.
  const send = () => {
    if (held && !window.confirm("Release this held payout and send the gift card now?")) return;
    startTransition(async () => { await retryAffiliatePayout(payoutId); });
  };

  return (
    <Button
      size="sm"
      disabled={isPending}
      onClick={send}
      className={
        held
          ? "bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
          : "bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
      }
    >
      {isPending ? "Sending…" : held ? "Release & send" : "Retry send"}
    </Button>
  );
}
