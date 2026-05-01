// src/app/underwriting/lender-match/page.tsx
import { Suspense } from 'react'
import LenderMatch from '@/components/lender-match'

export default function LenderMatchPage() {
    return (
        <div className="space-y-6">
            {/* Suspense boundary required because <LenderMatch /> reads
                ?client=<id> via useSearchParams (deep-link from client view). */}
            <Suspense fallback={<div className="p-10 text-center text-slate-400 text-sm">Loading lender match…</div>}>
                <LenderMatch dealSummary={{}} />
            </Suspense>
        </div>
    )
}
