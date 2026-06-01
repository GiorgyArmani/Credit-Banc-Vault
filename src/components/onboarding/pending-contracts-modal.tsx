"use client";

import { useEffect, useState } from "react";
import { usePendingContracts } from "./use-pending-contracts";
import { SignContractDialog } from "./sign-contract-dialog";

/**
 * Auto-opens on dashboard mount when the client has unsigned Signwell
 * contracts for additional businesses. Renders the shared SignContractDialog
 * so the signing surface stays identical to the banner-click path.
 *
 * The modal re-arms on every fresh navigation to the dashboard route (each
 * mount of this component). After signing, the webhook flips
 * contract_completed and the next mount has nothing to show.
 *
 * Session dismissal: closing the dialog stamps a tab-scoped flag so the
 * same session doesn't repeatedly nag. The PendingContractsBanner remains
 * the explicit re-entry point until refresh/sign-out clears the flag.
 */
const DISMISS_KEY = "pending_contracts_modal_dismissed";

export function PendingContractsModal({ clientVaultId }: { clientVaultId: string | null }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { pending, loaded, markSigned } = usePendingContracts(clientVaultId, refreshKey);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loaded || pending.length === 0) {
      setOpen(false);
      return;
    }
    const dismissed = typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1";
    if (!dismissed) setOpen(true);
  }, [loaded, pending.length]);

  if (!loaded || pending.length === 0) return null;

  return (
    <SignContractDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && typeof window !== "undefined") {
          sessionStorage.setItem(DISMISS_KEY, "1");
        }
        setOpen(o);
      }}
      pending={pending}
      onRefresh={() => setRefreshKey(k => k + 1)}
      onCompleted={markSigned}
    />
  );
}
