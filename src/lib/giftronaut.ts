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
// Email branding: the gift email is a Giftronaut send, not one of ours, so the
// only branding lever is an email TEMPLATE (colors + banner + sender name).
// `GIFTRONAUT_TEMPLATE_ID` points at the Credit Banc template; unset, Giftronaut
// falls back to the org default (Giftronaut's own palette). The template is
// created/updated by `ensureCreditBancTemplate()` — a deliberate admin action,
// never something the payout path does on the fly.
//
// Env: GIFTRONAUT_CLIENT_ID, GIFTRONAUT_CLIENT_SECRET (required),
//      GIFTRONAUT_PRODUCT_ID (optional — a choice-card design id; if unset we
//        auto-resolve one from the catalog),
//      GIFTRONAUT_TEMPLATE_ID (optional — the CB-branded email template),
//      GIFTRONAUT_BASE (default https://api.giftronaut.com),
//      GIFTRONAUT_SENDER_NAME (optional).

const BASE = process.env.GIFTRONAUT_BASE ?? "https://api.giftronaut.com";

/**
 * Scopes for the money path. Kept minimal and SEPARATE from the template
 * scopes: if the credential was never granted `templates.*`, asking for them
 * here could fail the token request and take payouts down with it.
 */
const ORDER_SCOPES = "orders.write orders.read catalog.read";
/** Template management (the admin/CLI path only). */
const TEMPLATE_SCOPES = "templates.read templates.write";

// Module-level caches. Token expires_in is ~24h; we refresh a minute early.
// Keyed by scope string — the order token and the template token are distinct
// grants and must not evict each other.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
let cachedProductId: string | null = null;

async function getAccessToken(scope: string = ORDER_SCOPES): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
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
    scope,
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
  const token = data.access_token as string;
  tokenCache.set(scope, { token, expiresAt: Date.now() + expiresInMs });
  return token;
}

/**
 * Resolve the choice-card product id to order. Prefers GIFTRONAUT_PRODUCT_ID;
 * otherwise picks a choice-card product from the catalog whose allowed balance
 * range covers `amount` (falling back to the first available product).
 */
async function resolveChoiceProductId(amount: number): Promise<string> {
  const envId = process.env.GIFTRONAUT_PRODUCT_ID;
  if (envId) return envId;

  // No explicit product id. Against the LIVE account, auto-resolving means we
  // order whatever the catalog happens to return — so it is opt-in only. Set
  // GIFTRONAUT_PRODUCT_ID in every environment that spends real money; the
  // fallback exists for sandbox convenience and must be enabled deliberately.
  if (process.env.GIFTRONAUT_ALLOW_CATALOG_FALLBACK !== "true") {
    throw new Error(
      "GIFTRONAUT_PRODUCT_ID is not set. Set it to the choice-card product you intend to send " +
        "(or set GIFTRONAUT_ALLOW_CATALOG_FALLBACK=true to auto-resolve from the catalog — sandbox only)."
    );
  }

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

  // Only the fields we actually read — the catalog response is external and its
  // shape varies, so everything here is optional.
  type CatalogProduct = {
    productId?: string | number;
    id?: string | number;
    prices?: unknown;
  };

  const data = await res.json();
  const products: CatalogProduct[] = Array.isArray(data)
    ? data
    : data.products ?? data.data ?? data.items ?? [];
  if (!products.length) {
    throw new Error("No Giftronaut choice-card products available in the catalog");
  }

  // Require a product whose [min, max] range actually covers the reward amount.
  // The old `?? products[0]` fallback would happily order an unrelated product
  // when nothing matched — never guess when the order costs real money.
  const covers = (p: CatalogProduct) => {
    const prices = Array.isArray(p?.prices) ? (p.prices as (number | null)[]) : [];
    const min = prices[0];
    const max = prices[1];
    return (min == null || amount >= min) && (max == null || amount <= max);
  };
  const pick = products.find(covers);
  if (!pick) {
    throw new Error(
      `No Giftronaut choice-card product covers $${amount}. Set GIFTRONAUT_PRODUCT_ID explicitly.`
    );
  }
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
  const templateId = process.env.GIFTRONAUT_TEMPLATE_ID?.trim() || null;

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
        // Credit Banc palette. Omitted when unset, which lets Giftronaut apply
        // the org default template rather than erroring on an empty string.
        ...(templateId ? { templateId } : {}),
      },
      sendTiming: { type: "IMMEDIATE" },
      // Explicit even though it is the default: the affiliate keeps the full
      // 180-day expiry. The refund windows (30/60/90) claw back a share of
      // unredeemed funds and shorten the card's life — wrong trade for a $500
      // thank-you we already told them was coming.
      refundOption: false,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Giftronaut order failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Giftronaut's response shape varies: the id may be flat, nested under
  // `order`/`data`, and named orderId / orderNumber / id. The choice-card email
  // surfaces it as an "OT…" order number, so accept any of these.
  const order = data?.order ?? data?.data ?? data;
  const orderId =
    order?.orderId ??
    order?.orderNumber ??
    order?.id ??
    data?.orderId ??
    data?.orderNumber ??
    null;
  const status = order?.status ?? data?.status ?? null;
  return { orderId: orderId != null ? String(orderId) : null, status: status ?? null };
}

