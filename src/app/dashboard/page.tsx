// src/app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AdvisorDisplay from "@/components/advisor-display";
import ProfileDisplay from "@/components/profile-display";
import Vault from '@/components/vault';
import TemplatesView from '@/components/templates-view';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Clock, UploadCloud, LayoutDashboard, FileText } from 'lucide-react';
import { useOnboardingStatus } from '@/components/onboarding/use-onboarding-status';

import { Suspense } from 'react';

/**
 * DashboardPage Component
 * 
 * Main entry point for the dashboard, wrapped in Suspense for search params compliance.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
          <p className="text-slate-600 animate-pulse">Initializing Dashboard...</p>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const supabase = createClient();
  const { clientName } = useOnboardingStatus();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Read tab from URL, default to 'dashboard'
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const [activeTab, setActiveTab] = useState("dashboard");

  // Update active tab when URL changes
  useEffect(() => {
    if (tabParam === 'templates') {
      setActiveTab('templates');
    } else {
      setActiveTab('dashboard');
    }
  }, [tabParam]);

  // Handle tab change to update URL
  const handleTabChange = (val: string) => {
    setActiveTab(val);
    const url = new URL(window.location.href);
    if (val === 'templates') {
      url.searchParams.set('tab', 'templates');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.pushState({}, '', url.toString());
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);
    })();
  }, [supabase]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* HEADER SECTION */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10 transition-all duration-200">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 flex items-center justify-center">
              <UploadCloud className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">CreditBanc Vault</h1>
              <p className="text-xs text-slate-600">Easy • Fast • Secure</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">
              BETA
            </Badge>
            <div className="hidden sm:flex items-center text-slate-600 text-sm gap-3">
              <span className="inline-flex items-center gap-1">
                <Shield className="h-4 w-4" /> Secure
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" /> 24–48h underwriting
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT SECTION */}
      <div className="container mx-auto px-4 py-8 space-y-8 animate-in fade-in-50 duration-500">

        {/* WELCOME SECTION */}
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">
            Welcome{clientName ? `, ${clientName}` : (userEmail ? `, ${userEmail}` : '')}!
          </h2>
          <p className="text-slate-600">
            Manage your documents and download templates.
          </p>
        </div>

        {/* TABS INTERFACE */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-[400px] mb-8 bg-slate-100 p-1">
            <TabsTrigger value="dashboard" className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
              <FileText className="h-4 w-4" />
              Templates
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: DASHBOARD (Original Content) */}
          <TabsContent value="dashboard" className="space-y-8 focus-visible:outline-none focus-visible:ring-0">
            <div className="grid gap-8">
              <AdvisorDisplay />
              <ProfileDisplay />
            </div>

            <Card className="bg-white border-slate-200 overflow-hidden">
              <CardHeader className="pb-0">
                <CardTitle className="text-slate-900">Document Vault</CardTitle>
                <CardDescription className="text-slate-600">
                  Upload your 6 months bank statements, ID (front & back), voided business check, and if applicable, a debt schedule.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <Vault />
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: TEMPLATES (New Content) */}
          <TabsContent value="templates" className="space-y-6 focus-visible:outline-none focus-visible:ring-0">
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-slate-900">Document Templates</h3>
              <p className="text-slate-600">Download the templates you need to complete your application.</p>
            </div>
            <TemplatesView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}