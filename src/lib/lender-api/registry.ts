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
import { smartbiz } from "./providers/smartbiz";
import { onewest } from "./providers/onewest";
import { idea } from "./providers/idea";
import { vital } from "./providers/vital";
import { arf } from "./providers/arf";
import { pirs } from "./providers/pirs";
import { samson } from "./providers/samson";
import { yesLeasing } from "./providers/yes-leasing";

const PROVIDERS: readonly LenderApiProvider[] = [forwardFinancing, credibly, bitty, loot, fundkite, smartbiz, onewest, idea, vital, arf, pirs, samson, yesLeasing];

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
