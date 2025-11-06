"use client";

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
  LogOut
} from "lucide-react";

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
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {trend && (
          <p className="text-xs text-muted-foreground mt-1">{trend}</p>
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
  const [user, setUser] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
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

        setUser(user);

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
  }, []);

  /**
   * Load advisor statistics from database
   * This is a placeholder - adjust based on your actual data model
   */
  async function loadStats() {
    try {
      // TODO: Replace with actual queries based on your data model
      // Example: Count applications, clients, etc.
      
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
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div>
            <h1 className="text-2xl font-bold">Advisor Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Welcome back, {userData?.first_name}!
            </p>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto p-6">
        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
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

        {/* Quick Actions */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common tasks and shortcuts for your workflow
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <Button className="h-auto flex-col items-start p-4" variant="outline">
                <FileText className="mb-2 h-6 w-6" />
                <span className="font-semibold">New Application</span>
                <span className="text-xs text-muted-foreground">
                  Start a new client application
                </span>
              </Button>
              <Button className="h-auto flex-col items-start p-4" variant="outline">
                <Users className="mb-2 h-6 w-6" />
                <span className="font-semibold">View Clients</span>
                <span className="text-xs text-muted-foreground">
                  Manage your client list
                </span>
              </Button>
              <Button className="h-auto flex-col items-start p-4" variant="outline">
                <AlertCircle className="mb-2 h-6 w-6" />
                <span className="font-semibold">Pending Reviews</span>
                <span className="text-xs text-muted-foreground">
                  Applications awaiting review
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Recent Applications */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Applications</CardTitle>
              <CardDescription>Latest client submissions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Placeholder for recent applications */}
                <div className="text-sm text-muted-foreground text-center py-8">
                  No recent applications
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Feed</CardTitle>
              <CardDescription>Recent updates and notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Placeholder for activity feed */}
                <div className="text-sm text-muted-foreground text-center py-8">
                  No recent activity
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}