// src/app/underwriting/bank-analysis/page.tsx
import { Suspense } from 'react'
import BankAnalysis from '@/components/bank-analysis'

export default function BankAnalysisPage() {
    return (
        <div className="space-y-6">
            {/* Suspense boundary required because <BankAnalysis /> reads
                ?client=<id> via useSearchParams (deep-link from client view). */}
            <Suspense fallback={<div className="p-10 text-center text-slate-400 text-sm">Loading bank analysis…</div>}>
                <BankAnalysis />
            </Suspense>
        </div>
    )
}
