// src/app/admin/dashboard/_components/conversion-funnel.tsx
'use client'

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ReactNode } from 'react'

interface FunnelStage {
  stage: string
  label: string
  count: number
  pct_of_top: number
  pct_step: number | null
}

const STAGE_COLOR = [
  '#34d399',
  '#10b981',
  '#059669',
  '#047857',
  '#065f46',
  '#064e3b',
  '#022c22',
]

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const p = payload[0].payload as FunnelStage
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-slate-900">{p.label}</p>
      <p className="text-emerald-600 font-bold">{p.count} clients · {p.pct_of_top.toFixed(0)}% of top</p>
      {p.pct_step !== null && (
        <p className="text-slate-500">{p.pct_step.toFixed(0)}% from previous stage</p>
      )}
    </div>
  )
}

export function ConversionFunnel({ data }: { data: FunnelStage[] }) {
  if (!data.length || data[0].count === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-400 italic">
        No clients created in this range yet.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 60, bottom: 0, left: 100 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: '#475569', fontWeight: 700 }}
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="count" radius={[0, 8, 8, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={STAGE_COLOR[i % STAGE_COLOR.length]} />
            ))}
            <LabelList
              dataKey="pct_of_top"
              position="right"
              style={{ fontSize: 11, fontWeight: 700, fill: '#0f172a' }}
              formatter={((label: ReactNode) => {
                const n = typeof label === 'number' ? label : Number(label)
                if (!isFinite(n)) return ''
                return `${n.toFixed(0)}%`
              }) as (label: ReactNode) => ReactNode}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
