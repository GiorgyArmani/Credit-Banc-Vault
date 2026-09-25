//
// Every lender we can submit to by API. To add one: build its provider module
// under ./providers/<lender>/ and append it here (and to ProviderId in types.ts).
// Lookups only return CONFIGURED providers, so an unset env var hides the
// feature everywhere — button, routes, webhook.

import type { LenderApiProvider } from "./types";
import { forwardFinancing } from "./providers/forward-financing";
import { credibly } from "./providers/credibly";
import { bitty } from "./providers/bitty";
import { loot } from "./providers/loot";
import { fundkite } from "./providers/fundkite";

const PROVIDERS: readonly LenderApiProvider[] = [forwardFinancing, credibly, bitty, loot, fundkite];

export function providerForLender(lenderName: string | null | undefined): LenderApiProvider | null {
  if (!lenderName) return null;
  const provider = PROVIDERS.find((p) => p.matchesLender(lenderName));
  return provider && provider.isConfigured() ? provider : null;
}

export function getProvider(id: string | null | undefined): LenderApiProvider | null {
  if (!id) return null;
  const provider = PROVIDERS.find((p) => p.id === id);
  return provider && provider.isConfigured() ? provider : null;
}
