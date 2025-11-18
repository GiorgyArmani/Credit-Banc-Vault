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
  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-6xl mx-auto">
        {/* 
          page-header: Provides context for the advisor
          - Makes it clear this is for client creation
          - Matches the professional tone of your app
        */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Create New Client
          </h1>
          <p className="text-muted-foreground mt-2">
            Fill in client information collected during your onboarding call
          </p>
        </div>

        {/* 
          client-sign-up-form: Your existing form component
          - Same component, now in advisor-protected context
          - Middleware handles authentication automatically
          - Form will auto-detect advisor and hide dropdown
        */}
        <ClientSignUpForm />
      </div>
    </div>
  );
}