// Constant-time comparison for shared secrets.
//
// A plain `a !== b` returns as soon as two bytes differ, so the time it takes to
// reject a guess leaks how much of the prefix was right. That is a slow, noisy
// oracle over a network — but the secrets it protects here (GHL_WEBHOOK_SECRET,
// CRON_SECRET) are long-lived, shared with third parties, and one of them fronts
// the job that spends money. There is no reason to leave the oracle in place
// when the fix is three lines.
import { createHash, timingSafeEqual } from "crypto";

/**
 * True when both values are present and identical.
 *
 * Digests both sides to a fixed 32 bytes first: timingSafeEqual throws on a
 * length mismatch, and comparing raw inputs would leak the secret's LENGTH
 * through that exception. Hashing makes every comparison the same shape, so the
 * only thing observable is equality.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false;

  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
