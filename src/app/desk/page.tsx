// src/app/desk/page.tsx
//
// /desk is a route prefix; the desk lands on /desk/deals. The layout above has
// already gated role, billing and onboarding.

import { redirect } from "next/navigation";

export default function DeskIndexPage() {
  redirect("/desk/deals");
}
