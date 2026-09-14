// src/app/desk/welcome/page.tsx
//
// Where the welcome email's magic link lands. A rep who still owes onboarding
// never renders this body: /desk/layout.tsx shows the onboarding wizard as a
// TAKEOVER on every /desk URL, this one included. So by the time this renders,
// they're done — and a reused welcome link just forwards to the desk.

import { redirect } from "next/navigation";

export default function DeskWelcomePage() {
  redirect("/desk/deals");
}
