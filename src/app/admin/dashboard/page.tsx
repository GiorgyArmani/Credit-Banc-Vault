// src/app/admin/dashboard/page.tsx
//
// Server component — fetches operational metrics in parallel and renders
// the admin "command center" with real numbers + the existing tool cards.

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import {
  LayoutDashboard,
  BarChart3,
  Search,
  Database,
  Users,
  LayoutGrid,
  BookCheck,
  ArrowRight,
  ShieldCheck,
  UserCog,
  Star,
  TrendingUp,
  Clock,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

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
  'funded',
  'declined',
] as const

const STAGE_LABEL: Record<string, string> = {
  created: 'Created',
  onboarding: 'Onboarding',
  documents_requested: 'Docs Req.',
  documents_received: 'Docs In',
  under_review: 'In Review',
  lender_matched: 'Matched',
  funded: 'Funded',
  declined: 'Declined',
}

interface DashboardMetrics {
  total_active: number
  pending_lender_reviews: number
  funded_amount_this_month: number
  signups_this_month: number
  pipeline_counts: Record<string, number>
  avg_days_in_stage: Record<string, number>
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
    new_clients_30d: number
    funded_30d: number
  }>
}

async function load_metrics(): Promise<DashboardMetrics> {
  const now = new Date()
  const month_start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const thirty_days_ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Fan out the queries in parallel — server-side, single round-trip.
  const [
    { count: total_active },
    { count: pending_lender_reviews },
    { data: funded_rows },
    { count: signups_this_month },
    { data: history_rows },
    { data: vault_rows },
    { data: recent_signup_rows },
    { data: advisor_30d_rows },
  ] = await Promise.all([
    supabase_admin
      .from('client_data_vault')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),

    supabase_admin
      .from('client_lender_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('admin_review', 'pending')
      .eq('decision', 'approved'),

    supabase_admin
      .from('loan_status_history')
      .select('client_vault_id, status, created_at')
      .eq('status', 'funded')
      .gte('created_at', month_start),

    supabase_admin
      .from('client_data_vault')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', month_start),

    supabase_admin
      .from('loan_status_history')
      .select('client_vault_id, status, created_at')
      .order('created_at', { ascending: true }),

    supabase_admin
      .from('client_data_vault')
      .select('id, capital_requested, advisor_id, advisor_name'),

    supabase_admin
      .from('client_data_vault')
      .select('id, client_name, company_name, advisor_name, created_at')
      .order('created_at', { ascending: false })
      .limit(8),

    supabase_admin
      .from('client_data_vault')
      .select('id, advisor_id, advisor_name, created_at')
      .gte('created_at', thirty_days_ago),
  ])

  // Compute funded $ this month — sum capital_requested for the funded clients.
  const funded_client_ids = new Set((funded_rows ?? []).map((r: any) => r.client_vault_id))
  const funded_amount_this_month = (vault_rows ?? [])
    .filter((v: any) => funded_client_ids.has(v.id))
    .reduce((s: number, v: any) => s + (Number(v.capital_requested) || 0), 0)

  // Compute current pipeline status per client + days in stage.
  // Take the latest history row per client; if none, fall back to "created".
  const latest_by_client = new Map<string, { status: string; created_at: string }>()
  for (const row of history_rows ?? []) {
    latest_by_client.set(row.client_vault_id, {
      status: row.status,
      created_at: row.created_at,
    })
  }

  const pipeline_counts: Record<string, number> = {}
  PIPELINE_STAGES.forEach((s) => (pipeline_counts[s] = 0))
  // Days-in-stage running totals.
  const days_sum: Record<string, number> = {}
  const days_count: Record<string, number> = {}
  PIPELINE_STAGES.forEach((s) => {
    days_sum[s] = 0
    days_count[s] = 0
  })

  for (const v of vault_rows ?? []) {
    const latest = latest_by_client.get(v.id)
    const stage = latest?.status ?? 'created'
    pipeline_counts[stage] = (pipeline_counts[stage] ?? 0) + 1
    if (latest?.created_at) {
      const days = (now.getTime() - new Date(latest.created_at).getTime()) / (1000 * 60 * 60 * 24)
      days_sum[stage] += days
      days_count[stage] += 1
    }
  }

  const avg_days_in_stage: Record<string, number> = {}
  PIPELINE_STAGES.forEach((s) => {
    avg_days_in_stage[s] = days_count[s] > 0 ? days_sum[s] / days_count[s] : 0
  })

  // Advisor leaderboard — new clients in the last 30 days (and funded count).
  const advisor_map = new Map<
    string,
    { advisor_id: string; advisor_name: string; new_clients_30d: number; funded_30d: number }
  >()
  for (const r of advisor_30d_rows ?? []) {
    if (!r.advisor_id) continue
    const existing = advisor_map.get(r.advisor_id)
    if (existing) {
      existing.new_clients_30d += 1
    } else {
      advisor_map.set(r.advisor_id, {
        advisor_id: r.advisor_id,
        advisor_name: r.advisor_name || 'Unknown',
        new_clients_30d: 1,
        funded_30d: 0,
      })
    }
  }
  // Funded counts in the last 30 days, joined back to advisor.
  const funded_30d_history = (history_rows ?? []).filter(
    (h: any) => h.status === 'funded' && new Date(h.created_at).getTime() >= new Date(thirty_days_ago).getTime()
  )
  const funded_30d_client_ids = new Set(funded_30d_history.map((h: any) => h.client_vault_id))
  for (const v of vault_rows ?? []) {
    if (!v.advisor_id || !funded_30d_client_ids.has(v.id)) continue
    const existing = advisor_map.get(v.advisor_id)
    if (existing) existing.funded_30d += 1
  }

  const advisor_leaderboard = Array.from(advisor_map.values())
    .sort((a, b) => b.new_clients_30d - a.new_clients_30d)
    .slice(0, 5)

  return {
    total_active: total_active ?? 0,
    pending_lender_reviews: pending_lender_reviews ?? 0,
    funded_amount_this_month,
    signups_this_month: signups_this_month ?? 0,
    pipeline_counts,
    avg_days_in_stage,
    recent_signups: (recent_signup_rows ?? []) as DashboardMetrics['recent_signups'],
    advisor_leaderboard,
  }
}

