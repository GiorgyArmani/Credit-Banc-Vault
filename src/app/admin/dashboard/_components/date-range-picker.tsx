// src/app/admin/dashboard/_components/date-range-picker.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Calendar, ChevronDown, Loader2 } from 'lucide-react'
import clsx from 'clsx'

const PRESETS: Array<{ key: string; label: string }> = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'mtd', label: 'MTD' },
  { key: 'qtd', label: 'QTD' },
  { key: 'ytd', label: 'YTD' },
]

export function DateRangePicker() {
  const router = useRouter()
  const params = useSearchParams()
  const [is_pending, start_transition] = useTransition()
  const current = params.get('range') ?? '30d'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const is_custom = !!(from && to)

  const [custom_open, set_custom_open] = useState(false)
  const [draft_from, set_draft_from] = useState(from)
  const [draft_to, set_draft_to] = useState(to)

  const apply_preset = (key: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('range', key)
    next.delete('from')
    next.delete('to')
    start_transition(() => router.push(`?${next.toString()}`, { scroll: false }))
  }

  const apply_custom = () => {
    if (!draft_from || !draft_to) return
    const next = new URLSearchParams(params.toString())
    next.delete('range')
    next.set('from', draft_from)
    next.set('to', draft_to)
    set_custom_open(false)
    start_transition(() => router.push(`?${next.toString()}`, { scroll: false }))
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="bg-white border border-slate-200 rounded-xl p-1 flex shadow-sm">
        {PRESETS.map((p) => {
          const active = !is_custom && current === p.key
          return (
            <button
              key={p.key}
              onClick={() => apply_preset(p.key)}
              disabled={is_pending}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                active
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
                is_pending && 'opacity-50 cursor-not-allowed'
              )}
            >
              {p.label}
            </button>
          )
        })}

        <div className="relative">
          <button
            onClick={() => set_custom_open((v) => !v)}
            disabled={is_pending}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1',
              is_custom
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            )}
          >
            <Calendar className="h-3 w-3" />
            {is_custom ? `${from} → ${to}` : 'Custom'}
            <ChevronDown className="h-3 w-3" />
          </button>

          {custom_open && (
            <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-4 space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">From</label>
                <input
                  type="date"
                  value={draft_from}
                  onChange={(e) => set_draft_from(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">To</label>
                <input
                  type="date"
                  value={draft_to}
                  onChange={(e) => set_draft_to(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
              <button
                onClick={apply_custom}
                disabled={!draft_from || !draft_to || is_pending}
                className="w-full bg-emerald-500 text-white text-xs font-bold py-2 rounded-lg hover:bg-emerald-600 disabled:opacity-40 transition-colors"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {is_pending && <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />}
    </div>
  )
}
