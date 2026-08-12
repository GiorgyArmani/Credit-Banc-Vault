// Partner deal desk — create a client.
//
// The same form advisors use. The server resolves the advisor of record from the
// session (not from the form), so the deal lands on the partner's own advisors
// row, and the partner is auto-attributed as the referral partner for the
// commission — see src/app/api/client-signup/route.ts.

import ClientSignUpForm from "@/components/client-sign-up-form";

export default function PartnerNewClientPage() {
  return <ClientSignUpForm />;
}
