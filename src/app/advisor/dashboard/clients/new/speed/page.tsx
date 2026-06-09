import SpeedClientSignUpForm from "@/components/speed-client-sign-up-form";

/**
 * Advisor-Only SPEED FORM Client Creation Page
 *
 * Fast-track alternative to /advisor/dashboard/clients/new (which is unchanged).
 *
 * WORKFLOW:
 * 1. Rep fills the one-page speed form while on the call with the client
 * 2. Client is created + receives a magic link (also surfaced to the rep)
 * 3. Client clicks the link and signs the pre-filled SignWell application
 *    during the call (onboarding Step 1 is skipped — the form collected it)
 * 4. ONLY after the signature does the document request go out
 *    (SignWell webhook → releaseSpeedFormDocs)
 *
 * LOCATION: /advisor/dashboard/clients/new/speed
 */
export default function AdvisorSpeedClientPage() {
  return <SpeedClientSignUpForm />;
}
