import SpeedClientSignUpForm from "@/components/speed-client-sign-up-form";

/**
 * Setter Dashboard — create-only fast-funding client creation.
 *
 * Appointment setters use this to spin up a client (vault) on the speed/fast
 * funding flow while on the call. The created client is assigned to the advisor
 * linked on the setter's users.setter_advisor_id (resolved server-side in
 * /api/client-signup-speed) — the setter never picks the advisor.
 *
 * Same SpeedClientSignUpForm the advisor/admin speed pages use, but in setter
 * mode (isSetter): a trimmed 2-step form (Business → Funding) with no documents
 * step and no loan-type picker. Documents auto-set to business bank statements
 * and the proposed loan type to "other" — the assigned advisor refines the
 * client afterward. The advisor/admin speed form is unaffected.
 *
 * LOCATION: /setter/dashboard
 */
export default function SetterDashboardPage() {
  return <SpeedClientSignUpForm isSetter />;
}
