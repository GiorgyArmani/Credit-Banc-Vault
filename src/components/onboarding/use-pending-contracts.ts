"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface PendingContract {
  funding_deal_id: string;
  business_profile_id: string;
  business_name: string;
  contract_url: string;
}

/**
 * Lists unsigned Signwell contracts for additional businesses attached to
 * the given client vault. Primary business is excluded — its contract is
 * the initial onboarding contract and is handled by OnboardingGate.
 *
 * Shared between the auto-opening modal and the fallback banner so both
 * stay in sync (avoiding a state where the modal closes but the banner
 * disagrees). Re-runs when `clientVaultId` changes or `refreshKey` ticks,
 * which the modal uses to re-check after the Signwell signing window
 * closes.
 */
export function usePendingContracts(clientVaultId: string | null, refreshKey: number = 0) {
  const [pending, setPending] = useState<PendingContract[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Optimistically-signed deals. Setting funding_deals.contract_completed is
  // async (in-app sync OR the Signwell webhook), so a re-fetch right after
  // signing can still read the row as pending — which left the "Contract Ready
  // to Sign" banner stuck after a successful sign. The signing surface calls
  // markSigned() on the embed's `completed` event; we hide those immediately
  // and keep them hidden across re-fetches (harmless once the DB catches up and
  // stops returning them).
  const [signedIds, setSignedIds] = useState<Set<string>>(new Set());
  const markSigned = useCallback((fundingDealId: string) => {
    setSignedIds((prev) => {
      const next = new Set(prev);
      next.add(fundingDealId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!clientVaultId) {
      setPending([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const { data: bizRows } = await supabase
        .from("business_profiles")
        .select("id, company_name, is_primary")
        .eq("client_vault_id", clientVaultId);

      const nonPrimary = (bizRows ?? []).filter((b: any) => !b.is_primary);
      if (nonPrimary.length === 0) {
        if (!cancelled) { setPending([]); setLoaded(true); }
        return;
      }
      const nonPrimaryIds = nonPrimary.map((b: any) => b.id);

      const { data: dealRows } = await supabase
        .from("funding_deals")
        .select("id, business_profile_id, contract_url, contract_completed")
        .in("business_profile_id", nonPrimaryIds)
        .eq("contract_completed", false)
        .not("contract_url", "is", null);

      const list: PendingContract[] = (dealRows ?? [])
        .map((d: any) => {
          const biz = nonPrimary.find((b: any) => b.id === d.business_profile_id);
          if (!biz) return null;
          return {
            funding_deal_id: d.id,
            business_profile_id: biz.id,
            business_name: biz.company_name || "Your Business",
            contract_url: d.contract_url,
          } as PendingContract;
        })
        .filter((x: PendingContract | null): x is PendingContract => x !== null);

      if (!cancelled) {
        setPending(list);
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [clientVaultId, refreshKey]);

  const visible = pending.filter((p) => !signedIds.has(p.funding_deal_id));
  return { pending: visible, loaded, markSigned };
}
