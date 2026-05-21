"use client";

import { useState } from "react";
import { FileSignature, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingContracts } from "./use-pending-contracts";
import { SignContractDialog } from "./sign-contract-dialog";

/**
 * Shown to clients on their dashboard when one or more of their businesses
 * has an unsigned Signwell contract. The initial onboarding contract still
 * lives in OnboardingGate — this banner is strictly for ADDITIONAL businesses
 * the advisor added under the same client. Clicking a "Sign Contract" button
 * opens the shared SignContractDialog inline (iframe-embedded Signwell) so
 * the client never leaves /dashboard.
 *
 * Hides itself entirely when:
 *   • the client has only one business (initial onboarding handles it), OR
 *   • every additional business's funding_deal already has contract_completed.
 *
 * No mutation here — completion is webhook-driven via signwell-contract.
 */
export function PendingContractsBanner({ clientVaultId }: { clientVaultId: string | null }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { pending, loaded } = usePendingContracts(clientVaultId, refreshKey);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);

  if (!loaded || pending.length === 0) return null;

  const openAt = (idx: number) => {
    setStartIndex(idx);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-[2rem] p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
            <FileSignature className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-black text-amber-950 uppercase tracking-tight">
              {pending.length === 1 ? "Contract Ready to Sign" : `${pending.length} Contracts Ready to Sign`}
            </h3>
            <p className="text-sm text-amber-900/70 font-bold mt-1">
              Your advisor added {pending.length === 1 ? "a new business" : "additional businesses"} to your file. Sign the contract{pending.length === 1 ? "" : "s"} below to keep things moving.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {pending.map((p, idx) => (
            <div
              key={p.funding_deal_id}
              className="flex items-center justify-between gap-4 bg-white border border-amber-200 rounded-2xl px-5 py-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-widest text-amber-700">Awaiting Signature</p>
                <p className="text-base font-bold text-amber-950 truncate">{p.business_name}</p>
              </div>
              <Button
                type="button"
                onClick={() => openAt(idx)}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold uppercase tracking-widest text-xs rounded-xl"
              >
                Sign Contract <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <SignContractDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pending={pending}
        initialIndex={startIndex}
        onRefresh={() => setRefreshKey(k => k + 1)}
      />
    </>
  );
}
