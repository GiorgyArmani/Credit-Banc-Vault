import ClientSignUpForm from "@/components/client-sign-up-form";

/**
 * Advisor-Only Client Creation Page
 * 
 * PROTECTION:
 * - This route is protected by middleware
 * - Only users with role="advisor" can access /advisor/* routes
 * - Non-advisors are automatically redirected to their dashboard
 * 
 * PURPOSE:
 * - Advisors create client accounts during onboarding calls
 * - Replaces public client self-signup
 * - Ensures data quality through advisor verification
 * 
 * WORKFLOW:
 * 1. Advisor conducts onboarding call with client
 * 2. Advisor fills in client information via this form
 * 3. Form creates client account and syncs to GHL
 * 4. Client receives login credentials via email
 * 
 * LOCATION: /advisor/clients/new
 */
export default function AdvisorNewClientPage() {
  // The surrounding admin/advisor shell already provides max-width centering,
  // horizontal padding, and vertical layout — wrapping the form in another
  // `min-h-screen flex items-center justify-center` collided with the shell
  // and pushed the form behind the sticky topbar. Render the form directly.
  return <ClientSignUpForm />;
}