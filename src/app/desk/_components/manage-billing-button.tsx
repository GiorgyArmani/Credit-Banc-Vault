"use client";

// Opens the Stripe Billing Portal. The route is reachable while the desk is
// locked — this button is how a frozen rep unfreezes.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

export function ManageBillingButton({ label = "Manage billing" }: { label?: string }) {
  const [loading, setLoading] = useState(false);

  const open = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/partner-plus/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? "Could not open billing. Try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error("Could not open billing. Try again.");
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cb-navy px-6 py-3.5 font-bold text-white shadow-lg transition-all hover:bg-cb-navy/90 disabled:opacity-50"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Opening Stripe…
        </>
      ) : (
        label
      )}
    </button>
  );
}
