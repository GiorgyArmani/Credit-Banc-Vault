"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { retryAffiliatePayout, markPayoutDelivered } from "../actions";

export function PayoutActions({ payoutId, status }: { payoutId: string; status: string }) {
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

  return (
    <Button
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(async () => { await retryAffiliatePayout(payoutId); })}
      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
    >
      {isPending ? "Retrying…" : "Retry send"}
    </Button>
  );
}
