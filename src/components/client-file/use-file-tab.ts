"use client";

// Active tab, mirrored into ?tab= so a file can be deep-linked to a tab and a
// refresh lands where you were. Uses window.history.replaceState, which Next 16
// integrates with its router (docs: 01-app/01-getting-started/04-linking-and-navigating.md).
// Reads window.location on mount instead of useSearchParams() so the large
// client components using this don't need a Suspense boundary.

import { useCallback, useEffect, useState } from "react";
import type { ClientFileTab } from "./capabilities";
import { resolveTab, withTabParam } from "./tab-param";

export function useFileTab(allowed: readonly ClientFileTab[]) {
  const [tab, set_tab] = useState<ClientFileTab>("overview");
  const allowed_key = allowed.join(",");

  useEffect(() => {
    set_tab(resolveTab(new URLSearchParams(window.location.search).get("tab"), allowed));
    // allowed_key captures the list's contents; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed_key]);

  const change_tab = useCallback((next: ClientFileTab) => {
    set_tab(next);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${withTabParam(search, next)}${hash}`);
  }, []);

  return [tab, change_tab] as const;
}
