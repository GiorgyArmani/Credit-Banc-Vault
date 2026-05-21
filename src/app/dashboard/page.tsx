// src/app/dashboard/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AdvisorDisplay from "@/components/advisor-display";
import { MyScoreIQCarousel } from "@/components/myscoreiq-carousel";
import ProfileDisplay from "@/components/profile-display";
import Vault from '@/components/vault';
import TemplatesView from '@/components/templates-view';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, Clock, Sparkles } from 'lucide-react';
import { useOnboardingStatus } from '@/components/onboarding/use-onboarding-status';
import WebsiteTour from '@/components/tour/website-tour';
import { Button } from '@/components/ui/button';
import { LoanPipelineFull } from '@/components/loan-pipeline-status';
import { getClientPipelineHistory, updateLoanStatus, PipelineStatusEntry, LoanStatus } from '@/app/actions/pipeline';
import { BusinessTabStrip, type BusinessTab } from '@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip';
import { CollapsibleSection, broadcast_toggle_all } from '@/app/advisor/dashboard/clients/[id]/_components/collapsible-section';
import { PendingContractsBanner } from '@/components/onboarding/pending-contracts-banner';
import { PendingContractsModal } from '@/components/onboarding/pending-contracts-modal';

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
  const { clientName, dataVaultCompleted, vaultId } = useOnboardingStatus();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isVaultSubmitted, setIsVaultSubmitted] = useState(false);
  const [pipelineHistory, setPipelineHistory] = useState<PipelineStatusEntry[]>([]);
  const [currentStatus, setCurrentStatus] = useState<LoanStatus>("created");

  // Multi-business: tabs for clients who have more than one business under their
  // account. Single-business clients see no UI difference (the strip is hidden).
  const [businesses, setBusinesses] = useState<BusinessTab[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPipeline() {
      if (vaultId) {
        const history = await getClientPipelineHistory(vaultId);
        // Pipeline transitions are owned by their real-world events now:
        //   created     → onboarding         : onboarding-gate, on first vault access
        //   onboarding  → documents_requested: signwell-contract webhook on signature
        //                                      (also /api/onboarding/complete as fallback)
        //   docs_*      → docs_received      : uploads route, on first upload
        // No auto-advance from the dashboard mount — that masked the real event
        // and could re-fire if pipeline was ever moved back manually.
        setPipelineHistory(history);
        if (history.length > 0) {
          setCurrentStatus(history[history.length - 1].status);
        }
      }
    }
    fetchPipeline();
  }, [vaultId]);

  // Fetch businesses for this client (drives the tab strip).
  useEffect(() => {
    if (!vaultId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('business_profiles')
        .select('id, company_name, is_primary, display_order')
        .eq('client_vault_id', vaultId)
        .order('is_primary', { ascending: false })
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('Error fetching businesses for client dashboard:', error);
        return;
      }
      const rows = (data || []) as BusinessTab[];
      setBusinesses(rows);
      const primary = rows.find((b) => b.is_primary) || rows[0];
      if (primary) setActiveBusinessId(primary.id);
    })();
    return () => { cancelled = true; };
  }, [vaultId, supabase]);

  const handleChecklist = useCallback((info: { progress: number; complete: boolean; isSubmitted?: boolean }) => {
    setIsVaultSubmitted(!!info.isSubmitted && info.complete);
  }, []);

  // Ready states for synchronization
  const [isReady, setIsReady] = useState({
    advisor: false,
    profile: false,
    vault: false
  });

  // Helper to mark a component as ready
  const markReady = useCallback((component: keyof typeof isReady) => {
    setIsReady(prev => {
      if (prev[component]) return prev;
      return { ...prev, [component]: true };
    });
  }, []);

  const onAdvisorLoad = useCallback(() => markReady('advisor'), [markReady]);
  const onProfileLoad = useCallback(() => markReady('profile'), [markReady]);
  const onVaultLoad = useCallback(() => markReady('vault'), [markReady]);

  const allComponentsReady = isReady.advisor && isReady.profile && isReady.vault;

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
    if (isTourRequested && allComponentsReady) {
      // Small delay to ensure components are rendered
      const timer = setTimeout(() => {
        if (typeof (window as any).startWebsiteTour === 'function') {
          (window as any).startWebsiteTour();

          // Clear the parameter from the URL without refresh
          const url = new URL(window.location.href);
          url.searchParams.delete('tour');
          window.history.replaceState({}, '', url.pathname + url.search);
        }
      }, 500); // Reduced delay as we already checked for readiness
      return () => clearTimeout(timer);
    }
  }, [searchParams, allComponentsReady]);

  return (
    <div className="min-h-screen bg-white relative overflow-hidden">
      {/* subtle mint glow */}
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-50/50 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-50/30 blur-[120px] rounded-full pointer-events-none" />

      <WebsiteTour />

      {/* MAIN CONTENT SECTION */}
      <div className="container mx-auto px-4 py-8 space-y-8 animate-in fade-in-50 duration-500">

        {/* WELCOME & ACTIONS HEADER */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-emerald-50 pb-8">
          <div id="tour-welcome">
            <h2 className="text-4xl md:text-5xl font-black text-emerald-950 mb-3 tracking-tighter uppercase">
              Welcome{clientName ? `, ${clientName}` : (userEmail ? `, ${userEmail}` : '')}!
            </h2>
            <p className="text-emerald-900/60 text-lg font-bold">
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
              className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 flex items-center gap-2 font-bold rounded-full px-5"
            >
              <Sparkles className="h-4 w-4" />
              Website Tour
            </Button>
          </div>
        </div>

        {/* Auto-opening contract-signing modal. Fires on dashboard mount
            when the advisor has added a business with a pending Signwell
            contract. Closes to the always-visible banner below, so the
            client can still complete signing later from the same screen. */}
        <PendingContractsModal clientVaultId={vaultId} />

        {/* CONTENT AREA */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            {/* Pending-contract banner — fallback for when the modal has
                been dismissed. Same source of truth (usePendingContracts)
                so the banner reflects the modal's state automatically. */}
            <PendingContractsBanner clientVaultId={vaultId} />

            {/* Section folding controls — broadcasts an event to every
                CollapsibleSection on the page so the client can blow open or
                collapse everything in one click. */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => broadcast_toggle_all(true)}
                className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-emerald-600 transition-colors px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-sm"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={() => broadcast_toggle_all(false)}
                className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-emerald-600 transition-colors px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-sm"
              >
                Collapse all
              </button>
            </div>

            <CollapsibleSection
              clientId={vaultId || 'self'}
              slug="advisor"
              title="Your Advisor"
              defaultOpen
            >
              <AdvisorDisplay onLoad={onAdvisorLoad} />
            </CollapsibleSection>

            <CollapsibleSection
              clientId={vaultId || 'self'}
              slug="profile"
              title="Business Profile"
              defaultOpen
            >
              <ProfileDisplay onLoad={onProfileLoad} />
            </CollapsibleSection>

            <CollapsibleSection
              clientId={vaultId || 'self'}
              slug="pipeline"
              title="Application Status"
              summary={currentStatus ? currentStatus.replace(/_/g, ' ') : undefined}
              defaultOpen
            >
              <Card className="bg-white border-emerald-50 overflow-hidden rounded-[2.5rem] shadow-sm">
                <CardHeader className="pb-4 pt-10 px-10">
                  <CardTitle className="text-2xl font-black text-emerald-950 tracking-tighter uppercase">Application Status</CardTitle>
                  <p className="text-emerald-900/60 font-bold">Track your application progress through our underwriting pipeline.</p>
                </CardHeader>
                <CardContent className="px-10 pb-10">
                  <LoanPipelineFull
                    currentStatus={currentStatus}
                    history={pipelineHistory}
                    showAllSteps={false}
                  />
                </CardContent>
              </Card>
            </CollapsibleSection>

            <CollapsibleSection
              clientId={vaultId || 'self'}
              slug="vault"
              title="Document Vault"
              defaultOpen
            >
              <Card className="bg-white border-emerald-50 overflow-hidden rounded-[2.5rem] shadow-sm">
                <CardHeader className="pb-0 pt-10 px-10">
                  <CardTitle className="text-2xl font-black text-emerald-950 tracking-tighter uppercase">DOCUMENT VAULT</CardTitle>
                </CardHeader>
                <CardContent className="p-10 pt-6">
                  {/* Business tabs — only render when the client has multiple
                      businesses. No "Add" button on the client side (advisor-only). */}
                  <BusinessTabStrip
                    businesses={businesses}
                    active_business_id={activeBusinessId}
                    on_select={setActiveBusinessId}
                    show_when_single={false}
                  />
                  <Vault
                    clientName={clientName}
                    onLoad={onVaultLoad}
                    onChecklist={handleChecklist}
                    activeBusinessId={activeBusinessId}
                  />
                </CardContent>
              </Card>
            </CollapsibleSection>

            {isVaultSubmitted && <MyScoreIQCarousel />}
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="border-b border-emerald-50 pb-6">
              <h3 className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">Document Templates</h3>
              <p className="text-emerald-900/60 font-bold mt-2">Download the templates you need to complete your application.</p>
            </div>
            <TemplatesView />
          </div>
        )}

      </div>
    </div>
  );
}