// src/lib/post-funding/unsubscribe.ts
//
// Opt-out for the post-funding sequence. Emails 5 and 8 promote the affiliate
// program, which makes the sequence commercial mail — it has to carry a working
// unsubscribe (CAN-SPAM), and Gmail/Yahoo bulk-sender rules want one-click
// List-Unsubscribe on top.
//
// The token is stateless: `<client_vault_id>.<hmac>`. Nothing to store or
// expire, and it can only ever opt out the client it was minted for. Opting out
// stamps client_data_vault.post_funding_unsubscribed_at, which stops every
// round's sequence for that client — and nothing else.

import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { secretsMatch } from "@/lib/secret-compare";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  // CRON_SECRET is always set where this runs (the cron refuses to start
  // without it); a dedicated secret can take over without changing callers.
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("EMAIL_UNSUBSCRIBE_SECRET / CRON_SECRET is not set — cannot sign unsubscribe links");
  return s;
}

function sign(clientVaultId: string): string {
  return createHmac("sha256", secret())
    .update(`post-funding-unsubscribe:${clientVaultId.toLowerCase()}`)
    .digest("base64url")
    .slice(0, 32);
}

export function makeUnsubscribeToken(clientVaultId: string): string {
  return `${clientVaultId}.${sign(clientVaultId)}`;
}

/** The client vault id the token was minted for, or null if it doesn't verify. */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const [id, sig] = String(token ?? "").split(".");
  if (!id || !sig || !UUID_RE.test(id)) return null;
  try {
    return secretsMatch(sig, sign(id)) ? id : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrls(clientVaultId: string, appUrl: string) {
  const token = makeUnsubscribeToken(clientVaultId);
  return {
    /** Human page with a confirm button (GET-safe against link scanners). */
    page: `${appUrl}/unsubscribe/${token}`,
    /** RFC 8058 one-click endpoint for the List-Unsubscribe header. */
    oneClick: `${appUrl}/api/unsubscribe/${token}`,
  };
}

/** Stamp the opt-out. Idempotent — an earlier stamp is kept. */
export async function unsubscribeClient(db: SupabaseClient, clientVaultId: string): Promise<boolean> {
  const { error } = await db
    .from("client_data_vault")
    .update({ post_funding_unsubscribed_at: new Date().toISOString() })
    .eq("id", clientVaultId)
    .is("post_funding_unsubscribed_at", null);
  if (error) {
    console.error("[post-funding] unsubscribe failed:", error);
    return false;
  }
  return true;
}
