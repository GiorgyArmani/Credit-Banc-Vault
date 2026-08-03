"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { BrandAuthShell, BrandNotice, CTA } from "@/components/marketing/brand-chrome"

export default function NotFound() {
  return (
    <BrandAuthShell width="md">
      <BrandNotice
        eyebrow="Error 404"
        title={
          <>
            We can&apos;t find <span className="text-cb-mint">that page</span>
          </>
        }
        actions={
          <>
            {/* Home, not /dashboard — a 404 can be hit before login. */}
            <Link href="/" className={CTA.primary}>
              Go home
            </Link>
            <button type="button" onClick={() => window.history.back()} className={CTA.ghost}>
              <ArrowLeft className="h-4 w-4" />
              Go back
            </button>
          </>
        }
      >
        <p>It either never existed or it has moved somewhere else.</p>
      </BrandNotice>
    </BrandAuthShell>
  )
}