// ─── Tool card data (same as before) ──────────────────────────────────────────
const uwTools = [
  { label: 'Review Queue', desc: 'Review and process client files submitted for underwriting.', href: '/admin/uw/dashboard', icon: LayoutDashboard, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Bank Analysis', desc: 'Run detailed bank statement analysis on client accounts.', href: '/admin/uw/bank-analysis', icon: BarChart3, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Lender Match', desc: 'Match client profiles against active lender programs.', href: '/admin/uw/lender-match', icon: Search, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
  { label: 'Lender Database', desc: 'Manage and configure lender guidelines and programs.', href: '/admin/uw/lender-guidelines', icon: Database, color: 'from-emerald-50 to-emerald-100/50', iconColor: 'text-emerald-500', border: 'border-emerald-100' },
]
const advisorTools = [
  { label: 'Advisor Dashboard', desc: 'View key metrics, recent activity and pipeline summary.', href: '/admin/advisor/dashboard', icon: BookCheck, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'Pipeline', desc: 'Drag-and-drop Kanban board to manage deals through all stages.', href: '/admin/advisor/pipeline', icon: LayoutGrid, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'Clients', desc: 'Browse, manage and onboard all funding clients.', href: '/admin/advisor/clients', icon: Users, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
  { label: 'New Funding', desc: 'Submit a new client vault for the funding pipeline.', href: '/admin/advisor/clients/new', icon: UserCog, color: 'from-blue-50 to-blue-100/50', iconColor: 'text-blue-500', border: 'border-blue-100' },
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

export default async function AdminDashboardPage() {
  const m = await load_metrics()
  const max_pipeline = Math.max(1, ...Object.values(m.pipeline_counts))

  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="flex items-start gap-5">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/20 shrink-0">
          <ShieldCheck className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-2">
            Admin Command Center
          </h1>
          <p className="text-slate-600 text-base leading-relaxed max-w-2xl">
            Operational view of the funding pipeline. Lender reviews waiting on you, money funded this month, and how the team is moving deals.
          </p>
        </div>
      </div>

      {/* Top metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricTile
          label="Active deals"
          value={String(m.total_active)}
          icon={TrendingUp}
          tone="emerald"
        />
        <MetricTile
          label="Pending lender reviews"
          value={String(m.pending_lender_reviews)}
          icon={Star}
          tone={m.pending_lender_reviews > 0 ? 'amber' : 'slate'}
          href="/admin/dashboard"
          hint={m.pending_lender_reviews > 0 ? 'Awaiting your decision' : 'All caught up'}
        />
        <MetricTile
          label="Funded this month"
          value={fmt_money(m.funded_amount_this_month)}
          icon={ShieldCheck}
          tone="emerald"
        />
        <MetricTile
          label="New signups this month"
          value={String(m.signups_this_month)}
          icon={Users}
          tone="blue"
        />
      </div>

      {/* Pipeline by stage */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-black text-slate-900">Pipeline by stage</h2>
            <p className="text-xs text-slate-500 mt-0.5">Current count per stage · avg days in stage shown below</p>
          </div>
          <Link href="/admin/advisor/pipeline" className="text-xs font-bold text-emerald-600 hover:text-emerald-700">
            Open Kanban →
          </Link>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
          {PIPELINE_STAGES.map((stage) => {
            const count = m.pipeline_counts[stage] ?? 0
            const avg = m.avg_days_in_stage[stage] ?? 0
            const height_pct = (count / max_pipeline) * 100
            return (
              <div key={stage} className="flex flex-col items-center gap-2">
                <div className="w-full h-24 bg-slate-50 rounded-xl flex items-end overflow-hidden">
                  <div
                    className="w-full bg-gradient-to-t from-emerald-500 to-emerald-300 transition-all"
                    style={{ height: `${Math.max(height_pct, count > 0 ? 6 : 0)}%` }}
                  />
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-center leading-tight">
                  {STAGE_LABEL[stage]}
                </p>
                <p className="text-base font-black text-slate-900">{count}</p>
                <p className="text-[10px] font-bold text-slate-400">
                  <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                  {avg > 0 ? `${avg.toFixed(0)}d avg` : '—'}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Two-column: recent signups + advisor leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent signups */}
        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-black text-slate-900">Recent signups</h2>
            <Link href="/admin/advisor/clients" className="text-xs font-bold text-emerald-600 hover:text-emerald-700">
              View all →
            </Link>
          </div>
          {m.recent_signups.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No clients yet.</p>
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

        {/* Advisor leaderboard */}
        <section className="bg-white border border-slate-200 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-black text-slate-900">Advisor leaderboard</h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last 30 days</span>
          </div>
          {m.advisor_leaderboard.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No activity yet.</p>
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
                      {a.new_clients_30d} new · {a.funded_30d} funded
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-emerald-600">{a.new_clients_30d}</p>
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
  href,
}: {
  label: string
  value: string
  icon: any
  tone: 'emerald' | 'blue' | 'amber' | 'slate'
  hint?: string
  href?: string
}) {
  const tone_classes = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    slate: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
  }[tone]

  const inner = (
    <div className={`bg-white border ${tone_classes.border} shadow-sm rounded-2xl p-5 transition-all hover:shadow-md ${href ? 'cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${tone_classes.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-4 w-4 ${tone_classes.text}`} />
        </div>
      </div>
      <p className={`text-3xl font-black ${tone_classes.text} leading-none mb-1.5`}>{value}</p>
      {hint && (
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{hint}</p>
      )}
    </div>
  )

  return href ? <Link href={href}>{inner}</Link> : inner
}
