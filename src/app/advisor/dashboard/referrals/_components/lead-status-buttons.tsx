"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateReferralLeadStatus } from "../actions";

const OPTIONS: { value: "contacted" | "qualified" | "disqualified"; label: string }[] = [
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Not a fit" },
];

export function LeadStatusButtons({ leadId, current }: { leadId: string; current: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(current);

  const set = (value: "contacted" | "qualified" | "disqualified") => {
    startTransition(async () => {
      const res = await updateReferralLeadStatus(leadId, value);
      if (res.success) setStatus(value);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => (
        <Button
          key={o.value}
          size="sm"
          variant={status === o.value ? "default" : "outline"}
          disabled={isPending}
          onClick={() => set(o.value)}
          className={
            status === o.value
              ? "bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
              : "border-emerald-200 text-emerald-800 font-bold rounded-xl"
          }
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
