"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { canUseAdvisorWorkspace } from "@/lib/auth/roles";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  LogOut,
  Sparkles,
  ArrowRight,
  Shield,
  Activity,
  Zap
} from "lucide-react";
import AdvisorWebsiteTour from "@/components/tour/advisor-website-tour";
import { Badge } from "@/components/ui/badge";
import { getBulkLatestStatus, type LoanStatus } from "@/app/actions/pipeline";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";

/**
 * Stat Card Component
 * Displays a single metric with icon and label
 */
const STAT_TONES: Record<string, { chip: string; value: string; bar: string; glow: string }> = {
  emerald: { chip: "bg-emerald-500 shadow-emerald-500/30", value: "text-emerald-600", bar: "from-emerald-400 to-emerald-600", glow: "bg-emerald-400/20" },
  blue: { chip: "bg-blue-500 shadow-blue-500/30", value: "text-blue-600", bar: "from-blue-400 to-blue-600", glow: "bg-blue-400/20" },
  amber: { chip: "bg-amber-500 shadow-amber-500/30", value: "text-amber-600", bar: "from-amber-400 to-amber-600", glow: "bg-amber-400/20" },
  violet: { chip: "bg-violet-500 shadow-violet-500/30", value: "text-violet-600", bar: "from-violet-400 to-violet-600", glow: "bg-violet-400/20" },
};

// Static class strings per tone (Tailwind can't see dynamic `border-${x}` names).
const QUICK_TONES: Record<string, { border: string; chip: string; shadow: string; arrow: string }> = {
  emerald: { border: "border-emerald-100 hover:border-emerald-300", chip: "bg-emerald-500 shadow-emerald-500/30", shadow: "hover:shadow-emerald-500/10", arrow: "text-emerald-500" },
  amber: { border: "border-amber-100 hover:border-amber-300", chip: "bg-amber-500 shadow-amber-500/30", shadow: "hover:shadow-amber-500/10", arrow: "text-amber-500" },
  blue: { border: "border-blue-100 hover:border-blue-300", chip: "bg-blue-500 shadow-blue-500/30", shadow: "hover:shadow-blue-500/10", arrow: "text-blue-500" },
  violet: { border: "border-violet-100 hover:border-violet-300", chip: "bg-violet-500 shadow-violet-500/30", shadow: "hover:shadow-violet-500/10", arrow: "text-violet-500" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  tone = "emerald",
}: {
  icon: any;
  label: string;
  value: string | number;
  trend?: string;
  tone?: keyof typeof STAT_TONES;
  id?: string;
}) {
  const t = STAT_TONES[tone] ?? STAT_TONES.emerald;
  return (
    <div className="relative rounded-[2rem] border-2 border-slate-100 bg-white p-6 overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-200/60 hover:border-transparent group">
      {/* top accent bar — reveals on hover */}
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.bar} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
      {/* corner glow */}
      <div className={`absolute -top-8 -right-8 w-24 h-24 ${t.glow} blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

      <div className="relative z-10 flex items-start justify-between mb-5">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 pt-1">{label}</span>
        <div className={`w-11 h-11 rounded-2xl ${t.chip} shadow-lg flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-500`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>

      <div className={`relative z-10 text-4xl font-black tracking-tighter tabular-nums ${t.value}`}>{value}</div>

      {trend && (
        <p className="relative z-10 text-[10px] font-black uppercase tracking-wider text-slate-400 mt-2 flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full bg-gradient-to-r ${t.bar}`} />
          {trend}
        </p>
      )}
    </div>
  );
}

/**
 * Workspace Dashboard
 *
 * The landing dashboard for anyone who works deals. Rendered by three portals,
 * differing only in `basePath`:
 *   /advisor/dashboard   staff advisors
 *   /admin               admins
 *   /partner             external partner advisors working their own deals
 *
 * Every stat, list and feed below is scoped to files the caller owns or follows.
 * That scoping is convenience — RLS enforces the same bound independently via
 * is_assigned_advisor_for().
 */
