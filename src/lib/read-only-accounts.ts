// src/lib/read-only-accounts.ts
//
// Read-only staff accounts: they can open and read every file they follow,
// and change nothing. Exists for the AVA bot, which follows every deal (see
// migration 20261030_ava_bot_follows_all_deals) so it can watch status, but
// must never act on a file.
//
// Enforced in three places:
//   1. src/proxy.ts — mutating /api/* requests are refused (except the few
//      read-only POST endpoints listed there).
//   2. assertNotReadOnly() — first line of every client-file server action
//      that writes.
//   3. The database — advisors.read_only + restrictive RLS policies, which
//      also covers the browser-side writes (bank analysis, lender match).
//
// Keyed by auth user id (users.id). Keep in sync with advisors.read_only.

// No top-level server-only imports: src/proxy.ts imports isReadOnlyUser.

const READ_ONLY_USER_IDS = new Set<string>([
  // AVA Bot (matt+ava@mrmcapitalgroup.com) — advisors.id 598d0589-abac-4b07-97cb-5762219f5010
  "d6d9d9b7-6eb8-4135-b697-0690659a2cca",
]);

export function isReadOnlyUser(userId: string | null | undefined): boolean {
  return !!userId && READ_ONLY_USER_IDS.has(userId);
}

export const READ_ONLY_ERROR = "This account is read-only and can't make changes.";

/** Throws when the signed-in user is a read-only account. Call before any write. */
export async function assertNotReadOnly(): Promise<void> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isReadOnlyUser(user?.id)) throw new Error(READ_ONLY_ERROR);
}
