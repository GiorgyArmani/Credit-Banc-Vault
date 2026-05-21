// src/app/admin/dashboard/_components/advisor-filter.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Users } from 'lucide-react'
import clsx from 'clsx'

interface AdvisorOption {
  id: string
  name: string
}

export function AdvisorFilter({ advisors }: { advisors: AdvisorOption[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const [is_pending, start_transition] = useTransition()
  const current = params.get('advisor') ?? ''

  const apply = (advisor_id: string) => {
    const next = new URLSearchParams(params.toString())
    if (advisor_id) next.set('advisor', advisor_id)
    else next.delete('advisor')
    start_transition(() => router.push(`?${next.toString()}`, { scroll: false }))
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-2.5 py-1 flex items-center gap-2 shadow-sm">
      <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <select
        value={current}
        onChange={(e) => apply(e.target.value)}
        disabled={is_pending}
        className={clsx(
          'bg-transparent text-xs font-bold text-slate-700 pr-1 py-1 focus:outline-none cursor-pointer max-w-[180px]',
          is_pending && 'opacity-50 cursor-not-allowed',
        )}
      >
        <option value="">All advisors</option>
        {advisors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
