// src/app/affiliate/layout.tsx
//
// Pass-through layout. The role gate + dashboard chrome live in the nested
// /affiliate/dashboard/layout.tsx so that the public /affiliate signup page
// (this segment's index) stays reachable by anyone. See [[role_model]].

export default function AffiliateLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