// ---------------------------------------------------------------------------
// Email templates — making the gift email look like ours
// ---------------------------------------------------------------------------
//
// The gift card email is sent by Giftronaut, so we cannot hand it our own HTML.
// What a template controls: sender name, default message, banner alignment and
// size, border color, and the CTA button's fill + text color.
//
// The LOGO is deliberately NOT settable over the API (Giftronaut fixes it to
// their own mark for security) — it has to be uploaded once in the Giftronaut
// portal. Everything else below matches the marketing site: navy border, mint
// button with navy text, which is the same CTA pairing as creditbanc.io.

export type GiftTemplateSpec = {
  name: string;
  senderName: string;
  message?: string;
  imageAlignment?: "left" | "center" | "right";
  imageSize?: number;
  borderColor?: string;
  buttonColor?: string;
  buttonFontColor?: string;
};

export type GiftTemplate = GiftTemplateSpec & { templateId: string; isDefault?: boolean };

/** The Credit Banc template. `name` is the lookup key for create-or-update. */
export function creditBancTemplateSpec(): GiftTemplateSpec {
  return {
    name: "Credit Banc",
    senderName: process.env.GIFTRONAUT_SENDER_NAME ?? "Credit Banc",
    message:
      "Thanks for the introduction — your referral funded through Credit Banc. " +
      "Pick whichever gift card you want.",
    imageAlignment: "center",
    imageSize: 40,
    borderColor: "#202536", // --cb-navy
    buttonColor: "#55cf9e", // --cb-mint
    buttonFontColor: "#202536", // navy on mint — the site's primary CTA
  };
}

/** Shared request helper for the template endpoints. Throws on non-2xx. */
async function templateFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken(TEMPLATE_SCOPES);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Giftronaut ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  // DELETE returns 204 No Content.
  if (res.status === 204) return null;
  return res.json();
}

/** Normalize one template row — the API names the id `templateId` or `id`. */
function toTemplate(raw: Record<string, unknown>): GiftTemplate {
  const id = raw.templateId ?? raw.id;
  return {
    ...(raw as unknown as GiftTemplateSpec),
    templateId: id != null ? String(id) : "",
  };
}

/** Every template on the org. The default template is returned first. */
export async function listTemplates(): Promise<GiftTemplate[]> {
  const data = (await templateFetch("/api/v1/templates?pageSize=100")) as Record<string, unknown>;
  const rows = Array.isArray(data)
    ? data
    : ((data?.templates ?? data?.data ?? data?.items ?? []) as Record<string, unknown>[]);
  return rows.map(toTemplate);
}

export async function getTemplate(templateId: string): Promise<GiftTemplate> {
  const data = (await templateFetch(`/api/v1/templates/${templateId}`)) as Record<string, unknown>;
  const row = (data?.template ?? data?.data ?? data) as Record<string, unknown>;
  return toTemplate(row);
}

export async function createTemplate(spec: GiftTemplateSpec): Promise<GiftTemplate> {
  const data = (await templateFetch("/api/v1/templates", {
    method: "POST",
    body: JSON.stringify(spec),
  })) as Record<string, unknown>;
  const row = (data?.template ?? data?.data ?? data) as Record<string, unknown>;
  return toTemplate(row);
}

