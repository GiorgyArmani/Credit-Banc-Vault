// src/app/admin/dashboard/_lib/range.ts
// Parses dashboard search params into concrete date bounds, plus a prior-period
// window of equal length for vs-prior-period deltas.

export type RangePreset = '7d' | '30d' | '90d' | 'mtd' | 'qtd' | 'ytd' | 'custom'

export interface ResolvedRange {
  preset: RangePreset
  from: Date
  to: Date
  prev_from: Date
  prev_to: Date
  label: string
  days: number
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  'mtd': 'Month to date',
  'qtd': 'Quarter to date',
  'ytd': 'Year to date',
  'custom': 'Custom',
}

function start_of_day(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function days_between(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)))
}

export function resolve_range(params: { range?: string; from?: string; to?: string }): ResolvedRange {
  const now = new Date()
  const today_end = new Date(now)

  // Default
  let preset: RangePreset = '30d'
  let from: Date
  let to: Date = today_end

  const requested = (params.range || '').toLowerCase() as RangePreset

  if (params.from && params.to) {
    preset = 'custom'
    from = start_of_day(new Date(params.from))
    to = new Date(params.to)
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      // Bad input — fall back to 30d default.
      preset = '30d'
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      to = today_end
    }
  } else {
    switch (requested) {
      case '7d':
        preset = '7d'
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        preset = '90d'
        from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'mtd':
        preset = 'mtd'
        from = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'qtd': {
        preset = 'qtd'
        const quarter_start_month = Math.floor(now.getMonth() / 3) * 3
        from = new Date(now.getFullYear(), quarter_start_month, 1)
        break
      }
      case 'ytd':
        preset = 'ytd'
        from = new Date(now.getFullYear(), 0, 1)
        break
      case '30d':
      default:
        preset = '30d'
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
    }
  }

  const days = days_between(from, to)
  const prev_to = new Date(from.getTime())
  const prev_from = new Date(from.getTime() - days * 24 * 60 * 60 * 1000)

  return {
    preset,
    from,
    to,
    prev_from,
    prev_to,
    label: PRESET_LABELS[preset],
    days,
  }
}

export function compute_delta(current: number, prior: number): { abs: number; pct: number | null } {
  const abs = current - prior
  if (prior === 0) {
    return { abs, pct: current === 0 ? 0 : null }
  }
  return { abs, pct: (abs / prior) * 100 }
}
