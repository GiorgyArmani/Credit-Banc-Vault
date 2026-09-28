// Who may edit a client's profile (EditProfileModal → updateClientProfile /
// updateBusinessProfile). Underwriting handles a file once it's submitted to
// them and must be able to correct it; they have no advisors row, so the
// advisor owner/follower check alone would always reject them.

export const PROFILE_EDITOR_STAFF_ROLES = ["admin", "underwriting"] as const;

export function canEditClientProfile(args: {
  role: string | null | undefined;
  advisorId: string | null;
  ownerAdvisorId: string | null;
  isFollower: boolean;
}): boolean {
  if (args.role && (PROFILE_EDITOR_STAFF_ROLES as readonly string[]).includes(args.role)) return true;
  if (!args.advisorId) return false;
  if (args.ownerAdvisorId && args.ownerAdvisorId === args.advisorId) return true;
  return args.isFollower;
}
