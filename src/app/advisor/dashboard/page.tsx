"use client";
import AdvisorNewClientPage from "./clients/new/page";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
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
  Activity
} from "lucide-react";
import AdvisorWebsiteTour from "@/components/tour/advisor-website-tour";
import { Badge } from "@/components/ui/badge";
import { getBulkLatestStatus, type LoanStatus } from "@/app/actions/pipeline";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";

/**
 * Stat Card Component
 * Displays a single metric with icon and label
 */
function StatCard({
  icon: Icon,
  label,
  value,
  trend
}: {
  icon: any;
  label: string;
  value: string | number;
  trend?: string;
  id?: string;
}) {
  return (
    <Card className="rounded-[2rem] border-emerald-50 bg-white/50 backdrop-blur-sm hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-500 group overflow-hidden border-2 hover:border-emerald-100">
      <CardHeader className="flex flex-row items-center justify-between pb-2 px-6 pt-6">
        <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40">
          {label}
        </CardTitle>
        <div className="p-2 bg-emerald-50 rounded-xl group-hover:bg-emerald-500 group-hover:text-white transition-all duration-500">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-2">
        <div className="text-3xl font-black text-emerald-950 tracking-tighter uppercase">{value}</div>
        {trend && (
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-500 mt-2 flex items-center gap-1">
            {trend}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Advisor Dashboard Page
 * Main dashboard for advisors to manage clients and applications
 */
export default function AdvisorDashboard() {
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
  const pathname = usePathname();
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

        // Check if user has advisor or admin role
        if (profile.role !== "advisor" && profile.role !== "admin") {
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
    <div className="min-h-screen bg-white relative overflow-hidden">
      {/* Aurora glow effects */}
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-50/50 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-50/30 blur-[120px] rounded-full pointer-events-none" />

      <AdvisorWebsiteTour />

      {/* Main Content Area */}
      <div className="container mx-auto px-4 py-8 space-y-8 animate-in fade-in-50 duration-500 relative z-10">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-emerald-50 pb-8" id="tour-advisor-welcome">
          <div>
            <h1 className="text-4xl md:text-5xl font-black text-emerald-950 mb-3 tracking-tighter uppercase leading-none">
              Advisor Dashboard
            </h1>
            <p className="text-emerald-900/60 text-lg font-bold">
              {userData ? `Welcome back, ${userData.first_name}!` : "Welcome back!"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 mr-2">
              <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-black px-3 py-1">
                ADVISOR PORTAL
              </Badge>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => (window as any).startAdvisorTour?.()}
              className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 flex items-center gap-2 font-black rounded-full px-6 h-11"
            >
              <Sparkles className="h-4 w-4" />
              Website Tour
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="bg-white text-emerald-950 border-emerald-100 hover:bg-emerald-50 flex items-center gap-2 font-black rounded-full px-6 h-11"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
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
          />
          <StatCard
            icon={Clock}
            label="Pending Applications"
            value={stats.pendingApplications}
            trend="Awaiting underwriting"
          />
          <StatCard
            icon={CheckCircle}
            label="Approved Applications"
            value={stats.approvedApplications}
            trend="Fully processed"
          />
          <StatCard
            icon={TrendingUp}
            label="Success Rate"
            value={`${stats.successRate}%`}
            trend="Of total submissions"
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
            <div className="grid gap-6 md:grid-cols-3">
              <Button
                className="h-auto flex-col items-start p-6 bg-emerald-50/50 border-emerald-100 hover:bg-emerald-500 hover:text-white transition-all duration-500 rounded-[2rem] border-2 shadow-none group/btn"
                variant="outline"
                onClick={() => router.push(pathname.startsWith("/admin") ? "/admin/clients/new" : "/advisor/dashboard/clients/new")}
              >
                <div className="p-3 bg-white rounded-2xl mb-4 group-hover/btn:bg-white/20 transition-colors">
                  <FileText className="h-6 w-6 text-emerald-500 group-hover/btn:text-white" />
                </div>
                <span className="font-black uppercase tracking-tighter text-lg mb-1">New Client Application</span>
                <span className="text-xs font-bold opacity-60 group-hover/btn:opacity-100">Start a new funding request</span>
              </Button>

              <Button
                className="h-auto flex-col items-start p-6 bg-emerald-50/50 border-emerald-100 hover:bg-emerald-500 hover:text-white transition-all duration-500 rounded-[2rem] border-2 shadow-none group/btn"
                variant="outline"
                onClick={() => router.push(pathname.startsWith("/admin") ? "/admin/prospects" : "/advisor/dashboard/prospects")}
              >
                <div className="p-3 bg-white rounded-2xl mb-4 group-hover/btn:bg-white/20 transition-colors">
                  <Users className="h-6 w-6 text-emerald-500 group-hover/btn:text-white" />
                </div>
                <span className="font-black uppercase tracking-tighter text-lg mb-1">View Prospects</span>
                <span className="text-xs font-bold opacity-60 group-hover/btn:opacity-100">Manage your active pipeline</span>
              </Button>

              <Button
                className="h-auto flex-col items-start p-6 bg-emerald-50/50 border-emerald-100 hover:bg-emerald-500 hover:text-white transition-all duration-500 rounded-[2rem] border-2 shadow-none group/btn"
                variant="outline"
              >
                <div className="p-3 bg-white rounded-2xl mb-4 group-hover/btn:bg-white/20 transition-colors">
                  <AlertCircle className="h-6 w-6 text-emerald-500 group-hover/btn:text-white" />
                </div>
                <span className="font-black uppercase tracking-tighter text-lg mb-1">Pending Reviews</span>
                <span className="text-xs font-bold opacity-60 group-hover/btn:opacity-100">Applications awaiting your review</span>
              </Button>
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
                    <div key={app.id} className="flex items-center justify-between p-4 bg-emerald-50/30 rounded-2xl border border-emerald-50 hover:bg-emerald-50/60 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-white rounded-xl shadow-sm border border-emerald-100/50">
                          <FileText className="h-5 w-5 text-emerald-500" />
                        </div>
                        <div>
                          <p className="font-black text-emerald-950 text-sm uppercase tracking-tight">{app.client_name}</p>
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
