// src/app/partner/_components/partner-header-nav.tsx
"use client";

// Tier 1 partners have no sidebar — just these header links.

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/partner/dashboard", label: "My Referrals" },
  { href: "/partner/webinars", label: "Webinars" },
];

export function PartnerHeaderNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
            pathname?.startsWith(l.href) ? "bg-cb-navy text-white" : "text-cb-ink/70 hover:bg-black/5"
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
