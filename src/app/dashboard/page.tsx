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
import { Shield, Clock, Sparkles } from 'lucide-react';
import { useOnboardingStatus } from '@/components/onboarding/use-onboarding-status';
import WebsiteTour from '@/components/tour/website-tour';
import { Button } from '@/components/ui/button';

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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);
    })();
  }, [supabase]);

  // Handle tour auto-start
  useEffect(() => {
    const isTourRequested = searchParams?.get('tour') === 'true';
    if (isTourRequested) {
      // Small delay to ensure components are rendered
      const timer = setTimeout(() => {
        if (typeof (window as any).startWebsiteTour === 'function') {
          (window as any).startWebsiteTour();

          // Clear the parameter from the URL without refresh
          const url = new URL(window.location.href);
          url.searchParams.delete('tour');
          window.history.replaceState({}, '', url.pathname + url.search);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">

      <WebsiteTour />

      {/* MAIN CONTENT SECTION */}
      <div className="container mx-auto px-4 py-8 space-y-8 animate-in fade-in-50 duration-500">

        {/* WELCOME & ACTIONS HEADER */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b pb-6">
          <div id="tour-welcome">
            <h2 className="text-3xl font-bold text-slate-900 mb-1">
              Welcome{clientName ? `, ${clientName}` : (userEmail ? `, ${userEmail}` : '')}!
            </h2>
            <p className="text-slate-600">
              This is your home base. Manage documents, access templates, and keep everything in one place until underwriting is complete.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">
                BETA
              </Badge>
              <div className="hidden xl:flex items-center text-slate-600 text-sm gap-3">
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-4 w-4" /> Secure
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-4 w-4" /> 24–48h underwriting
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => (window as any).startWebsiteTour?.()}
              className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 flex items-center gap-2 font-medium"
            >
              <Sparkles className="h-4 w-4" />
              Website Tour
            </Button>
          </div>
        </div>

        {/* CONTENT AREA */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid gap-8">
              <AdvisorDisplay />
              <ProfileDisplay />
            </div>

            <Card className="bg-white border-slate-200 overflow-hidden">
              <CardHeader className="pb-0">
                <CardTitle className="text-slate-900">DOCUMENT VAULT</CardTitle>

              </CardHeader>
              <CardContent className="pt-6">
                <Vault clientName={clientName} />
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-6">
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-slate-900">Document Templates</h3>
              <p className="text-slate-600">Download the templates you need to complete your application.</p>
            </div>
            <TemplatesView />
          </div>
        )}

      </div>
    </div>
  );
}