export function WorkspaceDashboard({
  basePath,
  /** What this portal calls the person looking at it. External partners are
   *  "Referral Partner" throughout the UI — `partner_advisor` is the internal
   *  role name and is never shown to them. */
  roleLabel = "Advisor",
}: {
  basePath: string;
  roleLabel?: string;
}) {
  // State management
  interface AdvisorUserProfile {
    id: string;
    first_name: string;
    role: string;
    email: string;
  }

  interface RecentApp {
    id: string;
    client_name: string;
    company_name: string;
    status: string;
    submitted_at: string;
    vault_id?: string;
    pipeline_status?: LoanStatus;
  }

  interface ActivityItem {
    id: string;
    client_name: string;
    file_name: string;
    created_at: string;
  }

  const [userData, setUserData] = useState<AdvisorUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalClients: 0,
    pendingApplications: 0,
    approvedApplications: 0,
    successRate: 0
  });
  const [recentApps, setRecentApps] = useState<RecentApp[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

  const router = useRouter();
  const supabase = createClient();

  /**
   * Fetch user authentication data and user profile
   */
  useEffect(() => {
    async function loadUserData() {
      try {
        // Get authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          router.push("/auth/login");
          return;
        }

        // Get user profile from public.users table
        const { data: profile, error: profileError } = await supabase
          .from("users")
          .select("*")
          .eq("id", user.id)
          .single();

        if (profileError) throw profileError;

        // Must be able to work deals: advisor, partner_advisor or admin.
        if (!canUseAdvisorWorkspace(profile.role)) {
          router.push("/dashboard"); // Redirect to regular dashboard
          return;
        }

        // Fetch advisor id from advisors table
        let advisorId = null;
        let { data: advisor_data, error: advisor_error } = await supabase
          .from("advisors")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!advisor_data && !advisor_error) {
          const email_query = await supabase
            .from("advisors")
            .select("id")
            .eq("email", profile.email)
            .maybeSingle();

          advisor_data = email_query.data;
          if (advisor_data) {
            await supabase.from("advisors").update({ user_id: user.id }).eq("id", advisor_data.id);
          }
        }

        if (advisor_data) {
          advisorId = advisor_data.id;
        }

        setUserData(profile);

        // Load advisor statistics
        if (advisorId) {
          await loadStats(advisorId);
        }

      } catch (error) {
        console.error("Error loading user data:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadUserData();
  }, [router, supabase]);

  /**
   * Load advisor statistics from database
   */
  async function loadStats(advisorId: string) {
    try {
      // Build the set of client vaults this advisor can see: owned + followed.
      const [{ data: owned }, { data: followed }] = await Promise.all([
        supabase.from("client_data_vault").select("id, user_id").eq("advisor_id", advisorId),
        supabase.from("client_followers").select("client_vault_id").eq("advisor_id", advisorId),
      ]);

      const vaultIdSet = new Set<string>();
      const ownerUserIds = new Set<string>();
      owned?.forEach(r => { vaultIdSet.add(r.id); ownerUserIds.add(r.user_id); });
      followed?.forEach((r: any) => vaultIdSet.add(r.client_vault_id));

      // Resolve user_ids for followed vaults
      let allClientUserIds = Array.from(ownerUserIds);
      if (followed && followed.length > 0) {
        const followedIds = followed.map((r: any) => r.client_vault_id);
        const { data: followedVaults } = await supabase
          .from("client_data_vault")
          .select("user_id")
          .in("id", followedIds);
        followedVaults?.forEach((v: any) => allClientUserIds.push(v.user_id));
      }

      const accessibleVaultIds = Array.from(vaultIdSet);
      const hasAny = accessibleVaultIds.length > 0;

      // 1. Total Clients
      const totalClients = accessibleVaultIds.length;

      // 2. Pending Applications ('submitted' and 'documents_requested')
      const { count: pendingApplications } = hasAny
        ? await supabase
            .from("submissions")
            .select("*", { count: "exact", head: true })
            .in("user_id", allClientUserIds)
            .in("status", ["submitted", "documents_requested"])
        : { count: 0 };

      // 3. Approved ('locked')
      const { count: approvedApplications } = hasAny
        ? await supabase
            .from("submissions")
            .select("*", { count: "exact", head: true })
            .in("user_id", allClientUserIds)
            .eq("status", "locked")
        : { count: 0 };

      const allCompleted = approvedApplications || 0;
      const totalSubs = (pendingApplications || 0) + allCompleted;
      const successRate = totalSubs > 0 ? Math.round((allCompleted / totalSubs) * 100) : 0;

      setStats({
        totalClients,
        pendingApplications: pendingApplications || 0,
        approvedApplications: allCompleted,
        successRate
      });

      // Fetch recent applications
      const { data: recentSubsData } = hasAny
        ? await supabase
            .from("submissions")
            .select(`
              id,
              status,
              submitted_at,
              client_data_vault (
                id,
                client_name,
                company_name
              )
            `)
            .in("user_id", allClientUserIds)
            .order("submitted_at", { ascending: false })
            .limit(5)
        : { data: null as any };

      if (recentSubsData) {
        const apps = recentSubsData.map((s: any) => ({
          id: s.id,
          status: s.status,
          submitted_at: s.submitted_at || new Date().toISOString(),
          client_name: s.client_data_vault?.client_name || s.client_data_vault?.[0]?.client_name || 'Unknown Client',
          company_name: s.client_data_vault?.company_name || s.client_data_vault?.[0]?.company_name || 'Unknown Company',
          vault_id: s.client_data_vault?.id || s.client_data_vault?.[0]?.id,
        }));

        // Bulk-fetch pipeline statuses for recent apps
        const vaultIds = apps.map((a: any) => a.vault_id).filter(Boolean);
        if (vaultIds.length > 0) {
          const pipelineMap = await getBulkLatestStatus(vaultIds);
          apps.forEach((a: any) => {
            if (a.vault_id) a.pipeline_status = pipelineMap.get(a.vault_id) ?? "created";
          });
        }

        setRecentApps(apps);
      }

      // Fetch recent activity — for accessible clients (owned + followed)
      const { data: clientsData } = hasAny
        ? await supabase
            .from("client_data_vault")
            .select("user_id, client_name")
            .in("id", accessibleVaultIds)
        : { data: null as any };

      if (clientsData && clientsData.length > 0) {
        const clientMap = new Map();
        clientsData.forEach((c: any) => clientMap.set(c.user_id, c.client_name));

        const clientIds = clientsData.map((c: any) => c.user_id);
        const { data: recentDocs } = await supabase
          .from("user_documents")
          .select("id, name, upload_date, user_id")
          .in("user_id", clientIds)
          .order("upload_date", { ascending: false })
          .limit(5);

        if (recentDocs) {
          setRecentActivity(recentDocs.map(d => ({
            id: d.id,
            client_name: clientMap.get(d.user_id) || 'Unknown Client',
            file_name: d.name || 'Document',
            created_at: d.upload_date
          })));
        }
      }
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  /**
   * Handle user logout
   */
  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
          <p className="text-slate-600 animate-pulse font-bold">Initializing Advisor Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cb-cream relative overflow-hidden">
      {/* Aurora glow effects */}
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-50/50 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-50/30 blur-[120px] rounded-full pointer-events-none" />

      <AdvisorWebsiteTour roleLabel={roleLabel} />

      {/* Main Content Area */}
      <div className="container mx-auto px-4 py-8 space-y-8 animate-in fade-in-50 duration-500 relative z-10">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-emerald-50 pb-8" id="tour-advisor-welcome">
          <div>
           
            <p className="text-emerald-900/60 text-lg font-bold">
              {userData ? `Welcome back, ${userData.first_name}!` : "Welcome back!"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
      

            <Button
              variant="outline"
              size="sm"
              onClick={() => (window as any).startAdvisorTour?.()}
              className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 flex items-center gap-2 font-black rounded-full px-6 h-11"
            >
              <Sparkles className="h-4 w-4" />
              Website Tour
            </Button>

            
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4" id="tour-advisor-stats">
          <StatCard
            icon={Users}
            label="Total Clients"
            value={stats.totalClients}
            trend="Active on platform"
            tone="emerald"
          />
          <StatCard
            icon={Clock}
            label="Pending Applications"
            value={stats.pendingApplications}
            trend="Awaiting underwriting"
            tone="amber"
          />
          <StatCard
            icon={CheckCircle}
            label="Approved Applications"
            value={stats.approvedApplications}
            trend="Fully processed"
            tone="blue"
          />
          <StatCard
            icon={TrendingUp}
            label="Success Rate"
            value={`${stats.successRate}%`}
            trend="Of total submissions"
            tone="violet"
          />
        </div>

        {/* Quick Actions Card */}
        <Card className="bg-white border-emerald-50 overflow-hidden rounded-[3rem] shadow-sm relative group" id="tour-advisor-quick-actions">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/50 blur-[60px] rounded-full pointer-events-none" />
          <CardHeader className="px-10 pt-10 pb-6">
            <CardTitle className="text-2xl font-black text-emerald-950 tracking-tighter uppercase">Quick Actions</CardTitle>
            <CardDescription className="text-emerald-900/40 font-bold">
              Common tasks and shortcuts for your workflow
            </CardDescription>
          </CardHeader>
          <CardContent className="px-10 pb-10 pt-0">
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {[
                { icon: FileText, title: "New Client Application", desc: "Start a new funding request", tone: "emerald", onClick: () => router.push(`${basePath}/clients/new`) },
                { icon: Zap, title: "Fast Funding", desc: "One-page speed form for the call", tone: "amber", onClick: () => router.push(`${basePath}/clients/new/speed`) },
                { icon: Users, title: "View Prospects", desc: "Manage your active pipeline", tone: "blue", onClick: () => router.push(`${basePath}/prospects`) },
                { icon: AlertCircle, title: "Pending Reviews", desc: "Applications awaiting your review", tone: "violet", onClick: () => router.push(`${basePath}/prospects`) },
              ].map(({ icon: ActionIcon, title, desc, tone, onClick }) => {
                const qt = QUICK_TONES[tone] ?? QUICK_TONES.emerald;
                return (
                  <button
                    key={title}
                    type="button"
                    onClick={onClick}
                    className={`group/btn relative text-left h-full rounded-[1.75rem] border-2 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl active:scale-[0.98] ${qt.border} ${qt.shadow}`}
                  >
                    <div className={`w-12 h-12 rounded-2xl ${qt.chip} shadow-lg flex items-center justify-center mb-5 group-hover/btn:scale-110 group-hover/btn:-rotate-3 transition-transform duration-300`}>
                      <ActionIcon className="h-6 w-6 text-white" />
                    </div>
                    <p className="font-black uppercase tracking-tight text-base text-slate-900 mb-1 leading-tight">{title}</p>
                    <p className="text-xs font-bold text-slate-400 leading-snug">{desc}</p>
                    <ArrowRight className={`absolute top-6 right-6 h-4 w-4 ${qt.arrow} opacity-0 -translate-x-1 group-hover/btn:opacity-100 group-hover/btn:translate-x-0 transition-all duration-300`} />
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Grid: Activity & Applications */}
        <div className="grid gap-8 md:grid-cols-2" id="tour-advisor-activity">
          {/* Recent Applications */}
          <Card className="bg-white border-emerald-50 rounded-[3rem] shadow-sm overflow-hidden">
            <CardHeader className="px-10 pt-10 pb-6 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black text-emerald-950 tracking-tighter uppercase">Recent Applications</CardTitle>
                <CardDescription className="text-emerald-900/40 font-bold">Latest client submissions</CardDescription>
              </div>
              <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl">
                <Activity className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="px-10 pb-10">
              <div className="space-y-4">
                {recentApps.length > 0 ? (
                  recentApps.map(app => (
                    <div
                      key={app.id}
                      onClick={() => {
                        if (!app.vault_id) return;
                        router.push(`${basePath}/clients/${app.vault_id}`);
                      }}
                      className="flex items-center justify-between p-4 bg-emerald-50/30 rounded-2xl border border-emerald-50 hover:bg-emerald-50/80 hover:border-emerald-200 hover:shadow-md cursor-pointer transition-all duration-200 active:scale-[0.99] group/row"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-white rounded-xl shadow-sm border border-emerald-100/50 group-hover/row:border-emerald-200 transition-colors">
                          <FileText className="h-5 w-5 text-emerald-500" />
                        </div>
                        <div>
                          <p className="font-black text-emerald-950 text-sm uppercase tracking-tight group-hover/row:text-emerald-600 transition-colors">{app.client_name}</p>
                          <p className="text-xs font-bold text-emerald-900/40">{app.company_name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {app.pipeline_status ? (
                          <LoanPipelineBadge currentStatus={app.pipeline_status} />
                        ) : (
                          <Badge className={`uppercase tracking-widest text-[9px] px-2 py-0.5 border ${app.status === 'locked' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                            app.status === 'documents_requested' ? 'bg-red-100 text-red-700 border-red-200' :
                              app.status === 'submitted' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                            {app.status === 'documents_requested' ? 'Action Needed' : app.status}
                          </Badge>
                        )}
                        <p className="text-[10px] font-bold text-emerald-900/40 mt-1">{formatDate(app.submitted_at)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm font-bold text-emerald-900/30 text-center py-12 bg-emerald-50/20 rounded-[2rem] border-2 border-dashed border-emerald-100/50">
                    <FileText className="h-8 w-8 mx-auto mb-3 opacity-20" />
                    No recent applications
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card className="bg-white border-emerald-50 rounded-[3rem] shadow-sm overflow-hidden">
            <CardHeader className="px-10 pt-10 pb-6 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black text-emerald-950 tracking-tighter uppercase">Activity Feed</CardTitle>
                <CardDescription className="text-emerald-900/40 font-bold">Recent updates and notifications</CardDescription>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-500 rounded-2xl">
                <Activity className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="px-10 pb-10">
              <div className="space-y-4">
                {recentActivity.length > 0 ? (
                  recentActivity.map(activity => (
                    <div key={activity.id} className="flex items-center gap-4 p-4 bg-emerald-50/30 rounded-2xl border border-emerald-50 hover:bg-emerald-50/60 transition-colors">
                      <div className="p-3 bg-white rounded-xl shadow-sm border border-emerald-100/50">
                        <CheckCircle className="h-5 w-5 text-emerald-500" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-emerald-950 text-sm">
                          <span className="font-black">{activity.client_name}</span> uploaded <span className="text-emerald-700">{activity.file_name}</span>
                        </p>
                        <p className="text-[10px] font-bold text-emerald-900/40 mt-0.5">{formatDate(activity.created_at)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm font-bold text-emerald-900/30 text-center py-12 bg-emerald-50/20 rounded-[2rem] border-2 border-dashed border-emerald-100/50">
                    <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                    No recent activity
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
