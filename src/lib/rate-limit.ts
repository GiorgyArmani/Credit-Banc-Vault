// Rate limiting for public, unauthenticated endpoints.
//
// Backed by public.rate_limits + consume_rate_limit() (migration 20260819).
// Postgres rather than Redis: no new vendor, no new secret, and the counter
// lives beside the data it protects. See the migration header for why the
// affiliate program is what forced the issue.

import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";

export interface RateLimitRule {
  /** Stable name for the thing being limited, e.g. "refer-submit". */
  name: string;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Requests allowed per window per caller. */
  max: number;
}

/**
 * Best-effort client address.
 *
 * Vercel sets x-forwarded-for; the left-most entry is the client and the rest
 * are proxies. Behind any other host this header is spoofable, which is worth
 * knowing but does not change the calculus: an attacker willing to forge it is
 * also willing to rotate real addresses, and the limiter's job is to stop casual
 * scripted abuse, not a determined adversary. The endpoint-level limit below
 * covers the case where per-IP limiting is evaded.
 */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Hash the identifying part of the key.
 *
 * An IP address is personal data and a bare email in a bucket key would make
 * this table a directory of who applied. Hashing keeps the counter working —
 * equality is all it needs — without the table holding anything worth reading.
 * Salted with SUPABASE_SERVICE_ROLE_KEY so the digests are not a rainbow-table
 * lookup of the IPv4 space; any stable server-side secret would do.
 */
function hashIdentifier(value: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY || "rate-limit";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

/**
 * Count one request against `rule` and report whether it may proceed.
 *
 * FAILS OPEN. If the table or function is missing (the migration has not been
 * applied yet) or the database is unreachable, this returns `allowed: true` and
 * logs loudly. A limiter that fails closed would turn a schema drift into a
 * total outage of public signup — the endpoints it guards are the front door.
 * That is a deliberate trade, and the loud log is the compensating control; see
 * [[refactor_alongside_production]].
 */
export async function checkRateLimit(
  req: Request,
  rule: RateLimitRule,
  /** Extra identity beyond the IP — an affiliate code, an email. Hashed. */
  scope?: string | null
): Promise<{ allowed: boolean }> {
  const parts = [rule.name, hashIdentifier(clientIp(req))];
  if (scope) parts.push(hashIdentifier(scope));
  const bucketKey = parts.join(":");

  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_key: bucketKey,
      p_window_seconds: rule.windowSeconds,
      p_max: rule.max,
    });

    if (error) {
      console.error(
        `[rate-limit] ${rule.name} check failed, ALLOWING request:`,
        error.message
      );
      return { allowed: true };
    }

    if (data === false) {
      console.warn(
        `[rate-limit] ${rule.name} limit hit (${rule.max}/${rule.windowSeconds}s) for bucket ${bucketKey}`
      );
      return { allowed: false };
    }

    return { allowed: true };
  } catch (err) {
    console.error(`[rate-limit] ${rule.name} check threw, ALLOWING request:`, err);
    return { allowed: true };
  }
}

/**
 * The limits themselves, in one place so they can be read as a policy rather
 * than hunted for across route files.
 *
 * Sized for humans: a real applicant submits the referral form once, and a real
 * affiliate signs up once. The ceilings are generous enough to absorb a
 * double-click, a page refresh and a shared office NAT, and still far below what
 * a script needs to be worth writing.
 */
export const RATE_LIMITS = {
  /** Per IP. The expensive one: a GHL contact plus an email to the affiliate. */
  referSubmit: { name: "refer-submit", windowSeconds: 3600, max: 10 } as RateLimitRule,

  /**
   * Per referral CODE, regardless of source address. The per-IP limit above does
   * nothing against a rotating pool, and the affiliate on the receiving end is
   * the one who eats the consequence — this caps how many notifications one
   * affiliate can be made to receive in an hour, whoever is sending them.
   */
  referSubmitPerCode: { name: "refer-submit-code", windowSeconds: 3600, max: 25 } as RateLimitRule,

  /** Per IP. Creates a pre-confirmed auth user, a GHL contact and an email. */
  affiliateSignup: { name: "affiliate-signup", windowSeconds: 3600, max: 5 } as RateLimitRule,
} as const;
