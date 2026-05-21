// src/app/admin/dashboard/_components/funded-sparkline.tsx
'use client'

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface SeriesPoint {
  date: string
  amount: number
  count: number
}

const fmt_money = (v: number) => `$${Math.round(v).toLocaleString()}`

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.[0]) return null
  const p = payload[0].payload as SeriesPoint
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-slate-900 mb-0.5">{label}</p>
      <p className="text-emerald-600 font-bold">{fmt_money(p.amount)}</p>
      <p className="text-slate-500">{p.count} {p.count === 1 ? 'deal' : 'deals'}</p>
    </div>
  )
}

export function FundedSparkline({ data }: { data: SeriesPoint[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0)
  const max = Math.max(0, ...data.map((d) => d.amount))

  if (total === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-slate-400 italic">
        No funding events in this range.
      </div>
    )
  }

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="funded-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis hide domain={[0, max * 1.1 || 1]} />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="amount"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#funded-grad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
