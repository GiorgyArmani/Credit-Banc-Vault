// src/lib/giftronaut.ts
//
// Thin adapter over the Giftronaut gift-card API, used to pay affiliates when a
// referral gets funded. We send a CHOICE CARD so the affiliate picks whichever
// gift card they want (Amazon, Visa, etc.) instead of a fixed brand.
//
// Auth: OAuth2 client-credentials (client_id + client_secret) → Bearer token.
// Order: POST /api/v1/orders/choice-cards with a choice-card `productId`.
// Idempotency-Key = the payout row id, so a retried funded event never
// double-sends.
//
// Env: GIFTRONAUT_CLIENT_ID, GIFTRONAUT_CLIENT_SECRET (required),
//      GIFTRONAUT_PRODUCT_ID (optional — a choice-card design id; if unset we
//        auto-resolve one from the catalog),
//      GIFTRONAUT_BASE (default https://api.giftronaut.com),
//      GIFTRONAUT_SENDER_NAME (optional).

const BASE = process.env.GIFTRONAUT_BASE ?? "https://api.giftronaut.com";

// Module-level caches. Token expires_in is ~24h; we refresh a minute early.
let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedProductId: string | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.GIFTRONAUT_CLIENT_ID;
  const clientSecret = process.env.GIFTRONAUT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GIFTRONAUT_CLIENT_ID / GIFTRONAUT_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    // catalog.read lets us auto-resolve a choice-card product when none is set.
    scope: "orders.write orders.read catalog.read",
  });

  const res = await fetch(`${BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Giftronaut token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + expiresInMs };
  return cachedToken.token;
}

/**
 * Resolve the choice-card product id to order. Prefers GIFTRONAUT_PRODUCT_ID;
 * otherwise picks a choice-card product from the catalog whose allowed balance
 * range covers `amount` (falling back to the first available product).
 */
async function resolveChoiceProductId(amount: number): Promise<string> {
  const envId = process.env.GIFTRONAUT_PRODUCT_ID;
  if (envId) return envId;
  if (cachedProductId) return cachedProductId;

  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/v1/catalog/choice-cards`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Giftronaut catalog lookup failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const products: any[] = Array.isArray(data)
    ? data
    : data.products ?? data.data ?? data.items ?? [];
  if (!products.length) {
    throw new Error("No Giftronaut choice-card products available in the catalog");
  }

  // Prefer a product whose [min, max] range covers the reward amount.
  const covers = (p: any) => {
    const prices = Array.isArray(p?.prices) ? p.prices : [];
    const min = prices[0];
    const max = prices[1];
    return (min == null || amount >= min) && (max == null || amount <= max);
  };
  const pick = products.find(covers) ?? products[0];
  const id = pick?.productId ?? pick?.id;
  if (!id) throw new Error("Giftronaut choice-card product has no id");

  cachedProductId = String(id);
  return cachedProductId;
}

export type GiftResult = { orderId: string | null; status: string | null };

/**
 * Place an IMMEDIATE choice-card order for a single recipient — the recipient
 * chooses which gift card they want. `idempotencyKey` must be stable per logical
 * payout (use the payout row id).
 */
export async function sendGiftCard(args: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  amount: number;
  idempotencyKey: string;
  subject?: string;
  message?: string;
}): Promise<GiftResult> {
  const token = await getAccessToken();
  const productId = await resolveChoiceProductId(args.amount);

  const res = await fetch(`${BASE}/api/v1/orders/choice-cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": args.idempotencyKey,
    },
    body: JSON.stringify({
      idempotencyKey: args.idempotencyKey,
      productId,
      recipients: [
        {
          firstName: args.firstName ?? undefined,
          lastName: args.lastName ?? undefined,
          email: args.email,
          amount: args.amount,
        },
      ],
      emailSetting: {
        senderName: process.env.GIFTRONAUT_SENDER_NAME ?? "Credit Banc",
        subject: args.subject ?? "You've earned a reward — choose your gift! 🎉",
        message: args.message ?? "Thanks for your referral — pick the gift card you want.",
      },
      sendTiming: { type: "IMMEDIATE" },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Giftronaut order failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return { orderId: data.orderId ?? null, status: data.status ?? null };
}
