"use client";

/**
 * useDocumentGroups — every group on one file, for one business tab.
 *
 * Shared by the surfaces that touch documents (client vault, advisor/admin
 * workspace, underwriting file) so they agree on when the list reloads: on
 * mount and on every business-tab switch. Business-scoped groups belong to one
 * tab, so carrying business A's list onto business B's would offer groups the
 * assign API then rejects.
 *
 * ONE FETCH FOR ALL FIELDS. The endpoint returns every group on the file across
 * all 26 document codes, and components slice it per field with
 * `groupsForDocCode`. Fetching per field would mean up to 26 requests to render
 * one client page, most of them empty.
 *
 * Failures are logged and swallowed into an empty list on purpose. A missing
 * group list must degrade to "Not specified" — the same state every upload was
 * in before this feature — never block someone from sending a document.
 */

import { useCallback, useEffect, useState } from "react";
import type { DocumentGroup } from "@/lib/document-groups";

/**
 * `businessProfileId` alone is enough: the endpoint resolves the owning vault
 * from it and returns that tab's groups PLUS the client-scoped ones (DL / PFS /
 * MyScoreIQ, stored with business_profile_id NULL) that render on every tab.
 * Pass `clientVaultId` as well on surfaces that have it — it saves the lookup,
 * and it is the only way to load groups before a business tab has resolved.
 */
export function useDocumentGroups(
  businessProfileId: string | null | undefined,
  clientVaultId?: string | null,
) {
  const [groups, setGroups] = useState<DocumentGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!businessProfileId && !clientVaultId) {
      setGroups([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (businessProfileId) params.set("business_profile_id", businessProfileId);
      if (clientVaultId) params.set("client_vault_id", clientVaultId);

      const res = await fetch(`/api/document-groups?${params.toString()}`);
      if (!res.ok) throw new Error(`document groups fetch failed: ${res.status}`);
      const data = await res.json();
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (e) {
      console.error("useDocumentGroups failed:", e);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [businessProfileId, clientVaultId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Splice a newly created group in locally instead of re-fetching — the picker
   * selects it immediately after creating it, and a round trip there would
   * leave the select briefly pointing at an id its own options don't contain.
   * Idempotent: the create endpoint returns the existing row on a duplicate, so
   * adding the same group twice is a no-op.
   */
  const addGroup = useCallback((group: DocumentGroup) => {
    setGroups((prev) => (prev.some((g) => g.id === group.id) ? prev : [...prev, group]));
  }, []);

  return { groups, loading, refresh, addGroup };
}
