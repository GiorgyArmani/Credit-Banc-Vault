// src/app/admin/dashboard/page.tsx
//
// Server component — fetches operational metrics in parallel and renders
// the admin "command center". All time-bounded KPIs are scoped to a date
// range read from search params; prior-period equivalents power the
// vs-prior deltas on each tile.

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import {
  LayoutDashboard,
  BarChart3,
  Search,
  Database,
  Users,
  LayoutGrid,
  ArrowRight,
  ShieldCheck,
  UserCog,
  Star,
  TrendingUp,
  TrendingDown,
  Clock,
  Minus,
  Timer,
  Zap,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { resolve_range, compute_delta, type ResolvedRange } from './_lib/range'
import { compute_funded_amount } from './_lib/funded-amount'
import { DateRangePicker } from './_components/date-range-picker'
import { AdvisorFilter } from './_components/advisor-filter'
import { FundedSparkline } from './_components/funded-sparkline'
import { ConversionFunnel } from './_components/conversion-funnel'

// 30-day activity window for Active / Stale classification. Activity sources
// are document uploads (any role) and pipeline status changes — see the
// last_activity_at computation in load_metrics.
const ACTIVITY_WINDOW_DAYS = 30

export const dynamic = 'force-dynamic'

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const PIPELINE_STAGES = [
  'created',
  'onboarding',
  'documents_requested',
  'documents_received',
  'under_review',
  'lender_matched',
  'consulting_program',
  'funded',
  'declined',
] as const

// Stages that represent live, in-flight work (used for the "Pipeline $" tile
// and the Stale bucket). Funded and declined are terminal — clients in those
// stages aren't part of the in-flight pipeline regardless of activity.
const IN_FLIGHT_STAGES: ReadonlySet<string> = new Set([
  'created',
  'onboarding',
  'documents_requested',
  'documents_received',
  'under_review',
  'lender_matched',
  'consulting_program',
])

const FUNNEL_STAGES = [
  'created',
  'onboarding',
  'documents_requested',
  'documents_received',
  'under_review',
  'lender_matched',
  'consulting_program',
  'funded',
] as const

const STAGE_LABEL: Record<string, string> = {
  created: 'Created',
  onboarding: 'Onboarding',
  documents_requested: 'Docs Req.',
  documents_received: 'Docs In',
  under_review: 'In Review',
  lender_matched: 'Matched',
  consulting_program: 'Consulting',
  funded: 'Funded',
  declined: 'Declined',
  stale: 'Stale',
}

// Stages shown in the snapshot grid — same as PIPELINE_STAGES plus an
// at-the-end "stale" bucket derived from inactivity rather than status.
const SNAPSHOT_STAGES: ReadonlyArray<string> = [...PIPELINE_STAGES, 'stale']

interface DashboardMetrics {
  // Point-in-time
  total_active: number              // clients with activity in the last ACTIVITY_WINDOW_DAYS
  pending_lender_reviews: number     // distinct clients with at least one lender assignment ready to send
  total_pipeline_amount: number      // sum of capital_requested across in-flight, non-stale clients
  pipeline_counts: Record<string, number>  // includes a synthetic 'stale' key
  avg_days_in_stage: Record<string, number>

  // Range-scoped current period
  funded_amount: number
  funded_count: number
  signups: number

  // Prior-period equivalents (same length, immediately before)
  prior_funded_amount: number
  prior_funded_count: number
  prior_signups: number

  // Funnel — clients created in range, % that ever reached each stage
  funnel: Array<{ stage: string; label: string; count: number; pct_of_top: number; pct_step: number | null }>

  // Daily series of funded $ within range (for sparkline)
  funded_series: Array<{ date: string; amount: number; count: number }>

  // Time-to-fund stats — in days, for funded events within range
  time_to_fund: { median: number; p90: number; samples: number }

  // Recent + leaderboard scoped to range
  recent_signups: Array<{
    id: string
    client_name: string
    company_name: string
    advisor_name: string | null
    created_at: string
  }>
  advisor_leaderboard: Array<{
    advisor_id: string
    advisor_name: string
    new_clients: number
    funded: number
  }>
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

function date_key(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toISOString().slice(0, 10)
}

async function load_metrics(
  range: ResolvedRange,
  advisor_id: string | null,
): Promise<DashboardMetrics> {
  const now = new Date()
  const range_from = range.from.toISOString()
  const range_to = range.to.toISOString()

  // Build query helpers — same shape with an optional .eq('advisor_id', ...).
  // We filter at the vault level; downstream rows are filtered in-memory once
  // we know which vault ids are in scope, which keeps these queries parallel.
  const vault_query = supabase_admin
    .from('client_data_vault')
    .select('id, user_id, client_name, company_name, capital_requested, advisor_id, advisor_name, created_at')
  if (advisor_id) vault_query.eq('advisor_id', advisor_id)

  const recent_signup_query = supabase_admin
    .from('client_data_vault')
    .select('id, client_name, company_name, advisor_name, created_at')
    .gte('created_at', range_from)
    .lte('created_at', range_to)
    .order('created_at', { ascending: false })
    .limit(8)
  if (advisor_id) recent_signup_query.eq('advisor_id', advisor_id)

  const [
    { data: history_rows },
    { data: vault_rows },
    { data: recent_signup_rows },
    { data: upload_rows },
    { data: pending_review_rows },
    { data: funded_deal_rows },
  ] = await Promise.all([
    supabase_admin
      .from('loan_status_history')
      .select('client_vault_id, status, created_at, funding_deal_id')
      .order('created_at', { ascending: true }),

    vault_query,
    recent_signup_query,

    // Activity source #1 — every document upload (any role). user_documents is
    // keyed on auth user_id, so we join in-memory via vault.user_id.
    supabase_admin
      .from('user_documents')
      .select('user_id, upload_date'),

    // "Ready to send to lender UW" queue — matched by the algorithm, approved
    // by an admin, and not yet submitted to the lender. We pull client_id so
    // we can count DISTINCT files (one file with 3 ready lenders = 1 review).
    supabase_admin
      .from('client_lender_assignments')
      .select('client_id')
      .eq('decision', 'approved')
      .eq('admin_review', 'approved')
      .eq('status', 'pending'),

    // The real funded amount per vault, stamped by UW's Loan Funded flow onto
    // funding_deals. Joined to the vault via business_profiles.client_vault_id.
    // compute_funded_amount prefers this over the requested amount.
    supabase_admin
      .from('funding_deals')
      .select('id, funded_amount, business_profiles!inner(client_vault_id)'),
  ])

  // Aggregate funded_amount per vault (a vault may have several business deals,
  // and a repeat client several rounds per business). Used for legacy funded
  // events that carry no round id.
  const funded_amount_by_vault = new Map<string, number>()
  // Per-round amounts, so a repeat client's rounds are counted as the separate
  // fundings they are instead of collapsing into one vault-sized event.
  const funded_amount_by_deal = new Map<string, number>()
  for (const d of funded_deal_rows ?? []) {
    const vault_id = (d as any).business_profiles?.client_vault_id as string | null
    const amount = Number((d as any).funded_amount)
    if (!vault_id || !Number.isFinite(amount)) continue
    funded_amount_by_vault.set(vault_id, (funded_amount_by_vault.get(vault_id) ?? 0) + amount)
    const deal_id = (d as any).id as string | null
    if (deal_id) funded_amount_by_deal.set(deal_id, amount)
  }

  // ─── Index helpers ─────────────────────────────────────────────────────
  const vault_by_id = new Map<string, any>()
  const user_to_vault = new Map<string, string>()
  for (const v of vault_rows ?? []) {
    vault_by_id.set(v.id, v)
    if (v.user_id) user_to_vault.set(v.user_id, v.id)
  }

  // When an advisor filter is applied, vault_rows is already scoped — drop any
  // history / activity / lender-review row whose vault isn't in scope.
  const in_scope = (vault_id: string) => vault_by_id.has(vault_id)

  const history_by_client = new Map<string, Array<{ status: string; created_at: string }>>()
  for (const r of history_rows ?? []) {
    if (advisor_id && !in_scope(r.client_vault_id)) continue
    const arr = history_by_client.get(r.client_vault_id) ?? []
    arr.push({ status: r.status, created_at: r.created_at })
    history_by_client.set(r.client_vault_id, arr)
  }

  // Latest status per client (point-in-time pipeline snapshot)
  const latest_by_client = new Map<string, { status: string; created_at: string }>()
  for (const [id, arr] of history_by_client) {
    latest_by_client.set(id, arr[arr.length - 1])
  }

  // ─── last_activity_at per vault ────────────────────────────────────────
  // Seed with vault creation timestamp, then take the max over: pipeline status
  // changes (loan_status_history) and document uploads (user_documents). These
  // are the two signals the user wants for Active / Stale classification —
  // logins and internal notes are intentionally excluded.
  const activity_by_vault = new Map<string, number>()
  for (const v of vault_rows ?? []) {
    activity_by_vault.set(v.id, new Date(v.created_at).getTime())
  }
  for (const r of history_rows ?? []) {
    if (advisor_id && !in_scope(r.client_vault_id)) continue
    const ts = new Date(r.created_at).getTime()
    const cur = activity_by_vault.get(r.client_vault_id) ?? 0
    if (ts > cur) activity_by_vault.set(r.client_vault_id, ts)
  }
  for (const u of upload_rows ?? []) {
    const vid = user_to_vault.get(u.user_id)
    if (!vid) continue
    const ts = new Date(u.upload_date).getTime()
    const cur = activity_by_vault.get(vid) ?? 0
    if (ts > cur) activity_by_vault.set(vid, ts)
  }

  const stale_threshold_ms = now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const is_stale = (vault_id: string, stage: string): boolean => {
    if (stage === 'funded' || stage === 'declined') return false
    const last = activity_by_vault.get(vault_id) ?? 0
    return last < stale_threshold_ms
  }

  // ─── Pipeline by stage (point-in-time snapshot) ────────────────────────
  // The synthetic 'stale' bucket pulls clients OUT of their underlying stage so
  // the column counts sum to the total in-scope vault count without double-
  // counting. Funded / declined are terminal and never go stale.
  const pipeline_counts: Record<string, number> = {}
  SNAPSHOT_STAGES.forEach((s) => (pipeline_counts[s] = 0))
  const days_sum: Record<string, number> = {}
  const days_count: Record<string, number> = {}
  SNAPSHOT_STAGES.forEach((s) => { days_sum[s] = 0; days_count[s] = 0 })

  for (const v of vault_rows ?? []) {
    const latest = latest_by_client.get(v.id)
    const stage = latest?.status ?? 'created'
    const bucket = is_stale(v.id, stage) ? 'stale' : stage
    pipeline_counts[bucket] = (pipeline_counts[bucket] ?? 0) + 1
    if (latest?.created_at) {
      const days = (now.getTime() - new Date(latest.created_at).getTime()) / (1000 * 60 * 60 * 24)
      days_sum[bucket] += days
      days_count[bucket] += 1
    }
  }
  const avg_days_in_stage: Record<string, number> = {}
  SNAPSHOT_STAGES.forEach((s) => {
    avg_days_in_stage[s] = days_count[s] > 0 ? days_sum[s] / days_count[s] : 0
  })

  // ─── Top-level point-in-time tiles ─────────────────────────────────────
  let total_active = 0
  let total_pipeline_amount = 0
  for (const v of vault_rows ?? []) {
    const last = activity_by_vault.get(v.id) ?? 0
    if (last >= stale_threshold_ms) total_active += 1

    const latest = latest_by_client.get(v.id)
    const stage = latest?.status ?? 'created'
    if (IN_FLIGHT_STAGES.has(stage) && !is_stale(v.id, stage)) {
      total_pipeline_amount += Number(v.capital_requested) || 0
    }
  }

  // "Ready to send to lender UW" — distinct clients across pending_review_rows,
  // intersected with vault scope when advisor filter is on.
  const pending_clients = new Set<string>()
  for (const r of pending_review_rows ?? []) {
    if (advisor_id && !in_scope(r.client_id)) continue
    pending_clients.add(r.client_id)
  }
  const pending_lender_reviews = pending_clients.size

  // ─── Funded events (current + prior period) ────────────────────────────
  const range_from_ms = range.from.getTime()
  const range_to_ms = range.to.getTime()
  const prev_from_ms = range.prev_from.getTime()
  const prev_to_ms = range.prev_to.getTime()

  // Dedupe per funding ROUND, not per client. A repeat client who funds twice
  // in the period is two funded events for two amounts — collapsing them to one
  // vault-sized event was what made repeat business invisible on this tile.
  // Legacy rows carry no round id and fall back to per-vault dedupe, exactly as
  // before. Duplicate funded rows for the same round (e.g. kanban re-drags into
  // the Funded column) still collapse; history_rows is ordered ascending, so
  // Map.set keeps the latest transition per key.
  const latest_funded_in_range = new Map<string, { ts: number; amount: number; client_id: string }>()
  const latest_funded_in_prior = new Map<string, { ts: number; amount: number; client_id: string }>()

  for (const r of history_rows ?? []) {
    if (r.status !== 'funded') continue
    if (advisor_id && !in_scope(r.client_vault_id)) continue
    const ts = new Date(r.created_at).getTime()
    const v = vault_by_id.get(r.client_vault_id)
    const deal_id = (r as any).funding_deal_id as string | null
    // Source of truth for "how much was funded" lives in compute_funded_amount
    // — prefers the funded_amount stamped on funding_deals, falling back to
    // vault.capital_requested for deals funded before that column was written.
    // A round-stamped event uses THAT round's amount; an unstamped legacy event
    // still uses the vault total.
    const amount = compute_funded_amount({
      vault: v,
      funding_deal_amount:
        (deal_id ? funded_amount_by_deal.get(deal_id) : undefined) ??
        funded_amount_by_vault.get(r.client_vault_id) ??
        null,
    })

    const key = deal_id ?? r.client_vault_id
    if (ts >= range_from_ms && ts <= range_to_ms) {
      latest_funded_in_range.set(key, { ts, amount, client_id: r.client_vault_id })
    } else if (ts >= prev_from_ms && ts < prev_to_ms) {
      latest_funded_in_prior.set(key, { ts, amount, client_id: r.client_vault_id })
    }
  }

  let funded_amount = 0
  const funded_count = latest_funded_in_range.size
  const funded_in_range: Array<{ client_id: string; ts: number; amount: number }> = []
  // Keyed by round, so the entry carries the vault id explicitly rather than
  // relying on the map key being one.
  for (const { ts, amount, client_id } of latest_funded_in_range.values()) {
    funded_amount += amount
    funded_in_range.push({ client_id, ts, amount })
  }

  let prior_funded_amount = 0
  const prior_funded_count = latest_funded_in_prior.size
  for (const { amount } of latest_funded_in_prior.values()) {
    prior_funded_amount += amount
  }

  // ─── Signups (current + prior period) ──────────────────────────────────
  let signups = 0
  let prior_signups = 0
  for (const v of vault_rows ?? []) {
    const ts = new Date(v.created_at).getTime()
    if (ts >= range_from_ms && ts <= range_to_ms) signups += 1
    else if (ts >= prev_from_ms && ts < prev_to_ms) prior_signups += 1
  }

  // ─── Funnel — of clients created in range, who reached each stage ──────
  const cohort_ids = new Set(
    (vault_rows ?? [])
      .filter((v: any) => {
        const ts = new Date(v.created_at).getTime()
        return ts >= range_from_ms && ts <= range_to_ms
      })
      .map((v: any) => v.id)
  )

  const reached_by_stage: Record<string, Set<string>> = {}
  FUNNEL_STAGES.forEach((s) => (reached_by_stage[s] = new Set<string>()))
  // Created cohort always "reached" the created stage by definition.
  cohort_ids.forEach((id) => reached_by_stage['created'].add(id))

  for (const cid of cohort_ids) {
    const arr = history_by_client.get(cid) ?? []
    for (const h of arr) {
      if (FUNNEL_STAGES.includes(h.status as any)) {
        reached_by_stage[h.status].add(cid)
      }
    }
  }

  const top_count = reached_by_stage['created'].size
  let prev_count: number | null = null
  const funnel = FUNNEL_STAGES.map((s) => {
    const count = reached_by_stage[s].size
    const pct_of_top = top_count > 0 ? (count / top_count) * 100 : 0
    const pct_step = prev_count === null ? null : (prev_count > 0 ? (count / prev_count) * 100 : 0)
    prev_count = count
    return {
      stage: s,
      label: STAGE_LABEL[s],
      count,
      pct_of_top,
      pct_step,
    }
  })

  // ─── Funded daily series ───────────────────────────────────────────────
  const series_map = new Map<string, { amount: number; count: number }>()
  // Pre-fill keys for every day in range so the chart doesn't have gaps.
  for (let t = range_from_ms; t <= range_to_ms; t += 24 * 60 * 60 * 1000) {
    series_map.set(date_key(new Date(t)), { amount: 0, count: 0 })
  }
  for (const f of funded_in_range) {
    const key = date_key(new Date(f.ts))
    const cur = series_map.get(key) ?? { amount: 0, count: 0 }
    cur.amount += f.amount
    cur.count += 1
    series_map.set(key, cur)
  }
  const funded_series = Array.from(series_map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date: date.slice(5), amount: v.amount, count: v.count })) // MM-DD

  // ─── Time-to-fund (days from vault creation to funded event in range) ──
  const ttf_days: number[] = []
  for (const f of funded_in_range) {
    const v = vault_by_id.get(f.client_id)
    if (!v?.created_at) continue
    const days = (f.ts - new Date(v.created_at).getTime()) / (1000 * 60 * 60 * 24)
    if (days >= 0) ttf_days.push(days)
  }
  ttf_days.sort((a, b) => a - b)
  const time_to_fund = {
    median: percentile(ttf_days, 0.5),
    p90: percentile(ttf_days, 0.9),
    samples: ttf_days.length,
  }

  // ─── Advisor leaderboard scoped to range ───────────────────────────────
  const advisor_map = new Map<
    string,
    { advisor_id: string; advisor_name: string; new_clients: number; funded: number }
  >()
  for (const v of vault_rows ?? []) {
    if (!v.advisor_id) continue
    const ts = new Date(v.created_at).getTime()
    if (ts < range_from_ms || ts > range_to_ms) continue
    const existing = advisor_map.get(v.advisor_id)
    if (existing) existing.new_clients += 1
    else advisor_map.set(v.advisor_id, {
      advisor_id: v.advisor_id,
      advisor_name: v.advisor_name || 'Unknown',
      new_clients: 1,
      funded: 0,
    })
  }
  const funded_in_range_ids = new Set(funded_in_range.map((f) => f.client_id))
  for (const v of vault_rows ?? []) {
    if (!v.advisor_id || !funded_in_range_ids.has(v.id)) continue
    const existing = advisor_map.get(v.advisor_id)
    if (existing) existing.funded += 1
    else advisor_map.set(v.advisor_id, {
      advisor_id: v.advisor_id,
      advisor_name: v.advisor_name || 'Unknown',
      new_clients: 0,
      funded: 1,
    })
  }
  const advisor_leaderboard = Array.from(advisor_map.values())
    .sort((a, b) => (b.new_clients + b.funded) - (a.new_clients + a.funded))
    .slice(0, 5)

  return {
    total_active,
    pending_lender_reviews,
    total_pipeline_amount,
    pipeline_counts,
    avg_days_in_stage,
    funded_amount,
    funded_count,
    signups,
    prior_funded_amount,
    prior_funded_count,
    prior_signups,
    funnel,
    funded_series,
    time_to_fund,
    recent_signups: (recent_signup_rows ?? []) as DashboardMetrics['recent_signups'],
    advisor_leaderboard,
  }
}

