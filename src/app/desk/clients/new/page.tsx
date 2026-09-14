// Partner+ desk — create a client.
//
// The same form advisors use. The server resolves the advisor of record from the
// session, so the deal lands on the rep's own advisors row, and internal
// oversight attaches because that row is is_external — see
// src/app/api/client-signup/route.ts.

import ClientSignUpForm from "@/components/client-sign-up-form";

export default function DeskNewClientPage() {
  return <ClientSignUpForm />;
}