/** PUT replaces every field, so always send the full spec. */
export async function updateTemplate(
  templateId: string,
  spec: GiftTemplateSpec
): Promise<GiftTemplate> {
  const data = (await templateFetch(`/api/v1/templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify(spec),
  })) as Record<string, unknown>;
  const row = (data?.template ?? data?.data ?? data) as Record<string, unknown>;
  return toTemplate({ templateId, ...row });
}

/**
 * Create-or-update the Credit Banc template and return its id — idempotent, so
 * re-running it after a brand tweak repaints the existing template instead of
 * piling up duplicates. Matching is by `name`, the only stable handle the API
 * gives us.
 *
 * NOT called from the payout path: the send reads GIFTRONAUT_TEMPLATE_ID and
 * nothing else, so a template outage can never delay or alter a gift card.
 */
export async function ensureCreditBancTemplate(): Promise<{
  template: GiftTemplate;
  created: boolean;
}> {
  const spec = creditBancTemplateSpec();
  const existing = (await listTemplates()).find(
    (t) => t.name?.trim().toLowerCase() === spec.name.toLowerCase()
  );

  if (existing?.templateId) {
    return { template: await updateTemplate(existing.templateId, spec), created: false };
  }
  return { template: await createTemplate(spec), created: true };
}

/**
 * Send a preview of the gift email to an address you control. Never charges the
 * balance and never appears in order history; personalization variables render
 * as placeholders. Daily limit ~10. Choice cards only.
 */
export async function sendGiftTestEmail(args: {
  email: string;
  amount: number;
  productId?: string;
  templateId?: string | null;
  subject?: string;
  message?: string;
  senderName?: string;
}): Promise<{ sentTo: string; status: string; remainingToday: number | null }> {
  const token = await getAccessToken();
  const productId = args.productId ?? (await resolveChoiceProductId(args.amount));
  const templateId =
    args.templateId === undefined
      ? process.env.GIFTRONAUT_TEMPLATE_ID?.trim() || null
      : args.templateId;

  const res = await fetch(`${BASE}/api/v1/orders/test-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email: args.email,
      productId,
      amount: args.amount,
      emailSubject: args.subject ?? "You've earned a reward — choose your gift! 🎉",
      senderName: args.senderName ?? process.env.GIFTRONAUT_SENDER_NAME ?? "Credit Banc",
      emailMessage: args.message ?? "Thanks for your referral — pick the gift card you want.",
      ...(templateId ? { templateId } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Giftronaut test email failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return {
    sentTo: data?.sentTo ?? args.email,
    status: data?.status ?? "SENT",
    remainingToday: data?.remainingToday ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reward links — a claim URL we deliver in OUR email
// ---------------------------------------------------------------------------
//
// A choice-card ORDER makes Giftronaut email the recipient. A REWARD LINK order
// takes no recipient at all: it mints redemption URLs and sends nothing, so the
// affiliate gets exactly one email — ours — with a claim button. Same choice
// card at the other end (cardType CHOICE_CARD + the same productId); only the
// delivery envelope changes.
//
// Two things make this path different from the order path, and both are traps:
//
//   1. It is ASYNCHRONOUS. The POST returns `PENDING` and the URL only exists
//      once `GET /orders/{orderId}` reports `COMPLETE`. Money is deducted at
//      POST time, so a caller that treats "no link yet" as failure will retry a
//      charge that already happened.
//   2. Its idempotency behaviour is INVERTED. A duplicate choice-card key
//      returns the original order with 200; a duplicate reward-link key returns
//      **409** carrying the original orderId. 409 here means "you already paid
//      for this" — recover the id and poll it, never surface it as an error.
//
// The link is a BEARER instrument: no recipient OTP, so whoever opens it claims
// the balance. Only ever deliver it to the affiliate's on-file address, and keep
// it out of list views and logs.

export type RewardLinkOrder = { orderId: string; status: string; rewardLink: string | null };

/** Pull an order id out of whatever envelope the API used. */
function readOrderId(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  const nested = (p?.order ?? p?.data ?? p) as Record<string, unknown> | undefined;
  const id = nested?.orderId ?? nested?.orderNumber ?? nested?.id ?? p?.orderId;
  return id != null ? String(id) : null;
}

/**
 * Place a reward-link order. Returns the order id; the URL is NOT ready yet.
 * A 409 (duplicate idempotency key) resolves to the original order rather than
 * throwing — that is the retry-safety of the whole flow.
 */
export async function createRewardLinkOrder(args: {
  amount: number;
  idempotencyKey: string;
  quantity?: number;
  productId?: string;
}): Promise<{ orderId: string; status: string; duplicate: boolean }> {
  const token = await getAccessToken();
  const productId = args.productId ?? (await resolveChoiceProductId(args.amount));

  const res = await fetch(`${BASE}/api/v1/orders/reward-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      idempotencyKey: args.idempotencyKey,
      cardType: "CHOICE_CARD",
      productId,
      quantity: args.quantity ?? 1,
      amountPerLink: args.amount,
      // Full 180-day expiry, no claw-back — same call as the order path.
      refundOption: false,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (res.status === 409) {
    const existing = readOrderId(payload);
    if (existing) return { orderId: existing, status: "PENDING", duplicate: true };
    // A 409 we cannot resolve is worse than a plain failure: the charge may
    // already exist and we have no id to poll. Say so loudly.
    throw new Error(
      `Giftronaut reward-link 409 for key ${args.idempotencyKey} but no orderId in the response: ${text}`
    );
  }

  if (!res.ok) {
    throw new Error(`Giftronaut reward-link order failed: ${res.status} ${text}`);
  }

  const orderId = readOrderId(payload);
  if (!orderId) {
    throw new Error(`Giftronaut reward-link order returned no orderId: ${text}`);
  }
  const status = ((payload as Record<string, unknown>)?.status ??
    ((payload as Record<string, unknown>)?.data as Record<string, unknown>)?.status ??
    "PENDING") as string;
  return { orderId, status: String(status), duplicate: false };
}

/** Fetch one order. Used to poll a reward-link order to COMPLETE. */
export async function getOrder(orderId: string): Promise<{
  status: string;
  rewardLink: string | null;
  raw: unknown;
}> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Giftronaut order lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const order = (data?.order ?? data?.data ?? data) as Record<string, unknown>;
  const recipients = Array.isArray(order?.recipients)
    ? (order.recipients as Record<string, unknown>[])
    : [];
  const link = recipients.map((r) => r?.rewardLink).find((l) => typeof l === "string" && l);
  return {
    status: String(order?.status ?? "UNKNOWN"),
    rewardLink: (link as string) ?? null,
    raw: data,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll an existing reward-link order until its URL exists. Returns
 * `rewardLink: null` on timeout — NOT an error: the order is placed and paid
 * for, the link simply is not minted yet, and the caller must park the row and
 * resume later rather than re-ordering.
 */
export async function pollRewardLink(
  orderId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<RewardLinkOrder> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  let last: { status: string; rewardLink: string | null } = { status: "PENDING", rewardLink: null };
  for (;;) {
    last = await getOrder(orderId);
    if (last.rewardLink) return { orderId, status: last.status, rewardLink: last.rewardLink };
    // CANCELED/FAILED are terminal — stop burning the window on them.
    if (/^(CANCELED|CANCELLED|FAILED)$/i.test(last.status)) {
      throw new Error(`Giftronaut order ${orderId} ended as ${last.status} with no reward link`);
    }
    if (Date.now() + intervalMs >= deadline) break;
    await sleep(intervalMs);
  }
  return { orderId, status: last.status, rewardLink: null };
}

/**
 * Order a reward link and wait briefly for its URL. `idempotencyKey` must be
 * stable per logical payout (the payout row id), so a retry recovers the
 * original order instead of buying a second card.
 */
export async function claimRewardLink(args: {
  amount: number;
  idempotencyKey: string;
  timeoutMs?: number;
}): Promise<RewardLinkOrder> {
  const { orderId } = await createRewardLinkOrder({
    amount: args.amount,
    idempotencyKey: args.idempotencyKey,
  });
  return await pollRewardLink(orderId, { timeoutMs: args.timeoutMs });
}
