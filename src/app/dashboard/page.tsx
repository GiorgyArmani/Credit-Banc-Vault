// src/app/dashboard/page.tsx
//
// The client portal home.
//
// LAYOUT: one work column plus a context rail. The client is here to do exactly
// one thing — hand over documents — so the checklist is the page, and it starts
// at the top where it can be seen without scrolling. Everything the client only
// needs to REFERENCE (who their advisor is, where the file is in the pipeline,
// what we have on record about their business) lives in a sticky rail beside
// the work rather than stacked above it.
//
// This replaced four `CollapsibleSection` wrappers, each of which wrapped a
// `Card` that repeated the same title — a section header, a card header, and a
// chevron for every one of four blocks, with Expand-all / Collapse-all controls
// on top to manage the mess. The document vault, the only part a client came
// for, was below all of it. Collapsing is gone entirely: nothing here is long
// enough to need folding away now that the advisor card is a rail card instead
// of a full-height portrait.
//
// The tour anchors (#tour-welcome, #tour-advisor, #tour-profile, #tour-progress,
// #tour-vault, and #tour-checklist / #tour-upload inside the vault) all still
// resolve — website-tour.tsx targets them by id and silently skips a step whose
// element is missing.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AdvisorDisplay from "@/components/advisor-display";
import { MyScoreIQCarousel } from "@/components/myscoreiq-carousel";
import ProfileDisplay from "@/components/profile-display";
import Vault from '@/components/vault';
import TemplatesView from '@/components/templates-view';
import { Shield, Clock, Sparkles } from 'lucide-react';
import { useOnboardingStatus } from '@/components/onboarding/use-onboarding-status';
import WebsiteTour from '@/components/tour/website-tour';
import { LoanPipelineRail, PIPELINE_STEPS } from '@/components/loan-pipeline-status';
// Read-only: the client dashboard shows the step the file is on. Clients have no
// pipeline write access, so the staff-only updateLoanStatus is not imported here.
import { getClientPipelineHistory, PipelineStatusEntry, LoanStatus } from '@/app/actions/pipeline';
import { BusinessTabStrip, type BusinessTab } from '@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip';
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
      <div className="flex min-h-screen items-center justify-center bg-cb-cream">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-cb-mint border-t-transparent" />
          <p className="text-sm text-cb-ink/50">Loading your portal…</p>
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
        .select('id, company_name, is_primary, display_order, funding_deals (id, display_order, funded_at)')
        .eq('client_vault_id', vaultId)
        .order('is_primary', { ascending: false })
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('Error fetching businesses for client dashboard:', error);
        return;
      }
      // Flatten the current funding round onto each tab so the vault only shows
      // the paperwork for the financing being worked — a renewal shouldn't open
      // with the previous round's documents already ticked off.
      const rows = (data || []).map((b: any): BusinessTab => {
        const deals = Array.isArray(b.funding_deals) ? b.funding_deals : [];
        const deal = deals
          .slice()
          .sort((x: any, y: any) => (y.display_order ?? 0) - (x.display_order ?? 0))[0] ?? null;
        const { funding_deals: _drop, ...rest } = b;
        return { ...rest, active_deal_id: deal?.id ?? null, active_deal_funded_at: deal?.funded_at ?? null };
      });
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

  // Handle tour auto-start.
  //   1. Explicit ?tour=true (e.g. linked from onboarding) always runs it.
  //   2. Otherwise auto-run ONCE on a client's first dashboard visit — confused
  //      first-timers get the upload walkthrough without hunting for the button.
  //      A localStorage flag keeps it to a single auto-run; the "Website Tour"
  //      button is always available to replay it.
  const TOUR_SEEN_KEY = 'cb-dashboard-tour-seen';
  useEffect(() => {
    if (!allComponentsReady) return;
    if (typeof window === 'undefined') return;

    const isTourRequested = searchParams?.get('tour') === 'true';
    const hasSeenTour = window.localStorage.getItem(TOUR_SEEN_KEY) === '1';
    if (!isTourRequested && hasSeenTour) return;

    // Small delay to ensure components are rendered.
    const timer = setTimeout(() => {
      if (typeof (window as any).startWebsiteTour === 'function') {
        (window as any).startWebsiteTour();
        window.localStorage.setItem(TOUR_SEEN_KEY, '1');

        if (isTourRequested) {
          // Clear the parameter from the URL without refresh.
          const url = new URL(window.location.href);
          url.searchParams.delete('tour');
          window.history.replaceState({}, '', url.pathname + url.search);
        }
      }
    }, 500); // Reduced delay as we already checked for readiness
    return () => clearTimeout(timer);
  }, [searchParams, allComponentsReady]);

  const greetingName = clientName || userEmail || null;
  const statusLabel =
    PIPELINE_STEPS.find((s) => s.status === currentStatus)?.shortLabel ??
    currentStatus.replace(/_/g, ' ');

  return (
    <div className="min-h-screen bg-cb-cream">
      <WebsiteTour />

      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-10">

        {/* ── Header ────────────────────────────────────────────────────────
            One line, not a hero. The old 5xl uppercase block plus a paragraph
            of explanation pushed the actual work below the fold on a laptop. */}
        <header
          id="tour-welcome"
          className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-center sm:justify-between"
        >
          {/* Tab-aware. The status chip, the SLA and the tour describe the
              application, not the app, so they belong to the vault tab only —
              on Templates they were answering a question nobody had asked. */}
          <div className="min-w-0">
            <h1 className="font-manrope text-2xl font-extrabold tracking-tight text-cb-ink md:text-3xl">
              {activeTab === 'templates'
                ? 'Document templates'
                : greetingName
                  ? `Welcome, ${greetingName}`
                  : 'Welcome'}
            </h1>
            <p className="mt-1 text-sm text-cb-ink/50">
              {activeTab === 'templates'
                ? 'Download a blank, fill it in, then upload it back in your vault.'
                : "Upload what underwriting asked for and we'll take it from there."}
            </p>
          </div>

          <div
            className={`flex shrink-0 flex-wrap items-center gap-2 ${
              activeTab === 'templates' ? 'hidden' : ''
            }`}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cb-mint/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-cb-mint" />
              {statusLabel}
            </span>
            <span className="hidden items-center gap-1.5 rounded-full border border-black/5 bg-white px-3 py-1.5 text-[11px] font-semibold text-cb-ink/50 lg:inline-flex">
              <Shield className="h-3.5 w-3.5" /> Secure
            </span>
            <span className="hidden items-center gap-1.5 rounded-full border border-black/5 bg-white px-3 py-1.5 text-[11px] font-semibold text-cb-ink/50 lg:inline-flex">
              <Clock className="h-3.5 w-3.5" /> 24–48h underwriting
            </span>
            <button
              type="button"
              onClick={() => (window as any).startWebsiteTour?.()}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-cb-ink transition-colors hover:bg-cb-cream"
            >
              <Sparkles className="h-3.5 w-3.5 text-cb-mint" />
              Take the tour
            </button>
          </div>
        </header>

        {/* Auto-opening contract-signing modal. Fires on dashboard mount
            when the advisor has added a business with a pending Signwell
            contract. Closes to the always-visible banner below, so the
            client can still complete signing later from the same screen. */}
        <PendingContractsModal clientVaultId={vaultId} />

        {activeTab === 'dashboard' && (
          <>
            {/* Pending-contract banner — fallback for when the modal has
                been dismissed. Same source of truth (usePendingContracts)
                so the banner reflects the modal's state automatically. */}
            <PendingContractsBanner clientVaultId={vaultId} />

            <div className="mt-2 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">

              {/* ── Work column ─────────────────────────────────────────── */}
              <main id="tour-vault" className="min-w-0 space-y-4">
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
                  activeDealId={businesses.find((b) => b.id === activeBusinessId)?.active_deal_id ?? null}
                />

                {isVaultSubmitted && <MyScoreIQCarousel />}
              </main>

              {/* ── Context rail ────────────────────────────────────────────
                  Sticky on desktop so the advisor's number stays reachable
                  however far down the checklist the client has scrolled. On
                  mobile it simply stacks underneath the work, which is the
                  right order there too. */}
              <aside className="space-y-4 lg:sticky lg:top-6">
                <AdvisorDisplay onLoad={onAdvisorLoad} variant="rail" />

                <section
                  id="tour-progress"
                  className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"
                >
                  <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.18em] text-cb-gray">
                    Your application
                  </p>
                  <LoanPipelineRail currentStatus={currentStatus} history={pipelineHistory} />
                </section>

                <ProfileDisplay onLoad={onProfileLoad} variant="rail" />
              </aside>
            </div>
          </>
        )}

        {activeTab === 'templates' && <TemplatesView />}

      </div>
    </div>
  );
}
