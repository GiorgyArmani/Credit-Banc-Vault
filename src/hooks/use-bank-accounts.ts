"use client";

/**
 * useBankAccounts — the bank accounts for one business tab.
 *
 * Shared by the three surfaces that touch statements (client vault, advisor /
 * admin workspace, underwriting file) so they agree on when the list reloads:
 * on mount and on every business-tab switch. Accounts are per-business, so
 * carrying business A's list onto business B's tab would offer the uploader
 * accounts that the upload API then rejects.
 *
 * Failures are logged and swallowed into an empty list on purpose. A missing
 * account list must degrade to "Not specified" — the same state every upload
 * was in before this feature — never block someone from sending a document.
 */

import { useCallback, useEffect, useState } from "react";
import type { BankAccount } from "@/lib/bank-accounts";

export function useBankAccounts(businessProfileId: string | null | undefined) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!businessProfileId) {
      setAccounts([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/bank-accounts?business_profile_id=${encodeURIComponent(businessProfileId)}`
      );
      if (!res.ok) throw new Error(`bank accounts fetch failed: ${res.status}`);
      const data = await res.json();
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (e) {
      console.error("useBankAccounts failed:", e);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [businessProfileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Splice a newly created account in locally instead of re-fetching — the
   * picker selects it immediately after creating it, and a round trip there
   * would leave the select briefly pointing at an id its own options don't
   * contain. Idempotent: the create endpoint returns the existing row on a
   * duplicate, so adding the same account twice is a no-op.
   */
  const addAccount = useCallback((account: BankAccount) => {
    setAccounts((prev) =>
      prev.some((a) => a.id === account.id) ? prev : [...prev, account]
    );
  }, []);

  return { accounts, loading, refresh, addAccount };
}
