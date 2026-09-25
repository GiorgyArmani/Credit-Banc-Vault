// src/lib/lender-api/connected.ts
//
// "Which lenders can we submit to by API?" — for the lender list surfaces
// (Lender Match, the lender database). BROWSER-SAFE: no provider modules and no
// env reads here. The server builds the map with providerForLender (the same
// lookup the submit button uses, so a badge can never promise an API the
// button won't offer) and serves it from GET /api/lender-api/connected.

export interface ConnectedLender {
  provider_id: string;
  display_name: string;
}

/** Keyed by lenderKey(lender_name). */
export type ConnectedLenders = Record<string, ConnectedLender>;

/** Providers match lender names trimmed and case-insensitively; key the same way. */
export function lenderKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function buildConnectedLenders(
  names: ReadonlyArray<string | null | undefined>,
  lookup: (name: string) => { id: string; displayName: string } | null
): ConnectedLenders {
  const out: ConnectedLenders = {};
  for (const name of names) {
    const key = lenderKey(name);
    if (!key || out[key]) continue;
    const provider = lookup(name as string);
    if (provider) out[key] = { provider_id: provider.id, display_name: provider.displayName };
  }
  return out;
}

export function connectedLender(map: ConnectedLenders, name: string | null | undefined): ConnectedLender | null {
  return map[lenderKey(name)] ?? null;
}

/**
 * Lender Match order: eligible first, then API-connected, then fewest issues.
 * The API boost stays INSIDE eligibility — a lender that fails the deal must
 * never outrank one that passes just because it is easier to submit to.
 */
export function compareLenderMatches(
  a: { passed: boolean; flagCount: number; api: boolean },
  b: { passed: boolean; flagCount: number; api: boolean }
): number {
  if (a.passed !== b.passed) return a.passed ? -1 : 1;
  if (a.api !== b.api) return a.api ? -1 : 1;
  return a.flagCount - b.flagCount;
}
