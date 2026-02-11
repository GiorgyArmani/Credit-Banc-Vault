"use client";
import AdvisorNewClientPage from "./clients/new/page";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
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
    // Add other fields as needed
  }

  const [userData, setUserData] = useState<AdvisorUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalClients: 0,
    pendingApplications: 0,
    approvedApplications: 0,
    thisMonthApplications: 0
  });

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

        // Check if user has advisor role
        if (profile.role !== "advisor") {
          router.push("/dashboard"); // Redirect to regular dashboard
          return;
        }

        setUserData(profile);

        // Load advisor statistics
        await loadStats();

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
  async function loadStats() {
    try {
      // For now, using placeholder data
      setStats({
        totalClients: 12,
        pendingApplications: 5,
        approvedApplications: 7,
        thisMonthApplications: 3
      });
    } catch (error) {
      console.error("Error loading stats:", error);
    }
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
            trend="+2 from last month"
          />
          <StatCard
            icon={Clock}
            label="Pending Applications"
            value={stats.pendingApplications}
            trend="Requires attention"
          />
          <StatCard
            icon={CheckCircle}
            label="Approved This Month"
            value={stats.approvedApplications}
            trend={`${stats.thisMonthApplications} new this month`}
          />
          <StatCard
            icon={TrendingUp}
            label="Success Rate"
            value="85%"
            trend="+5% from last month"
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
                onClick={() => router.push("/advisor/dashboard/clients/new")}
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
                onClick={() => router.push("/advisor/dashboard/clients")}
              >
                <div className="p-3 bg-white rounded-2xl mb-4 group-hover/btn:bg-white/20 transition-colors">
                  <Users className="h-6 w-6 text-emerald-500 group-hover/btn:text-white" />
                </div>
                <span className="font-black uppercase tracking-tighter text-lg mb-1">View Clients</span>
                <span className="text-xs font-bold opacity-60 group-hover/btn:opacity-100">Manage your active client list</span>
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
                <div className="text-sm font-bold text-emerald-900/30 text-center py-12 bg-emerald-50/20 rounded-[2rem] border-2 border-dashed border-emerald-100/50">
                  <FileText className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  No recent applications
                </div>
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
                <div className="text-sm font-bold text-emerald-900/30 text-center py-12 bg-emerald-50/20 rounded-[2rem] border-2 border-dashed border-emerald-100/50">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  No recent activity
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