// ─── Tool card data ───────────────────────────────────────────────────────
const uwTools = [
  { label: 'Review Queue', desc: 'Review and process client files submitted for underwriting.', href: '/admin/uw/dashboard', icon: LayoutDashboard, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Bank Analysis', desc: 'Run detailed bank statement analysis on client accounts.', href: '/admin/uw/bank-analysis', icon: BarChart3, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Lender Match', desc: 'Match client profiles against active lender programs.', href: '/admin/uw/lender-match', icon: Search, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Lender Database', desc: 'Manage and configure lender guidelines and programs.', href: '/admin/uw/lender-guidelines', icon: Database, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
]
const advisorTools = [
  { label: 'Pipeline', desc: 'Drag-and-drop Kanban board to manage deals through all stages.', href: '/admin/pipeline', icon: LayoutGrid, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'Prospects', desc: 'Active pipeline — files not yet funded.', href: '/admin/prospects', icon: Users, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'Clients', desc: 'Funded customer book.', href: '/admin/clients', icon: Users, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'New Funding', desc: 'Submit a new client vault for the funding pipeline.', href: '/admin/clients/new', icon: UserCog, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'Fast Funding', desc: 'One-page speed form — create a client on the call and send the signing link instantly.', href: '/admin/clients/new/speed', icon: Zap, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Referral Partners', desc: 'Manage the "who referred this deal" list shown on client creation and each client card.', href: '/admin/referral-partners', icon: Users, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
]

function ToolCard({ label, desc, href, icon: Icon, color, iconColor, border }: (typeof uwTools)[0]) {
  return (
    <Link href={href}>
      <div className={`group relative flex flex-col gap-4 p-6 rounded-2xl border ${border} bg-gradient-to-br ${color} hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 cursor-pointer h-full`}>
        <div className={`w-11 h-11 rounded-xl bg-white border ${border} flex items-center justify-center shrink-0 shadow-sm`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-black text-slate-900 mb-1">{label}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{desc}</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 group-hover:text-slate-900 transition-colors duration-200">
          Open <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform duration-200" />
        </div>
      </div>
    </Link>
  )
}

const fmt_money = (v: number) => `$${Math.round(v).toLocaleString()}`
const fmt_compact_money = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${Math.round(v)}`
}

interface PageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string; advisor?: string }>
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const range = resolve_range(params)
  const advisor_id = params.advisor && params.advisor.length > 0 ? params.advisor : null

  const [m, advisors_list] = await Promise.all([
    load_metrics(range, advisor_id),
    supabase_admin
      .from('advisors')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .order('first_name', { ascending: true }),
  ])

  const advisor_options = (advisors_list.data ?? []).map((a) => ({
    id: a.id as string,
    name: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Unknown',
  }))
  const selected_advisor = advisor_id ? advisor_options.find((a) => a.id === advisor_id) : null

  const max_pipeline = Math.max(1, ...Object.values(m.pipeline_counts))

  const funded_delta = compute_delta(m.funded_amount, m.prior_funded_amount)
  const funded_count_delta = compute_delta(m.funded_count, m.prior_funded_count)
  const signups_delta = compute_delta(m.signups, m.prior_signups)

  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/20 shrink-0">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-2">
              Admin Command Center
            </h1>
            <p className="text-slate-600 text-base leading-relaxed max-w-2xl">
              Operational view of the funding pipeline. KPIs scoped to <span className="font-bold text-slate-900">{range.label.toLowerCase()}</span>{selected_advisor ? <> · advisor <span className="font-bold text-slate-900">{selected_advisor.name}</span></> : null}; deltas compare to the prior {range.days}-day window.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AdvisorFilter advisors={advisor_options} />
          <DateRangePicker />
        </div>
      </div>

      {/* Top metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricTile
          label="Active deals"
          value={String(m.total_active)}
          icon={TrendingUp}
          tone="emerald"
          hint={`Activity in last ${ACTIVITY_WINDOW_DAYS} days`}
        />
        <MetricTile
          label="Pending lender reviews"
          value={String(m.pending_lender_reviews)}
          icon={Star}
          tone={m.pending_lender_reviews > 0 ? 'amber' : 'slate'}
          hint={m.pending_lender_reviews > 0 ? 'Ready to send to lender UW' : 'All caught up'}
        />
        <MetricTile
          label="Pipeline $"
          value={fmt_compact_money(m.total_pipeline_amount)}
          icon={LayoutGrid}
          tone="blue"
          hint="In-flight, requested capital"
        />
        <MetricTile
          label="Funded in range"
          value={fmt_compact_money(m.funded_amount)}
          icon={ShieldCheck}
          tone="emerald"
          delta={funded_delta}
          hint={`${m.funded_count} ${m.funded_count === 1 ? 'deal' : 'deals'}${funded_count_delta.abs !== 0 ? ` · ${funded_count_delta.abs > 0 ? '+' : ''}${funded_count_delta.abs} vs prior` : ''}`}
        />
        <MetricTile
          label="New signups"
          value={String(m.signups)}
          icon={Users}
          tone="blue"
          delta={signups_delta}
        />
      </div>

      {/* Charts row: funded over time + time-to-fund stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Funded over time</h2>
              <p className="text-xs text-slate-500 mt-0.5">Total {fmt_money(m.funded_amount)} across {range.days} {range.days === 1 ? 'day' : 'days'}</p>
            </div>
          </div>
          <FundedSparkline data={m.funded_series} />
        </section>

        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-slate-400" />
              <h2 className="text-base font-black text-slate-900">Time to fund</h2>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{m.time_to_fund.samples} {m.time_to_fund.samples === 1 ? 'deal' : 'deals'}</span>
          </div>
          {m.time_to_fund.samples === 0 ? (
            <p className="text-sm text-slate-400 italic py-8 text-center">No funding events in range.</p>
          ) : (
            <div className="space-y-4 pt-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Median</p>
                <p className="text-3xl font-black text-emerald-600 leading-none">{m.time_to_fund.median.toFixed(0)}<span className="text-base text-slate-400 ml-1">days</span></p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">P90 (slowest 10%)</p>
                <p className="text-3xl font-black text-slate-900 leading-none">{m.time_to_fund.p90.toFixed(0)}<span className="text-base text-slate-400 ml-1">days</span></p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Funnel + Pipeline snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Conversion funnel</h2>
              <p className="text-xs text-slate-500 mt-0.5">Of {m.funnel[0]?.count ?? 0} clients created in range, how many reached each stage</p>
            </div>
          </div>
          <ConversionFunnel data={m.funnel} />
        </section>

        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-black text-slate-900">Pipeline snapshot</h2>
              <p className="text-xs text-slate-500 mt-0.5">Current count per stage · avg days in stage</p>
            </div>
            <Link href="/admin/advisor/pipeline" className="text-xs font-bold text-emerald-600 hover:text-emerald-700">
              Open Kanban →
            </Link>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {SNAPSHOT_STAGES.map((stage) => {
              const count = m.pipeline_counts[stage] ?? 0
              const avg = m.avg_days_in_stage[stage] ?? 0
              const height_pct = (count / max_pipeline) * 100
              const is_stale_col = stage === 'stale'
              // Visually flag the stale bucket — it's derived, not a real stage.
              const bar_gradient = is_stale_col
                ? 'bg-gradient-to-t from-rose-500 to-rose-300'
                : 'bg-gradient-to-t from-emerald-500 to-emerald-300'
              const label_color = is_stale_col ? 'text-rose-500' : 'text-slate-400'
              return (
                <div key={stage} className="flex flex-col items-center gap-2">
                  <div className="w-full h-16 bg-slate-50 rounded-xl flex items-end overflow-hidden">
                    <div
                      className={`w-full ${bar_gradient} transition-all`}
                      style={{ height: `${Math.max(height_pct, count > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${label_color} text-center leading-tight`}>
                    {STAGE_LABEL[stage]}
                  </p>
                  <p className="text-base font-black text-slate-900">{count}</p>
                  <p className="text-[10px] font-bold text-slate-400">
                    <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                    {avg > 0 ? `${avg.toFixed(0)}d` : '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {/* Two-column: recent signups + advisor leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-black text-slate-900">Recent signups</h2>
            <Link href="/admin/prospects" className="text-xs font-bold text-emerald-600 hover:text-emerald-700">
              View all →
            </Link>
          </div>
          {m.recent_signups.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No signups in this range.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {m.recent_signups.map((c) => (
                <Link key={c.id} href={`/admin/clients/${c.id}`} className="block py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{c.client_name}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {c.company_name}
                        {c.advisor_name && c.advisor_name !== 'Unknown' && (
                          <> · {c.advisor_name}</>
                        )}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0 uppercase tracking-widest">
                      {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-black text-slate-900">Advisor leaderboard</h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{range.label}</span>
          </div>
          {m.advisor_leaderboard.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No activity in this range.</p>
          ) : (
            <div className="space-y-3">
              {m.advisor_leaderboard.map((a, idx) => (
                <div key={a.advisor_id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-black text-emerald-600">#{idx + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{a.advisor_name}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {a.new_clients} new · {a.funded} funded
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-emerald-600">{a.new_clients}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Underwriting Section (tools) */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-500">Underwriting Tools</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {uwTools.map((tool) => (
            <ToolCard key={tool.href} {...tool} />
          ))}
        </div>
      </section>

      {/* Advisor Section (tools) */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-500">Advisor Tools</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {advisorTools.map((tool) => (
            <ToolCard key={tool.href} {...tool} />
          ))}
        </div>
      </section>
    </div>
  )
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone,
  hint,
  delta,
}: {
  label: string
  value: string
  icon: any
  tone: 'emerald' | 'blue' | 'amber' | 'slate'
  hint?: string
  delta?: { abs: number; pct: number | null }
}) {
  const tone_classes = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    slate: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
  }[tone]

  let delta_node: React.ReactNode = null
  if (delta) {
    const positive = delta.abs > 0
    const negative = delta.abs < 0
    const flat = delta.abs === 0
    const DeltaIcon = positive ? TrendingUp : negative ? TrendingDown : Minus
    const delta_color = positive ? 'text-emerald-600 bg-emerald-50' : negative ? 'text-rose-600 bg-rose-50' : 'text-slate-500 bg-slate-100'
    const pct_text =
      delta.pct === null
        ? '—'
        : `${flat ? '' : delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(0)}%`
    delta_node = (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${delta_color}`}>
        <DeltaIcon className="h-2.5 w-2.5" />
        {pct_text}
      </span>
    )
  }

  return (
    <div className={`bg-white border ${tone_classes.border} shadow-sm rounded-2xl p-5 transition-all hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${tone_classes.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-4 w-4 ${tone_classes.text}`} />
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <p className={`text-3xl font-black ${tone_classes.text} leading-none`}>{value}</p>
        {delta_node}
      </div>
      {hint && (
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{hint}</p>
      )}
    </div>
  )
}
