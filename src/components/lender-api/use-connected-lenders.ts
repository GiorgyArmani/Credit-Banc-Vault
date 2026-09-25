// src/components/lender-api/use-connected-lenders.ts
"use client";

import { useEffect, useState } from "react";
import type { ConnectedLenders } from "@/lib/lender-api/connected";

/**
 * Lenders we can submit to by API, keyed by lenderKey(lender_name). Starts
 * empty and stays empty on any failure: the badge and the Lender Match boost
 * are extras, so an unreachable endpoint just means the plain list.
 */
export function useConnectedLenders(): ConnectedLenders {
  const [lenders, setLenders] = useState<ConnectedLenders>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lender-api/connected", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.lenders && typeof json.lenders === "object") setLenders(json.lenders);
      } catch {
        // Network hiccup: no badges, no boost — the lists still render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return lenders;
}
