// src/app/auth/join/page.tsx
//
// The single entry point for every staff invitation. The email links here; we
// resolve the token, read the ROLE off the invitation, and forward to that
// role's onboarding form.
//
// One URL for all three roles on purpose: the role is a property of the
// invitation, not something an admin picks a link for. Emailing
// /auth/advisor-signup?token=… directly would work, but it puts the role in a
// place a human can get wrong, and a mismatch is refused at redemption anyway —
// so the invitee would just hit a wall for no reason.
//
// Resolving is READ-ONLY. Rendering a page must never burn a single-use token,
// or a refresh would lock someone out of their own onboarding.

import { redirect } from "next/navigation";
import { resolveStaffInvite } from "@/lib/auth/staff-invite";
import { SIGNUP_PATH_BY_ROLE } from "@/lib/auth/staff-invite-shared";
import { InviteRequiredCard } from "@/components/auth/invite-required-card";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = await resolveStaffInvite(token);

  if (!result.ok) {
    return (
      <InviteRequiredCard
        title={result.state === "expired" ? "This invitation expired" : "Invitation not valid"}
        message={result.reason}
      />
    );
  }

  redirect(
    `${SIGNUP_PATH_BY_ROLE[result.invite.role]}?token=${encodeURIComponent(token as string)}`
  );
}
